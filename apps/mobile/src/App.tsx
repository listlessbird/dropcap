import "../global.css";

import { RegistryContext } from "@effect/atom-react";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { Pressable, StatusBar, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  AppearanceProvider,
  installAppearanceRuntime,
  useAppearance,
} from "./features/settings/appearance/AppearanceProvider";
import {
  disposeOnFoundationReplace,
  type FoundationHotModule,
} from "./lib/foundation-fast-refresh";
import { THEME_IDS } from "./lib/theme";
import { appAtomRegistry } from "./state/atom-registry";

declare const module: { readonly hot?: FoundationHotModule } | undefined;

void SplashScreen.preventAutoHideAsync().catch(() => {});

// App-lifetime services. Each returns its own teardown, which Fast Refresh runs on replacement.
const appServiceDisposers = [installAppearanceRuntime()];

disposeOnFoundationReplace(typeof module === "undefined" ? undefined : module.hot, () => {
  for (const dispose of appServiceDisposers) dispose();
});

function SplashScreenCoordinator() {
  const { isReady } = useAppearance();

  useEffect(() => {
    if (isReady) void SplashScreen.hide();
  }, [isReady]);

  return null;
}

const THEME_MODES = ["system", "light", "dark"] as const;

function ThemeProbe() {
  const { appearance, themeId, themeMode, setThemeId, setThemeMode } = useAppearance();
  const nextMode = THEME_MODES[(THEME_MODES.indexOf(themeMode) + 1) % THEME_MODES.length];
  const nextTheme = THEME_IDS[(THEME_IDS.indexOf(themeId) + 1) % THEME_IDS.length];

  return (
    <View className="flex-1 items-center justify-center gap-4 bg-screen px-6">
      <StatusBar barStyle={appearance === "dark" ? "light-content" : "dark-content"} />
      <Text className="text-2xl text-foreground">Kindle Drop</Text>
      <Text className="text-sm text-foreground-muted">
        {themeId} · {themeMode} ({appearance})
      </Text>
      <Pressable
        className="rounded-2xl bg-primary px-5 py-3 active:opacity-70"
        onPress={() => nextMode && setThemeMode(nextMode)}
      >
        <Text className="text-base text-primary-foreground">Mode: {nextMode}</Text>
      </Pressable>
      <Pressable
        className="rounded-2xl border border-border bg-card px-5 py-3 active:opacity-70"
        onPress={() => nextTheme && setThemeId(nextTheme)}
      >
        <Text className="text-base text-foreground">Theme: {nextTheme}</Text>
      </Pressable>
    </View>
  );
}

export default function App() {
  return (
    <RegistryContext value={appAtomRegistry}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <KeyboardProvider>
            <AppearanceProvider>
              <SplashScreenCoordinator />
              <ThemeProbe />
            </AppearanceProvider>
          </KeyboardProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </RegistryContext>
  );
}
