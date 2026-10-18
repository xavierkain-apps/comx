// ComX "Signal · Radar" design system (design_handoff_comx_signal_radar).
// One dark palette, no light mode. Teal = normal or listening, yellow =
// someone speaking, red = SOS.

import {TextStyle} from 'react-native';

type StatusBarStyle = 'light-content' | 'dark-content';

export const signal = {
  bg: '#071518',
  surface: '#0F2327',
  surfaceAlt: '#12282C',
  ring: '#16343A',
  outline: '#2A4448',
  text: '#EAF4F3',
  textMuted: '#7FA3A6',
  textDim: '#4E7276',
  teal: '#2ED3C4',
  yellow: '#FFD23F',
  /** Halo around a speaking badge. */
  yellowHalo: 'rgba(255, 210, 63, 0.2)',
  red: '#FF453A',
  /** Warnings (reconnecting, banners). Same as the watch Theme.amber. */
  amber: '#FFB020',
  /** Text and icons on a teal or yellow fill. */
  onAccent: '#071518',
} as const;

// Legacy token names used by SettingsScreen, mapped onto the Signal palette.
// No `as const`: values widen to string.
const darkColors = {
  primary: signal.teal as string,
  primaryDark: '#22A89C',
  primaryLight: 'rgba(46, 211, 196, 0.12)',
  primaryBorder: 'rgba(46, 211, 196, 0.25)',
  primaryGlow: 'rgba(46, 211, 196, 0.40)',
  bg: signal.bg as string,
  bgCard: signal.surface as string,
  bgCardActive: signal.surfaceAlt as string,
  bgInput: signal.surfaceAlt as string,
  green: signal.teal as string,
  greenLight: 'rgba(46, 211, 196, 0.15)',
  red: signal.red as string,
  redLight: 'rgba(255, 69, 58, 0.12)',
  redGlow: 'rgba(255, 69, 58, 0.40)',
  amber: signal.amber as string,
  white: signal.text as string,
  text: signal.text as string,
  textSecondary: signal.textMuted as string,
  textMuted: signal.textMuted as string,
  textDim: signal.textDim as string,
  cardBorder: 'rgba(234, 244, 243, 0.06)',
  statusBar: 'light-content' as StatusBarStyle,
};

export type ThemeColors = typeof darkColors;
export const colors = darkColors;

// Bundled from assets/fonts (OFL). The family name is the file name, which is
// also the PostScript name iOS looks up. Never add fontWeight next to these:
// the weight is part of the family, and Android would fake a bold.
export const fontFamily = {
  condensed600: 'BarlowCondensed-SemiBold',
  condensed700: 'BarlowCondensed-Bold',
  condensed800: 'BarlowCondensed-ExtraBold',
  plain500: 'Barlow-Medium',
  plain600: 'Barlow-SemiBold',
  plain700: 'Barlow-Bold',
} as const;

/** Headings, names, distances, button labels: Barlow Condensed, uppercase. */
export function condensed(size: number, weight: 600 | 700 | 800 = 800, letterSpacing = 0): TextStyle {
  return {
    fontFamily: fontFamily[`condensed${weight}` as const],
    fontSize: size,
    letterSpacing,
    textTransform: 'uppercase',
  };
}

/** Secondary sentences ("Riding as …", "No GPS", "Voice, 6 s"): Barlow. */
export function plain(size: number, weight: 500 | 600 | 700 = 600): TextStyle {
  return {fontFamily: fontFamily[`plain${weight}` as const], fontSize: size};
}

export const fonts = {
  xs: 11,
  sm: 13,
  body: 15,
  input: 16,
  button: 17,
  title: 24,
  heading: 20,
  logo: 38,
  label: 12,
  small: 11,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 9999,
} as const;
