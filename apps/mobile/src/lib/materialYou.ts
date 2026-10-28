import { getMaterialColors, isDynamicColorAvailable } from "@expo/ui/jetpack-compose";

import { BRAND_THEME, withAlpha, type ThemeAppearance, type ThemeVariables } from "./theme";

type MaterialPalette = ReturnType<typeof getMaterialColors>;

export type MaterialYouPalettes = Readonly<Record<ThemeAppearance, MaterialPalette>>;

/** False before Android 12, where the system has no wallpaper palette. */
export const isMaterialYouAvailable = isDynamicColorAvailable;

export function readMaterialYouPalettes(): MaterialYouPalettes | null {
  if (!isDynamicColorAvailable) return null;

  return {
    light: getMaterialColors({ scheme: "light" }),
    dark: getMaterialColors({ scheme: "dark" }),
  };
}

/** Fills the app's roles from the wallpaper palette. Roles Material has no answer for keep the brand value. */
export function materialYouVariables(
  palette: MaterialPalette,
  appearance: ThemeAppearance,
): ThemeVariables {
  const dark = appearance === "dark";

  return {
    ...BRAND_THEME[appearance],
    "--color-screen": palette.surface,
    "--color-sheet": withAlpha(palette.surfaceContainerLow, 0.98),
    "--color-sheet-solid": palette.surfaceContainerLow,
    "--color-card": palette.surfaceContainer,
    "--color-card-alt": palette.surfaceContainerHigh,
    "--color-grouped-card": palette.surfaceContainer,
    "--color-row-hover": palette.surfaceContainerHigh,
    "--color-foreground": palette.onSurface,
    "--color-foreground-secondary": palette.onSurfaceVariant,
    "--color-foreground-muted": palette.onSurfaceVariant,
    "--color-foreground-tertiary": withAlpha(palette.onSurfaceVariant, 0.58),
    "--color-border": withAlpha(palette.outlineVariant, dark ? 0.5 : 0.65),
    "--color-border-subtle": withAlpha(palette.outlineVariant, dark ? 0.34 : 0.46),
    "--color-separator": withAlpha(palette.outlineVariant, dark ? 0.24 : 0.34),
    "--color-focus": palette.primary,
    "--color-subtle": withAlpha(palette.onSurface, 0.05),
    "--color-subtle-strong": withAlpha(palette.onSurface, 0.1),
    "--color-primary": palette.primary,
    "--color-primary-foreground": palette.onPrimary,
    "--color-primary-text": palette.primary,
    "--color-prominent-action": palette.primary,
    "--color-prominent-action-foreground": palette.onPrimary,
    "--color-secondary": palette.secondaryContainer,
    "--color-secondary-foreground": palette.onSecondaryContainer,
    "--color-secondary-border": withAlpha(palette.outlineVariant, dark ? 0.42 : 0.56),
    "--color-switch-active-track": palette.primary,
    "--color-switch-active-thumb": palette.onPrimary,
    "--color-switch-inactive-track": palette.surfaceContainerHighest,
    "--color-switch-inactive-thumb": palette.outline,
    "--color-danger": palette.errorContainer,
    "--color-danger-border": withAlpha(palette.onErrorContainer, dark ? 0.42 : 0.5),
    "--color-danger-foreground": palette.onErrorContainer,
    "--color-input": palette.surfaceContainerLowest,
    "--color-input-border": withAlpha(palette.outline, dark ? 0.42 : 0.5),
    "--color-placeholder": withAlpha(palette.onSurface, 0.62),
    "--color-icon": palette.onSurface,
    "--color-icon-muted": palette.onSurfaceVariant,
    "--color-icon-subtle": withAlpha(palette.onSurfaceVariant, 0.68),
    "--color-header": palette.surfaceContainerHigh,
    "--color-header-foreground": palette.onSurface,
    "--color-header-border": withAlpha(palette.outlineVariant, dark ? 0.36 : 0.48),
    "--color-status-bar": palette.surfaceContainerLow,
    "--color-backdrop": withAlpha(palette.scrim, dark ? 0.48 : 0.22),
    "--color-chevron": withAlpha(palette.onSurface, 0.2),
  };
}
