import "../global.css";

import { RegistryContext } from "@effect/atom-react";
import { NavigationContainer } from "@react-navigation/native";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import * as Dialog from "./components/ui/Dialog";
import { OverlayPortalHost } from "./components/ui/OverlayPortal";
import { ComponentCatalogScreen } from "./features/development/ComponentCatalogScreen";
import {
  AppearanceProvider,
  installAppearanceRuntime,
  useAppearance,
} from "./features/settings/appearance/AppearanceProvider";
import {
  disposeOnFoundationReplace,
  type FoundationHotModule,
} from "./lib/foundation-fast-refresh";
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

export default function App() {
  return (
    <RegistryContext value={appAtomRegistry}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <KeyboardProvider>
            <AppearanceProvider>
              <SplashScreenCoordinator />
              <NavigationContainer>
                <ComponentCatalogScreen />
              </NavigationContainer>
              <Dialog.Host />
              <OverlayPortalHost />
            </AppearanceProvider>
          </KeyboardProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </RegistryContext>
  );
}
