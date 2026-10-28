import {
  DarkTheme,
  DefaultTheme,
  createStaticNavigation,
  useNavigation,
  type StaticParamList,
  type Theme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import { IconButton } from "./components/ui/IconButton";
import { ConnectScreen } from "./features/connect/ConnectScreen";
import { EnterDetailsScreen } from "./features/connect/EnterDetailsScreen";
import { ScanPairingCodeScreen } from "./features/connect/ScanPairingCodeScreen";
import { ComponentCatalogScreen } from "./features/development/ComponentCatalogScreen";
import { KindleCoreScreen } from "./features/development/KindleCoreScreen";
import { HomeScreen } from "./features/home/HomeScreen";
import { useAppearance } from "./features/settings/appearance/AppearanceProvider";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import { connectionAtom } from "./state/connection";

function SettingsButton() {
  const navigation = useNavigation();

  return (
    <IconButton
      icon="settings"
      accessibilityLabel="Settings"
      onPress={() => navigation.navigate("Settings")}
    />
  );
}

/** Whether a paired mailbox is loaded. The app renders no screens until it knows. */
export function useConnectionLoaded() {
  return !AsyncResult.isInitial(useAtomValue(connectionAtom));
}

function useIsConnected() {
  const result = useAtomValue(connectionAtom);

  return AsyncResult.isSuccess(result) && Option.isSome(result.value);
}

function useIsDisconnected() {
  return !useIsConnected();
}

// Each screen's `linking` path is also its deep link: kindledrop://settings opens Settings. The
// groups swap when the connection changes, so pairing lands on Home and disconnecting on Connect.
const RootStack = createNativeStackNavigator({
  screenOptions: {
    headerShadowVisible: false,
    // Native headers do not read Uniwind classes. This matches global.css --font-medium.
    headerTitleStyle: { fontFamily: "DMSans-Medium" },
  },
  groups: {
    Connected: {
      if: useIsConnected,
      screens: {
        Home: {
          screen: HomeScreen,
          linking: "",
          options: { title: "Kindle Drop", headerRight: SettingsButton },
        },
        Settings: {
          screen: SettingsScreen,
          linking: "settings",
          options: { title: "Settings" },
        },
        // Reachable from Settings in development builds only.
        Components: {
          screen: ComponentCatalogScreen,
          linking: "dev/components",
          options: { title: "Components" },
        },
        KindleCore: {
          screen: KindleCoreScreen,
          linking: "dev/kindle-core",
          options: { title: "Kindle core" },
        },
      },
    },
    Disconnected: {
      if: useIsDisconnected,
      screens: {
        // features/connect/pairingLinks.ts pairs from the link's query.
        Connect: {
          screen: ConnectScreen,
          linking: "connect",
          options: { headerShown: false },
        },
        ScanPairingCode: {
          screen: ScanPairingCodeScreen,
          linking: "connect/scan",
          options: { title: "Scan pairing code" },
        },
        EnterDetails: {
          screen: EnterDetailsScreen,
          linking: "connect/details",
          options: { title: "Enter details" },
        },
      },
    },
  },
});

type RootStackParamList = StaticParamList<typeof RootStack>;

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

/** React Navigation's theme for headers, screen backgrounds and transitions, from the active palette. */
export function useNavigationTheme(): Theme {
  const { appearance, variables } = useAppearance();
  const base = appearance === "dark" ? DarkTheme : DefaultTheme;

  return {
    ...base,
    colors: {
      ...base.colors,
      primary: variables["--color-primary-text"],
      background: variables["--color-screen"],
      card: variables["--color-screen"],
      text: variables["--color-header-foreground"],
      border: variables["--color-header-border"],
      notification: variables["--color-danger-foreground"],
    },
  };
}

export const Navigation = createStaticNavigation(RootStack);
