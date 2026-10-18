/* Mocks for native modules that have no JS implementation under Jest. */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// '@env' is produced by the babel dotenv plugin, so it needs a virtual mock.
jest.mock('@env', () => ({AGORA_APP_ID: 'test-app-id'}), {virtual: true});

jest.mock('react-native-sound', () => {
  class Sound {
    constructor(_name, _basePath, cb) {
      if (cb) cb(null);
    }
    play(cb) {
      if (cb) cb(true);
    }
    release() {}
  }
  Sound.MAIN_BUNDLE = 'main';
  return Sound;
});

jest.mock('react-native-agora', () => ({
  __esModule: true,
  default: jest.fn(),
  createAgoraRtcEngine: jest.fn(() => ({
    initialize: jest.fn(),
    setChannelProfile: jest.fn(),
    setClientRole: jest.fn(),
    setAudioProfile: jest.fn(),
    addListener: jest.fn(),
    enableAudioVolumeIndication: jest.fn(),
    joinChannel: jest.fn(),
    leaveChannel: jest.fn(),
    release: jest.fn(),
    muteLocalAudioStream: jest.fn(),
  })),
  ChannelProfileType: {ChannelProfileCommunication: 0},
  ClientRoleType: {ClientRoleBroadcaster: 1},
  AudioProfileType: {AudioProfileSpeechStandard: 1},
  AudioScenarioType: {AudioScenarioChatroom: 5},
  AudioSessionOperationRestriction: {
    AudioSessionOperationRestrictionNone: 0,
    AudioSessionOperationRestrictionAll: 127,
  },
  AudioFileRecordingType: {AudioFileRecordingMic: 1, AudioFileRecordingPlayback: 2},
  AudioRecordingQualityType: {AudioRecordingQualityLow: 0},
  AudioMixingStateType: {
    AudioMixingStatePlaying: 710,
    AudioMixingStateStopped: 713,
    AudioMixingStateFailed: 714,
  },
}));

jest.mock('@react-native-community/geolocation', () => ({
  __esModule: true,
  default: {
    setRNConfiguration: jest.fn(),
    requestAuthorization: jest.fn(success => success()),
    watchPosition: jest.fn(() => 1),
    clearWatch: jest.fn(),
  },
}));

// The library's own jest/mock.tsx is not transformed by the react-native preset.
jest.mock('react-native-safe-area-context', () => {
  const insets = {top: 0, right: 0, bottom: 0, left: 0};
  return {
    SafeAreaProvider: ({children}) => children,
    useSafeAreaInsets: () => insets,
  };
});
