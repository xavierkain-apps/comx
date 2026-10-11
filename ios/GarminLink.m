#import "GarminLink.h"

#import <ConnectIQ/ConnectIQ.h>
#import <UIKit/UIKit.h>

static NSString *const kAppId = @"8ac2d628-66c4-40a4-96b0-10061a6d6519";
static NSString *const kScheme = @"comx-ciq";
static NSString *const kDefaultsKey = @"comx.garmin.devices";
static const NSTimeInterval kStateInterval = 5.0;

#pragma mark - JSON <-> Connect IQ values

static BOOL IsBool(NSNumber *n) {
  return CFGetTypeID((__bridge CFTypeRef)n) == CFBooleanGetTypeID();
}

static BOOL IsFloatingType(NSNumber *n) {
  const char *t = n.objCType;
  return t != NULL && (t[0] == 'd' || t[0] == 'f');
}

/// Integers keep the narrowest shape: 32-bit Number on the watch when they
/// fit, Long otherwise (epoch ms). Fractions stay doubles.
static id NarrowNumber(NSNumber *n) {
  if (IsBool(n)) return n;
  if ([n isKindOfClass:[NSDecimalNumber class]]) {
    NSDecimalNumber *d = (NSDecimalNumber *)n;
    NSDecimalNumber *rounded = [d decimalNumberByRoundingAccordingToBehavior:
        [NSDecimalNumberHandler decimalNumberHandlerWithRoundingMode:NSRoundPlain scale:0
                                                    raiseOnExactness:NO raiseOnOverflow:NO
                                                    raiseOnUnderflow:NO raiseOnDivideByZero:NO]];
    if ([rounded compare:d] != NSOrderedSame) return @(d.doubleValue);
    double v = d.doubleValue;
    if (fabs(v) >= 9.2e18) return @(v);
    n = @(d.longLongValue);
  }
  if (IsFloatingType(n)) {
    double v = n.doubleValue;
    return @(v);
  }
  long long v = n.longLongValue;
  if (v >= INT32_MIN && v <= INT32_MAX) return @((int)v);
  return @(v);
}

static id ToGarmin(id value) {
  if (value == nil || value == [NSNull null]) return [NSNull null];
  if ([value isKindOfClass:[NSDictionary class]]) {
    NSMutableDictionary *out = [NSMutableDictionary dictionary];
    [(NSDictionary *)value enumerateKeysAndObjectsUsingBlock:^(id key, id obj, BOOL *stop) {
      if (obj == [NSNull null]) return; // missing key == null in Monkey C
      out[[key description]] = ToGarmin(obj);
    }];
    return out;
  }
  if ([value isKindOfClass:[NSArray class]]) {
    NSMutableArray *out = [NSMutableArray array];
    for (id item in (NSArray *)value) [out addObject:ToGarmin(item)];
    return out;
  }
  if ([value isKindOfClass:[NSNumber class]]) return NarrowNumber(value);
  if ([value isKindOfClass:[NSString class]]) return value;
  return [value description];
}

static id ToJSONValue(id value) {
  if (value == nil || value == [NSNull null]) return [NSNull null];
  if ([value isKindOfClass:[NSDictionary class]]) {
    NSMutableDictionary *out = [NSMutableDictionary dictionary];
    [(NSDictionary *)value enumerateKeysAndObjectsUsingBlock:^(id key, id obj, BOOL *stop) {
      out[[key description]] = ToJSONValue(obj);
    }];
    return out;
  }
  if ([value isKindOfClass:[NSArray class]]) {
    NSMutableArray *out = [NSMutableArray array];
    for (id item in (NSArray *)value) [out addObject:ToJSONValue(item)];
    return out;
  }
  if ([value isKindOfClass:[NSData class]]) {
    NSData *data = value;
    const uint8_t *bytes = data.bytes;
    NSMutableArray *out = [NSMutableArray arrayWithCapacity:data.length];
    for (NSUInteger i = 0; i < data.length; i++) [out addObject:@(bytes[i])];
    return out;
  }
  if ([value isKindOfClass:[NSNumber class]]) {
    NSNumber *n = value;
    if (IsBool(n)) return n;
    if (IsFloatingType(n)) {
      double v = n.doubleValue;
      if (isnan(v) || isinf(v)) return [NSNull null];
      return @(v);
    }
    return @(n.longLongValue);
  }
  if ([value isKindOfClass:[NSString class]]) return value;
  return [value description];
}

