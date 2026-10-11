import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // Activate the watch link before React Native loads so clips and messages
    // the watch sends meanwhile are buffered rather than dropped. This also
    // re-registers the Garmin watches picked earlier (none: Garmin stays off).
    WatchHub.shared.activate()

    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "SoarXVoice",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }

  // Handle URL scheme: soarxvoice://toggle
  func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey : Any] = [:]) -> Bool {
    // Garmin Connect returning the watches the user picked (comx-ciq://...).
    if GarminLink.shared.handle(url: url) {
      return true
    }
    NSLog("[HID] 🔗 URL scheme received: \(url.absoluteString)")
    if url.scheme == "soarxvoice" && url.host == "toggle" {
      NSLog("[HID] 🎯 URL scheme toggle → mute")
      HIDModule.handleKeyPress(keyCode: "urlScheme-toggle")
      return true
    }
    return false
  }

  // Capture ALL button/key presses from Bluetooth HID devices
  override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    var handled = false

    for press in presses {
      let pressType = press.type.rawValue
      let keyCode = press.key?.keyCode.rawValue ?? -1
      let chars = press.key?.charactersIgnoringModifiers ?? "none"

      NSLog("[HID] 🔘 pressesBegan type=\(pressType) keyCode=\(keyCode) chars=\(chars) phase=\(press.phase.rawValue)")

      // Handle specific press types that AssistiveTouch can generate
      switch press.type {
      case .menu:
        // "Menu" action from AssistiveTouch → toggle mute
        NSLog("[HID] 🎯 Menu button detected → toggle mute")
        HIDModule.handleKeyPress(keyCode: "assistiveTouch-menu")
        handled = true

      case .playPause:
        // "Play/Pause" action → toggle mute
        NSLog("[HID] 🎯 PlayPause button detected → toggle mute")
        HIDModule.handleKeyPress(keyCode: "assistiveTouch-playPause")
        handled = true

      case .select:
        // "Select" action → toggle mute
        NSLog("[HID] 🎯 Select button detected → toggle mute")
        HIDModule.handleKeyPress(keyCode: "assistiveTouch-select")
        handled = true

      default:
        // Any other key/button press
        NSLog("[HID] 🎯 Key press detected → toggle mute")
        HIDModule.handleKeyPress(keyCode: "press-type\(pressType)-key\(keyCode)-\(chars)")
      }
    }

    // Don't call super for menu/playPause to prevent iOS from
    // navigating back or triggering system actions
    if !handled {
      super.pressesBegan(presses, with: event)
    }
  }

  override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    var handled = false
    for press in presses {
      let pressType = press.type.rawValue
      NSLog("[HID] pressesEnded type=\(pressType)")
      if press.type == .menu || press.type == .playPause || press.type == .select {
        handled = true
      }
    }
    if !handled {
      super.pressesEnded(presses, with: event)
    }
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
    // Always use pre-bundled JS to avoid "Connect to Metro" banner
    // To use Metro for development, comment the line below and uncomment the #if block
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    // #if DEBUG
    //   RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
    // #else
    //   Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    // #endif
  }
}
