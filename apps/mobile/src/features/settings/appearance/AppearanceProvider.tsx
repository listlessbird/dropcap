import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import { createContext, use, type ReactNode } from "react";
import { AppState, Appearance, StatusBar, useColorScheme } from "react-native";
import { ScopedTheme, ScopedVariables } from "uniwind";

import {
  isMaterialYouAvailable,
  materialYouVariables,
  readMaterialYouPalettes,
  type MaterialYouPalettes,
} from "../../../lib/materialYou";
import {
  BRAND_THEME,
  DEFAULT_THEME_ID,
  type ThemeAppearance,
  type ThemeId,
  type ThemeVariables,
} from "../../../lib/theme";
import type { Preferences, ThemeMode } from "../../../persistence/mobile-preferences";
import { appAtomRegistry } from "../../../state/atom-registry";
import { preferencesAtom, updatePreferencesAtom } from "../../../state/preferences";

interface AppearanceContextValue {
  /** False until stored preferences load, so the first frame never flashes the wrong theme. */
  readonly isReady: boolean;
  readonly themeMode: ThemeMode;
  readonly themeId: ThemeId;
  readonly appearance: ThemeAppearance;
  readonly variables: ThemeVariables;
  readonly materialYouAvailable: boolean;
  readonly setThemeMode: (mode: ThemeMode) => void;
  readonly setThemeId: (id: ThemeId) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

const storedPreferences = (result: AsyncResult.AsyncResult<Preferences, unknown>): Preferences =>
  AsyncResult.isSuccess(result) ? result.value : {};

// The wallpaper palette can change while the app is in the background, so it is re-read on resume.
const materialYouPalettesAtom = Atom.make((get): MaterialYouPalettes | null => {
  const initial = readMaterialYouPalettes();

  if (!isMaterialYouAvailable) return initial;

  let current = JSON.stringify(initial);

  const subscription = AppState.addEventListener("change", (state) => {
    if (state !== "active") return;

    const next = readMaterialYouPalettes();

    if (JSON.stringify(next) === current) return;

    current = JSON.stringify(next);
    get.setSelf(next);
  });

  get.addFinalizer(() => subscription.remove());

  return initial;
}).pipe(Atom.keepAlive, Atom.withLabel("appearance:material-you-palettes"));

const themeModeAtom = Atom.make(
  (get) => storedPreferences(get(preferencesAtom)).themeMode ?? "system",
).pipe(Atom.withLabel("appearance:theme-mode"));

const applyThemeMode = (mode: ThemeMode) =>
  Appearance.setColorScheme(mode === "system" ? "unspecified" : mode);

/**
 * Keeps the native color scheme (status bar, system dialogs, Compose views) on the stored theme
 * mode for the app's lifetime. Returns the unsubscribe.
 */
export function installAppearanceRuntime(): () => void {
  return appAtomRegistry.subscribe(themeModeAtom, applyThemeMode, { immediate: true });
}

export function AppearanceProvider(props: { readonly children: ReactNode }) {
  const result = useAtomValue(preferencesAtom);
  const savePreferences = useAtomSet(updatePreferencesAtom);
  const palettes = useAtomValue(materialYouPalettesAtom);
  const systemAppearance: ThemeAppearance = useColorScheme() === "dark" ? "dark" : "light";
  const stored = storedPreferences(result);
  const themeMode = stored.themeMode ?? "system";
  const themeId = stored.themeId ?? DEFAULT_THEME_ID;
  const appearance = themeMode === "system" ? systemAppearance : themeMode;

  const variables =
    themeId === "material-you" && palettes
      ? materialYouVariables(palettes[appearance], appearance)
      : BRAND_THEME[appearance];

  const value: AppearanceContextValue = {
    isReady: AsyncResult.isSuccess(result),
    themeMode,
    themeId,
    appearance,
    variables,
    materialYouAvailable: isMaterialYouAvailable,
    setThemeMode: (mode) => {
      // Applied before the write so the next frame already uses it.
      applyThemeMode(mode);
      savePreferences({ themeMode: mode });
    },
    setThemeId: (id) => savePreferences({ themeId: id }),
  };

  return (
    <AppearanceContext value={value}>
      {/* Edge-to-edge draws the app under the status bar, so its icons follow the app's appearance. */}
      <StatusBar barStyle={appearance === "dark" ? "light-content" : "dark-content"} />
      <ScopedTheme theme={appearance}>
        <ScopedVariables variables={variables}>{props.children}</ScopedVariables>
      </ScopedTheme>
    </AppearanceContext>
  );
}

export function useAppearance(): AppearanceContextValue {
  const context = use(AppearanceContext);

  if (!context) throw new Error("useAppearance must be used within AppearanceProvider");

  return context;
}
