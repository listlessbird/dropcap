export const THEME_APPEARANCES = ["light", "dark"] as const;

export type ThemeAppearance = (typeof THEME_APPEARANCES)[number];

export const THEME_IDS = ["kindle-drop", "material-you"] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME_ID: ThemeId = "kindle-drop";

export const THEME_OPTIONS: ReadonlyArray<{ readonly id: ThemeId; readonly label: string }> = [
  { id: "kindle-drop", label: "Kindle Drop" },
  { id: "material-you", label: "Material You" },
];

// The brand palette, as semantic roles. Every theme fills the same roles, and components only read
// roles (`bg-card`, `text-foreground-muted`), never raw colors. React Native has no OKLCH, so
// values are sRGB.
const LIGHT = {
  "--color-screen": "#fafafa",
  "--color-sheet": "rgba(255, 255, 255, 0.98)",
  "--color-sheet-solid": "#ffffff",
  "--color-card": "#ffffff",
  "--color-card-alt": "#f4f4f5",
  "--color-grouped-card": "#ffffff",
  "--color-row-hover": "#f4f4f5",
  "--color-foreground": "#18181b",
  "--color-foreground-secondary": "#52525b",
  "--color-foreground-muted": "#71717a",
  "--color-foreground-tertiary": "#a1a1aa",
  "--color-border": "#e4e4e7",
  "--color-border-subtle": "rgba(228, 228, 231, 0.7)",
  "--color-separator": "rgba(228, 228, 231, 0.55)",
  "--color-focus": "#0891b2",
  "--color-subtle": "#f4f4f5",
  "--color-subtle-strong": "#e4e4e7",
  "--color-primary": "#0891b2",
  "--color-primary-foreground": "#ffffff",
  "--color-primary-text": "#0e7490",
  "--color-prominent-action": "#18181b",
  "--color-prominent-action-foreground": "#fafafa",
  "--color-secondary": "#f4f4f5",
  "--color-secondary-foreground": "#18181b",
  "--color-secondary-border": "#e4e4e7",
  "--color-switch-active-track": "#0891b2",
  "--color-switch-active-thumb": "#ffffff",
  "--color-switch-inactive-track": "#e4e4e7",
  "--color-switch-inactive-thumb": "#71717a",
  "--color-positive": "#16a34a",
  "--color-warning": "#fffbeb",
  "--color-warning-border": "rgba(217, 119, 6, 0.32)",
  "--color-warning-foreground": "#b45309",
  "--color-danger": "#fef2f2",
  "--color-danger-border": "rgba(220, 38, 38, 0.32)",
  "--color-danger-foreground": "#b91c1c",
  "--color-input": "#ffffff",
  "--color-input-border": "#d4d4d8",
  "--color-placeholder": "#71717a",
  "--color-icon": "#18181b",
  "--color-icon-muted": "#71717a",
  "--color-icon-subtle": "#a1a1aa",
  "--color-header": "#f4f4f5",
  "--color-header-foreground": "#18181b",
  "--color-header-border": "#e4e4e7",
  "--color-status-bar": "#fafafa",
  "--color-backdrop": "rgba(0, 0, 0, 0.22)",
  "--color-chevron": "rgba(113, 113, 122, 0.42)",
};

export type ThemeToken = keyof typeof LIGHT;

export type ThemeVariables = Readonly<Record<ThemeToken, string>>;

const DARK: ThemeVariables = {
  "--color-screen": "#09090b",
  "--color-sheet": "rgba(24, 24, 27, 0.98)",
  "--color-sheet-solid": "#18181b",
  "--color-card": "#18181b",
  "--color-card-alt": "#27272a",
  "--color-grouped-card": "#18181b",
  "--color-row-hover": "#27272a",
  "--color-foreground": "#fafafa",
  "--color-foreground-secondary": "#d4d4d8",
  "--color-foreground-muted": "#a1a1aa",
  "--color-foreground-tertiary": "#71717a",
  "--color-border": "#27272a",
  "--color-border-subtle": "rgba(39, 39, 42, 0.7)",
  "--color-separator": "rgba(63, 63, 70, 0.55)",
  "--color-focus": "#22d3ee",
  "--color-subtle": "#18181b",
  "--color-subtle-strong": "#27272a",
  "--color-primary": "#06b6d4",
  "--color-primary-foreground": "#083344",
  "--color-primary-text": "#22d3ee",
  "--color-prominent-action": "#fafafa",
  "--color-prominent-action-foreground": "#09090b",
  "--color-secondary": "#27272a",
  "--color-secondary-foreground": "#fafafa",
  "--color-secondary-border": "#3f3f46",
  "--color-switch-active-track": "#06b6d4",
  "--color-switch-active-thumb": "#083344",
  "--color-switch-inactive-track": "#3f3f46",
  "--color-switch-inactive-thumb": "#a1a1aa",
  "--color-positive": "#4ade80",
  "--color-warning": "rgba(120, 53, 15, 0.4)",
  "--color-warning-border": "rgba(251, 191, 36, 0.32)",
  "--color-warning-foreground": "#fcd34d",
  "--color-danger": "rgba(127, 29, 29, 0.4)",
  "--color-danger-border": "rgba(248, 113, 113, 0.32)",
  "--color-danger-foreground": "#fca5a5",
  "--color-input": "#18181b",
  "--color-input-border": "#3f3f46",
  "--color-placeholder": "#a1a1aa",
  "--color-icon": "#fafafa",
  "--color-icon-muted": "#a1a1aa",
  "--color-icon-subtle": "#71717a",
  "--color-header": "#18181b",
  "--color-header-foreground": "#fafafa",
  "--color-header-border": "#27272a",
  "--color-status-bar": "#09090b",
  "--color-backdrop": "rgba(0, 0, 0, 0.48)",
  "--color-chevron": "rgba(161, 161, 170, 0.42)",
};

export const BRAND_THEME: Readonly<Record<ThemeAppearance, ThemeVariables>> = {
  light: LIGHT,
  dark: DARK,
};

export const THEME_TOKENS = Object.keys(LIGHT).filter((key): key is ThemeToken => key in LIGHT);

/** `#rrggbb` or `#rrggbbaa` with its alpha replaced. Other formats pass through unchanged. */
export function withAlpha(color: string, alpha: number): string {
  const hex = /^#([\da-f]{6})(?:[\da-f]{2})?$/iu.exec(color)?.[1];

  if (!hex) return color;

  const channel = (offset: number) => Number.parseInt(hex.slice(offset, offset + 2), 16);

  return `rgba(${channel(0)}, ${channel(2)}, ${channel(4)}, ${alpha})`;
}