#pragma mark - GarminLink

@interface GarminLink () <IQUIOverrideDelegate, IQDeviceEventDelegate, IQAppMessageDelegate>
@end

@implementation GarminLink {
  // Main thread only.
  BOOL _initialized;
  NSMutableDictionary<NSUUID *, IQDevice *> *_devices;
  NSMutableDictionary<NSUUID *, IQApp *> *_apps;
  NSMutableDictionary<NSUUID *, NSNumber *> *_deviceStatus; // IQDeviceStatus
  NSMutableDictionary<NSUUID *, NSNumber *> *_installed;    // BOOL, absent = unknown
  NSMutableSet<NSUUID *> *_stateInFlight;
  NSString *_lastState;
  NSDate *_lastStateSentAt;
  BOOL _stateTimerArmed;
  // Read from any thread.
  NSArray<NSDictionary<NSString *, id> *> *_statusSnapshot;
}

+ (GarminLink *)shared {
  static GarminLink *instance;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ instance = [[GarminLink alloc] init]; });
  return instance;
}

+ (NSString *)urlScheme {
  return kScheme;
}

- (instancetype)init {
  if ((self = [super init])) {
    _devices = [NSMutableDictionary dictionary];
    _apps = [NSMutableDictionary dictionary];
    _deviceStatus = [NSMutableDictionary dictionary];
    _installed = [NSMutableDictionary dictionary];
    _stateInFlight = [NSMutableSet set];
    _statusSnapshot = @[];
  }
  return self;
}

static void OnMain(dispatch_block_t block) {
  if ([NSThread isMainThread]) block();
  else dispatch_async(dispatch_get_main_queue(), block);
}

- (void)initializeSDKIfNeeded {
  if (_initialized) return;
  _initialized = YES;
  [[ConnectIQ sharedInstance] initializeWithUrlScheme:kScheme uiOverrideDelegate:self];
}

#pragma mark Lifecycle

- (void)startIfConfigured {
  OnMain(^{
    NSArray<IQDevice *> *saved = [self loadDevices];
    if (saved.count == 0) return;
    [self initializeSDKIfNeeded];
    [self useDevices:saved];
  });
}

- (void)selectDevicesWithCompletion:(void (^)(NSString *_Nullable))completion {
  OnMain(^{
    NSURL *gcm = [NSURL URLWithString:@"gcm-ciq://"];
    if (![[UIApplication sharedApplication] canOpenURL:gcm]) {
      NSLog(@"[GarminLink] Garmin Connect is not installed");
      completion(@"Garmin Connect is not installed. Install it from the App Store, pair your watch, then try again.");
      return;
    }
    [self initializeSDKIfNeeded];
    [[ConnectIQ sharedInstance] showConnectIQDeviceSelection];
    completion(nil);
  });
}

- (BOOL)handleURL:(NSURL *)url {
  if (![url.scheme isEqualToString:kScheme]) return NO;
  [self initializeSDKIfNeeded];
  NSArray *devices = [[ConnectIQ sharedInstance] parseDeviceSelectionResponseFromURL:url];
  if (devices == nil) {
    NSLog(@"[GarminLink] could not parse the device selection: %@", url);
    return YES; // our scheme; nothing else should handle it
  }
  NSMutableArray<IQDevice *> *picked = [NSMutableArray array];
  for (id d in devices) {
    if ([d isKindOfClass:[IQDevice class]]) [picked addObject:d];
  }
  NSLog(@"[GarminLink] %lu device(s) selected", (unsigned long)picked.count);
  [self saveDevices:picked];
  [self useDevices:picked];
  return YES;
}

#pragma mark Devices

- (void)useDevices:(NSArray<IQDevice *> *)devices {
  ConnectIQ *ciq = [ConnectIQ sharedInstance];
  [ciq unregisterForAllDeviceEvents:self];
  [ciq unregisterForAllAppMessages:self];
  [_devices removeAllObjects];
  [_apps removeAllObjects];
  [_deviceStatus removeAllObjects];
  [_installed removeAllObjects];
  [_stateInFlight removeAllObjects];

  NSUUID *appId = [[NSUUID alloc] initWithUUIDString:kAppId];
  for (IQDevice *device in devices) {
    if (device.uuid == nil) continue;
    _devices[device.uuid] = device;
    IQApp *app = [IQApp appWithUUID:appId storeUuid:appId device:device];
    _apps[device.uuid] = app;
    [ciq registerForDeviceEvents:device delegate:self];
    [ciq registerForAppMessages:app delegate:self];
    _deviceStatus[device.uuid] = @([ciq getDeviceStatus:device]);
    [self refreshAppStatus:device];
  }
  [self statusChanged];
}

