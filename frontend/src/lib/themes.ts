export type ThemeKey = 'slate' | 'midnight' | 'sandstone' | 'forest'

export interface Theme {
  label: string
  dark: boolean
  topbar: string
  topbarText: string
  sidebar: string
  sidebarText: string
  sidebarHover: string
  sidebarActive: string
  bg: string
  surface: string
  border: string
  borderLight: string
  text: string
  textSecondary: string
  muted: string
  accent: string
  accentHover: string
  info: string
  success: string
  danger: string
  font: string
}

export const THEMES: Record<ThemeKey, Theme> = {
  slate: {
    label: 'Slate',
    dark: false,
    topbar: '#1c2733',
    topbarText: '#ffffff',
    sidebar: '#26313d',
    sidebarText: '#aebac6',
    sidebarHover: '#324152',
    sidebarActive: '#3c4d61',
    bg: '#eef1f4',
    surface: '#ffffff',
    border: '#d7dde3',
    borderLight: '#e9edf1',
    text: '#161b22',
    textSecondary: '#4b5563',
    muted: '#8a95a1',
    accent: '#2f6fed',
    accentHover: '#255bc7',
    info: '#2f6fed',
    success: '#1a8a4c',
    danger: '#d1372f',
    font: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  },
  midnight: {
    label: 'Midnight',
    dark: true,
    topbar: '#0c0f14',
    topbarText: '#f4f6f8',
    sidebar: '#12161d',
    sidebarText: '#9aa4b2',
    sidebarHover: '#1c222c',
    sidebarActive: '#252c38',
    bg: '#0c0f14',
    surface: '#151a22',
    border: '#252c38',
    borderLight: '#1c222c',
    text: '#e7ebf0',
    textSecondary: '#9aa4b2',
    muted: '#6b7684',
    accent: '#7c9eff',
    accentHover: '#93aeff',
    info: '#7c9eff',
    success: '#4fd08a',
    danger: '#f0685f',
    font: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  },
  sandstone: {
    label: 'Sandstone',
    dark: false,
    topbar: '#3a2f27',
    topbarText: '#fbf6ee',
    sidebar: '#4a3c30',
    sidebarText: '#d9c9b7',
    sidebarHover: '#5a4a3c',
    sidebarActive: '#6a5849',
    bg: '#f7f1e8',
    surface: '#fffcf7',
    border: '#e4d7c4',
    borderLight: '#efe6d8',
    text: '#2b2118',
    textSecondary: '#6b5c4c',
    muted: '#948572',
    accent: '#c0623a',
    accentHover: '#a54f2c',
    info: '#4f7a8b',
    success: '#5c8a4a',
    danger: '#b8402f',
    font: "Georgia, 'Times New Roman', serif",
  },
  forest: {
    label: 'Forest',
    dark: false,
    topbar: '#16241f',
    topbarText: '#f1f7f3',
    sidebar: '#1d2f28',
    sidebarText: '#b9cdc2',
    sidebarHover: '#274036',
    sidebarActive: '#325043',
    bg: '#eef3ee',
    surface: '#ffffff',
    border: '#d3e0d5',
    borderLight: '#e6eee7',
    text: '#152018',
    textSecondary: '#4d5f52',
    muted: '#84958a',
    accent: '#2f8a5b',
    accentHover: '#25714a',
    info: '#2f6b8a',
    success: '#2f8a5b',
    danger: '#c0433a',
    font: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  },
}

export const THEME_ORDER: ThemeKey[] = ['slate', 'midnight', 'sandstone', 'forest']

const CSS_VAR_BY_KEY: Record<
  Exclude<keyof Theme, 'label' | 'font' | 'dark'>,
  string
> = {
  topbar: '--color-topbar',
  topbarText: '--color-topbar-text',
  sidebar: '--color-sidebar',
  sidebarText: '--color-sidebar-text',
  sidebarHover: '--color-sidebar-hover',
  sidebarActive: '--color-sidebar-active',
  bg: '--color-bg',
  surface: '--color-surface',
  border: '--color-border',
  borderLight: '--color-border-light',
  text: '--color-text',
  textSecondary: '--color-text-secondary',
  muted: '--color-muted',
  accent: '--color-accent',
  accentHover: '--color-accent-hover',
  info: '--color-info',
  success: '--color-success',
  danger: '--color-danger',
}

export function applyTheme(key: ThemeKey): void {
  const theme = THEMES[key]
  const root = document.documentElement

  for (const [prop, cssVar] of Object.entries(CSS_VAR_BY_KEY)) {
    root.style.setProperty(cssVar, theme[prop as keyof typeof CSS_VAR_BY_KEY])
  }
  root.style.setProperty('--font-sans', theme.font)
  root.style.colorScheme = theme.dark ? 'dark' : 'light'
  root.dataset.theme = key
}
