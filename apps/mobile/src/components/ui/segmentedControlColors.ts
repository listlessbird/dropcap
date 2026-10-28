import { flattenThemeColor, themeColorWithAlpha, themeColorWithContrast } from "../../lib/color";
import type { ThemeAppearance, ThemeId, ThemeVariables } from "../../lib/theme";
import type { SegmentedControlProps } from "./SegmentedControl.types";

/** Track and selection colors that keep labels readable on either surface variant. */
export function segmentedControlColors(
  colors: ThemeVariables,
  appearance: ThemeAppearance,
  variant: SegmentedControlProps<string>["variant"],
  themeId: ThemeId,
) {
  const dark = appearance === "dark";
  const card = variant === "card";

  const accent =
    colors[themeId === "material-you" ? "--color-primary" : "--color-prominent-action"];

  const trackColor = card
    ? dark
      ? colors["--color-screen"]
      : flattenThemeColor(
          themeColorWithAlpha(colors["--color-foreground"], 0.07),
          colors["--color-grouped-card"],
        )
    : flattenThemeColor(themeColorWithAlpha(accent, dark ? 0.1 : 0.07), colors["--color-screen"]);

  const selectedColor = dark
    ? flattenThemeColor(themeColorWithAlpha(accent, 0.32), colors["--color-screen"])
    : card
      ? colors["--color-screen"]
      : colors["--color-secondary"];

  const selectedTextColor =
    colors[!card && dark ? "--color-foreground" : "--color-secondary-foreground"];

  return {
    trackColor,
    selectedColor,
    selectedTextColor: themeColorWithContrast(selectedTextColor, selectedColor),
    mutedColor: themeColorWithContrast(
      colors["--color-foreground-muted"],
      trackColor,
      dark && !card ? 7 : 4.5,
    ),
  };
}
