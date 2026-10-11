import React, {useState} from 'react';
import {StatusBar, View, LogBox} from 'react-native';

// Keep warnings visible in development; only silence them in release builds.
if (!__DEV__) {
  LogBox.ignoreAllLogs();
}
import {UserProvider} from './src/contexts/UserContext';
import {AgoraProvider} from './src/contexts/AgoraContext';
import {RideProvider} from './src/contexts/RideContext';
import {WatchProvider} from './src/contexts/WatchContext';
import {ThemeProvider, useTheme} from './src/contexts/ThemeContext';
import {HomeScreen} from './src/screens/HomeScreen';
import {VoiceScreen} from './src/screens/VoiceScreen';
import {SettingsScreen} from './src/screens/SettingsScreen';

type Screen = 'home' | 'voice' | 'settings';

function AppContent() {
  const [screen, setScreen] = useState<Screen>('home');
  const {colors} = useTheme();

  return (
    <View style={{flex: 1, backgroundColor: colors.bg}}>
      <StatusBar barStyle={colors.statusBar} backgroundColor={colors.bg} />
      {screen === 'home' && (
        <HomeScreen
          onJoined={() => setScreen('voice')}
          onSettings={() => setScreen('settings')}
        />
      )}
      {screen === 'voice' && (
        <VoiceScreen onLeft={() => setScreen('home')} />
      )}
      {screen === 'settings' && (
        <SettingsScreen onDone={() => setScreen('home')} />
      )}
    </View>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <UserProvider>
        <AgoraProvider>
          <RideProvider>
            <WatchProvider>
              <AppContent />
            </WatchProvider>
          </RideProvider>
        </AgoraProvider>
      </UserProvider>
    </ThemeProvider>
  );
}
