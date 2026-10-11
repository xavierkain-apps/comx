#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Garmin watches on iOS, through Garmin's Connect IQ iOS companion SDK.
/// See docs/watch-ios.md ("Garmin on iOS") and docs/watch-companion.md.
///
/// Written in Objective-C on purpose: it calls the SDK exactly as its headers
/// declare it, with no guessing of Swift-imported names.
///
/// Unlike Android, the SDK cannot discover watches. The user picks them in
/// Garmin Connect Mobile (`selectDevices`), which returns to ComX through the
/// `comx-ciq` URL scheme (`handleURL:`). The chosen devices are kept in
/// UserDefaults and re-registered at every launch. The SDK is only initialised
/// once the user has asked for Garmin, so riders without a Garmin never see a
/// Bluetooth prompt caused by it.
///
/// Every method may be called from any thread.
NS_SWIFT_NAME(GarminLink)
@interface GarminLink : NSObject

@property (class, nonatomic, readonly) GarminLink *shared;

/// The URL scheme Garmin Connect uses to return the device selection.
@property (class, nonatomic, readonly) NSString *urlScheme;

/// JSON string of every message a Garmin watch sends (converted from the
/// Connect IQ dictionary). Called on the main thread.
@property (atomic, copy, nullable) void (^onMessage)(NSString *json);

/// Devices, connection or app-installed state changed. Main thread.
@property (atomic, copy, nullable) void (^onStatusChange)(void);

/// At launch: initialises the SDK and re-registers saved devices, but only if
/// the user selected Garmin devices before. Idempotent.
- (void)startIfConfigured;

/// Opens Garmin Connect Mobile on its device-selection screen. Completion gets
/// nil once Garmin Connect was asked to open, or an error message (Garmin
/// Connect not installed). Completion runs on the main thread.
- (void)selectDevicesWithCompletion:(void (^)(NSString *_Nullable error))completion
    NS_SWIFT_NAME(selectDevices(completion:));

/// Returns YES when the URL is Garmin Connect's reply (our scheme) and was
/// handled. Call from application:openURL:options: on the main thread.
- (BOOL)handleURL:(NSURL *)url NS_SWIFT_NAME(handle(url:));

/// Latest-wins state, throttled to one message every 5 s per the contract.
- (void)sendState:(NSString *)json;

/// Events go out at once.
- (void)sendEvent:(NSString *)json;

/// One WatchStatus dictionary per selected Garmin device:
/// {platform: "garmin", name, paired, installed, reachable, id}.
- (NSArray<NSDictionary<NSString *, id> *> *)status;

/// JSON document -> Connect IQ values (NSDictionary / NSArray / NSString /
/// NSNumber). Null members of objects are dropped (Monkey C reads a missing
/// key as null); nulls inside arrays are kept as NSNull. Nil on bad JSON.
+ (nullable id)garminValueFromJSON:(NSString *)json;

/// Value received from a watch -> JSON string. A string that already holds a
/// JSON object is passed through. Mirrors Android's GarminJson.fromGarmin.
+ (NSString *)jsonFromGarminValue:(nullable id)value;

@end

NS_ASSUME_NONNULL_END
