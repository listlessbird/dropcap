import { useAppearance } from "../../features/settings/appearance/AppearanceProvider";

/** The active palette for native controls that cannot read Uniwind classes. */
export function useControlTheme() {
  const { themeId, appearance, variables, materialYouAvailable } = useAppearance();

  return {
    themeId,
    colorScheme: appearance,
    colors: variables,
    materialYouActive: themeId === "material-you" && materialYouAvailable,
  };
}
