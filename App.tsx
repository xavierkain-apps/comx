import React, {useState} from 'react';
import {StatusBar, View, LogBox} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

// Keep warnings visible in development; only silence them in release builds.
if (!__DEV__) {
  LogBox.ignoreAllLogs();
}
import {UserProvider} from './src/contexts/UserContext';
import {AgoraProvider} from './src/contexts/AgoraContext';
import {RideProvider} from './src/contexts/RideContext';
import {WatchProvider} from './src/contexts/WatchContext';
import {MemoProvider} from './src/contexts/MemoContext';
import {ThemeProvider} from './src/contexts/ThemeContext';
import {JoinScreen} from './src/screens/JoinScreen';
import {LiveScreen} from './src/screens/LiveScreen';
import {SettingsScreen} from './src/screens/SettingsScreen';
import {signal} from './src/theme';

type Screen = 'join' | 'live' | 'settings';

function AppContent() {
  const [screen, setScreen] = useState<Screen>('join');

  return (
    <View style={{flex: 1, backgroundColor: signal.bg}}>
      <StatusBar barStyle="light-content" backgroundColor={signal.bg} />
      {screen === 'join' && (
        <JoinScreen onJoined={() => setScreen('live')} onSettings={() => setScreen('settings')} />
      )}
      {screen === 'live' && <LiveScreen onLeft={() => setScreen('join')} />}
      {screen === 'settings' && <SettingsScreen onDone={() => setScreen('join')} />}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <UserProvider>
          <AgoraProvider>
            <RideProvider>
              <WatchProvider>
                <MemoProvider>
                  <AppContent />
                </MemoProvider>
              </WatchProvider>
            </RideProvider>
          </AgoraProvider>
        </UserProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