- (void)refreshAppStatus:(IQDevice *)device {
  IQApp *app = _apps[device.uuid];
  if (app == nil) return;
  __weak GarminLink *weakSelf = self;
  NSUUID *uuid = device.uuid;
  [[ConnectIQ sharedInstance] getAppStatus:app completion:^(IQAppStatus *appStatus) {
    OnMain(^{
      GarminLink *strongSelf = weakSelf;
      if (strongSelf == nil || strongSelf->_devices[uuid] == nil) return;
      // nil = device not reachable or timed out: keep what we knew.
      if (appStatus != nil) {
        strongSelf->_installed[uuid] = @(appStatus.isInstalled);
        [strongSelf statusChanged];
      }
    });
  }];
}

- (void)saveDevices:(NSArray<IQDevice *> *)devices {
  NSError *error = nil;
  NSData *data = [NSKeyedArchiver archivedDataWithRootObject:devices requiringSecureCoding:YES error:&error];
  if (data == nil) {
    NSLog(@"[GarminLink] could not save devices: %@", error.localizedDescription);
    return;
  }
  [[NSUserDefaults standardUserDefaults] setObject:data forKey:kDefaultsKey];
}

- (NSArray<IQDevice *> *)loadDevices {
  NSData *data = [[NSUserDefaults standardUserDefaults] dataForKey:kDefaultsKey];
  if (data == nil) return @[];
  NSSet *classes = [NSSet setWithObjects:[NSArray class], [NSMutableArray class], [IQDevice class],
                                         [NSString class], [NSUUID class], nil];
  NSError *error = nil;
  id restored = [NSKeyedUnarchiver unarchivedObjectOfClasses:classes fromData:data error:&error];
  if (![restored isKindOfClass:[NSArray class]]) {
    NSLog(@"[GarminLink] could not restore devices: %@", error.localizedDescription);
    return @[];
  }
  NSMutableArray<IQDevice *> *out = [NSMutableArray array];
  for (id d in (NSArray *)restored) {
    if ([d isKindOfClass:[IQDevice class]]) [out addObject:d];
  }
  return out;
}

- (BOOL)isConnected:(NSUUID *)uuid {
  return _deviceStatus[uuid].integerValue == IQDeviceStatus_Connected;
}

- (void)statusChanged {
  NSMutableArray *list = [NSMutableArray array];
  for (IQDevice *device in _devices.allValues) {
    NSString *name = device.friendlyName.length > 0 ? device.friendlyName
                   : (device.modelName.length > 0 ? device.modelName : @"Garmin");
    [list addObject:@{
      @"platform": @"garmin",
      @"name": name,
      @"id": device.uuid.UUIDString,
      @"paired": @YES,
      @"installed": @(_installed[device.uuid].boolValue),
      @"reachable": @([self isConnected:device.uuid]),
    }];
  }
  @synchronized(self) { _statusSnapshot = [list copy]; }
  void (^cb)(void) = self.onStatusChange;
  if (cb) cb();
}

- (NSArray<NSDictionary<NSString *, id> *> *)status {
  @synchronized(self) { return _statusSnapshot; }
}

#pragma mark Sending

- (void)sendState:(NSString *)json {
  OnMain(^{
    if (self->_devices.count == 0) return;
    self->_lastState = json;
    NSTimeInterval since = self->_lastStateSentAt ? -[self->_lastStateSentAt timeIntervalSinceNow] : DBL_MAX;
    if (since >= kStateInterval) {
      [self flushState];
    } else if (!self->_stateTimerArmed) {
      self->_stateTimerArmed = YES;
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)((kStateInterval - since) * NSEC_PER_SEC)),
                     dispatch_get_main_queue(), ^{
        self->_stateTimerArmed = NO;
        [self flushState];
      });
    }
  });
}

