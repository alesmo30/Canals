import { alpha, createTheme } from '@mui/material/styles';

/**
 * Canals brand palette, read from https://www.canals.ai/ CSS custom
 * properties (specs/08-observability-console.md, "Visual design"). The
 * only place hex values live — components use theme tokens.
 */
export const brand = {
  blue500: '#1355FF',
  blue100: '#E1E9FE',
  blue50: '#F5F9FF',
  navy800: '#061237',
  navy700: '#0B1A46',
  navy600: '#18264E',
  grey100: '#F9F9FB',
  grey400: '#E9EDF2',
  grey500: '#B6BCCE',
  grey600: '#33373D',
  grey: '#515561',
  black300: '#6B7280',
  green: '#0E9F6E',
  purple: '#4058FF',
  amber: '#A46200',
  red: '#D92D20',
} as const;

declare module '@mui/material/styles' {
  interface Palette {
    navy: { dark: string; mid: string; main: string };
    surface: { subtle: string };
  }
  interface PaletteOptions {
    navy?: { dark: string; mid: string; main: string };
    surface?: { subtle: string };
  }
}

export const fonts = {
  serif: '"Playfair Display", Georgia, serif',
  sans: 'Raleway, "Helvetica Neue", Arial, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
};

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: brand.blue500, light: brand.blue100, contrastText: '#fff' },
    secondary: { main: brand.purple, contrastText: '#fff' },
    success: { main: brand.green, contrastText: '#fff' },
    warning: { main: brand.amber, contrastText: '#fff' },
    error: { main: brand.red, contrastText: '#fff' },
    background: { default: brand.grey100, paper: '#FFFFFF' },
    text: {
      primary: brand.grey600,
      secondary: brand.grey,
      disabled: brand.black300,
    },
    divider: brand.grey400,
    navy: { dark: brand.navy800, mid: brand.navy700, main: brand.navy600 },
    surface: { subtle: brand.blue50 },
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily: fonts.sans,
    h1: { fontFamily: fonts.serif, fontWeight: 600, color: brand.navy800 },
    h2: { fontFamily: fonts.serif, fontWeight: 600, color: brand.navy800 },
    h3: { fontFamily: fonts.serif, fontWeight: 600, color: brand.navy800 },
    h4: {
      fontFamily: fonts.serif,
      fontWeight: 600,
      fontSize: '1.9rem',
      color: brand.navy800,
    },
    h5: { fontFamily: fonts.serif, fontWeight: 600, color: brand.navy800 },
    h6: { fontWeight: 700, fontSize: '1rem', color: brand.navy800 },
    subtitle2: { fontWeight: 700, letterSpacing: 0.2 },
    overline: { fontWeight: 700, letterSpacing: 1.2 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: brand.grey100 },
        code: { fontFamily: fonts.mono },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { backgroundImage: 'none' },
        outlined: { borderColor: brand.grey400 },
      },
    },
    MuiCard: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: { root: { borderRadius: 12 } },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        notchedOutline: { borderColor: brand.grey500 },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontWeight: 700,
          color: brand.grey,
          backgroundColor: brand.grey100,
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&.MuiTableRow-hover:hover': {
            backgroundColor: alpha(brand.blue100, 0.6),
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: { root: { fontWeight: 600 } },
    },
  },
});
