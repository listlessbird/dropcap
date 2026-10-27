import {
  DarkTheme,
  DefaultTheme,
  createStaticNavigation,
  useNavigation,
  type StaticParamList,
  type Theme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { IconButton } from "./components/ui/IconButton";
import { ComponentCatalogScreen } from "./features/development/ComponentCatalogScreen";
import { HomeScreen } from "./features/home/HomeScreen";
import { useAppearance } from "./features/settings/appearance/AppearanceProvider";
import { SettingsScreen } from "./features/settings/SettingsScreen";

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

// Each screen's `linking` path is also its deep link: kindledrop://settings opens Settings.
const RootStack = createNativeStackNavigator({
  initialRouteName: "Home",
  screenOptions: {
    headerShadowVisible: false,
    // Native headers do not read Uniwind classes. This matches global.css --font-medium.
    headerTitleStyle: { fontFamily: "DMSans-Medium" },
  },
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