- (void)flushState {
  NSString *json = _lastState;
  if (json == nil) return;
  _lastState = nil;
  _lastStateSentAt = [NSDate date];
  id value = [GarminLink garminValueFromJSON:json];
  if (value == nil) return;
  for (NSUUID *uuid in _apps) {
    // A state still being transferred is superseded by the next one anyway.
    if ([_stateInFlight containsObject:uuid]) continue;
    [_stateInFlight addObject:uuid];
    [self send:value to:uuid done:^{ [self->_stateInFlight removeObject:uuid]; }];
  }
}

- (void)sendEvent:(NSString *)json {
  OnMain(^{
    if (self->_devices.count == 0) return;
    id value = [GarminLink garminValueFromJSON:json];
    if (value == nil) return;
    for (NSUUID *uuid in self->_apps) [self send:value to:uuid done:nil];
  });
}

- (void)send:(id)value to:(NSUUID *)uuid done:(dispatch_block_t _Nullable)done {
  IQApp *app = _apps[uuid];
  if (app == nil || ![self isConnected:uuid] || [_installed[uuid] isEqual:@NO]) {
    if (done) done();
    return;
  }
  [[ConnectIQ sharedInstance] sendMessage:value toApp:app
      progress:^(uint32_t sentBytes, uint32_t totalBytes) {}
      completion:^(IQSendMessageResult result) {
        OnMain(^{
          if (result != IQSendMessageResult_Success) {
            NSLog(@"[GarminLink] send failed: %@", NSStringFromSendMessageResult(result));
          }
          if (done) done();
        });
      }];
}

#pragma mark IQUIOverrideDelegate

- (void)needsToInstallConnectMobile {
  // selectDevices checks for Garmin Connect first and reports it to JS, so
  // there is nothing to show here. Never bounce the user to the App Store.
  NSLog(@"[GarminLink] Garmin Connect Mobile is required");
}

#pragma mark IQDeviceEventDelegate

- (void)deviceStatusChanged:(IQDevice *)device status:(IQDeviceStatus)status {
  OnMain(^{
    if (device.uuid == nil || self->_devices[device.uuid] == nil) return;
    NSNumber *old = self->_deviceStatus[device.uuid];
    self->_deviceStatus[device.uuid] = @(status);
    if (status == IQDeviceStatus_Connected && old.integerValue != IQDeviceStatus_Connected) {
      [self refreshAppStatus:device];
    }
    [self statusChanged];
  });
}

#pragma mark IQAppMessageDelegate

- (void)receivedMessage:(id)message fromApp:(IQApp *)app {
  NSString *json = [GarminLink jsonFromGarminValue:message];
  OnMain(^{
    // A message proves the app is installed and the device connected.
    NSUUID *uuid = app.device.uuid;
    if (uuid != nil && self->_devices[uuid] != nil && ![self->_installed[uuid] isEqual:@YES]) {
      self->_installed[uuid] = @YES;
      [self statusChanged];
    }
    void (^cb)(NSString *) = self.onMessage;
    if (cb) cb(json);
  });
}

#pragma mark Conversion

+ (id)garminValueFromJSON:(NSString *)json {
  NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
  if (data == nil) return nil;
  NSError *error = nil;
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingFragmentsAllowed error:&error];
  if (parsed == nil) {
    NSLog(@"[GarminLink] bad JSON from JS: %@", error.localizedDescription);
    return nil;
  }
  return ToGarmin(parsed);
}

+ (NSString *)jsonFromGarminValue:(id)value {
  if ([value isKindOfClass:[NSString class]]) {
    NSString *trimmed = [(NSString *)value stringByTrimmingCharactersInSet:
                         [NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if ([trimmed hasPrefix:@"{"]) {
      NSData *data = [trimmed dataUsingEncoding:NSUTF8StringEncoding];
      id obj = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
      if ([obj isKindOfClass:[NSDictionary class]]) {
        NSData *out = [NSJSONSerialization dataWithJSONObject:obj options:0 error:nil];
        if (out) return [[NSString alloc] initWithData:out encoding:NSUTF8StringEncoding];
      }
    }
  }
  id j = ToJSONValue(value);
  NSData *out = [NSJSONSerialization dataWithJSONObject:j options:NSJSONWritingFragmentsAllowed error:nil];
  if (out == nil) return @"null";
  return [[NSString alloc] initWithData:out encoding:NSUTF8StringEncoding] ?: @"null";
}

@end
