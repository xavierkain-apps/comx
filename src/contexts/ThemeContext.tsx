// ComX has a single "Signal" palette (src/theme.ts). The provider stays so
// SettingsScreen keeps reading colours through useTheme().

import React, {createContext, useContext, ReactNode} from 'react';
import {colors, ThemeColors} from '../theme';

interface ThemeContextValue {
  colors: ThemeColors;
}

const value: ThemeContextValue = {colors};
const ThemeContext = createContext<ThemeContextValue>(value);

export function ThemeProvider({children}: {children: ReactNode}) {
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
