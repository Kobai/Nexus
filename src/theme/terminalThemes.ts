import type { ITheme } from '@xterm/xterm';
import type { Theme } from '../store/themeStore';

const light: ITheme = {
  background: '#F9F7F5',
  foreground: '#3E2B1E',
  cursor: '#5D4432',
  cursorAccent: '#F9F7F5',
  selectionBackground: '#D9CFC8',
  black: '#3E2B1E',
  brightBlack: '#9E8E84',
  red: '#B8442F',
  brightRed: '#D65A42',
  green: '#5E8B4E',
  brightGreen: '#74A362',
  yellow: '#B7791F',
  brightYellow: '#D69A2D',
  blue: '#4C6F8F',
  brightBlue: '#5F87AB',
  magenta: '#8A5A7A',
  brightMagenta: '#A46F93',
  cyan: '#3F8079',
  brightCyan: '#529A92',
  white: '#7A6B61',
  brightWhite: '#5D4432',
};

const dark: ITheme = {
  background: '#1C1511',
  foreground: '#F0E6DC',
  cursor: '#D6B292',
  cursorAccent: '#1C1511',
  selectionBackground: '#4A3A2F',
  black: '#2A2019',
  brightBlack: '#7D6B5E',
  red: '#E0745F',
  brightRed: '#F08C77',
  green: '#9DBE86',
  brightGreen: '#B3D19C',
  yellow: '#E5B567',
  brightYellow: '#F2C983',
  blue: '#8DB0CE',
  brightBlue: '#A6C4DE',
  magenta: '#C79ABA',
  brightMagenta: '#D9B1CD',
  cyan: '#7FBDB4',
  brightCyan: '#98D0C8',
  white: '#CDBDAE',
  brightWhite: '#F0E6DC',
};

export const terminalTheme = (t: Theme): ITheme => (t === 'dark' ? dark : light);
export const terminalBackground = (t: Theme) => terminalTheme(t).background!;
