import { Host } from "@expo/ui/jetpack-compose";
import type { ComponentProps } from "react";

import { useControlTheme } from "./useControlTheme";

/**
 * A Compose host in the app's light or dark scheme. Compose derives its palette from the brand
 * primary, or from the wallpaper under Material You. Kit components pass explicit colors where the
 * derived palette would differ from the app's.
 */
export function NativeThemeHost(
  props: Omit<ComponentProps<typeof Host>, "colorScheme" | "seedColor">,
) {
  const { colors, colorScheme, materialYouActive } = useControlTheme();

  return (
    <Host
      {...props}
      colorScheme={colorScheme}
      seedColor={materialYouActive ? undefined : colors["--color-primary"]}
    />
  );
}
