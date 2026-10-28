import { useNavigation } from "@react-navigation/native";
import Constants from "expo-constants";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { ListRow } from "../../components/ui/ListRow";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { ListSection } from "../../components/ui/ListSection";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { THEME_OPTIONS } from "../../lib/theme";
import { useAppearance } from "./appearance/AppearanceProvider";

const MODE_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

export function SettingsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { themeMode, themeId, materialYouAvailable, setThemeMode, setThemeId } = useAppearance();

  return (
    <ScrollView
      className="flex-1 bg-screen"
      contentContainerStyle={{ paddingTop: 16, paddingBottom: insets.bottom + 32 }}
    >
      <View className="gap-6 px-4">
        <ListSection title="Appearance">
          <View className="p-3">
            <SegmentedControl
              options={MODE_OPTIONS}
              selected={themeMode}
              onSelect={setThemeMode}
              variant="card"
            />
          </View>
        </ListSection>

        <ListSection
          title="Theme"
          footer={materialYouAvailable ? undefined : "Material You needs Android 12 or later."}
        >
          {THEME_OPTIONS.map((option) => (
            <ListChoiceRow
              key={option.id}
              label={option.label}
              description={option.id === "material-you" ? "Colors from your wallpaper" : undefined}
              selected={themeId === option.id}
              disabled={option.id === "material-you" && !materialYouAvailable}
              onPress={() => setThemeId(option.id)}
            />
          ))}
        </ListSection>

        {__DEV__ ? (
          <ListSection title="Developer">
            <ListRow
              icon="layout-grid"
              label="Component catalog"
              onPress={() => navigation.navigate("Components")}
            />
            <ListRow
              icon="book"
              label="Kindle core"
              onPress={() => navigation.navigate("KindleCore")}
            />
          </ListSection>
        ) : null}

        <ListSection title="About">
          <ListRowLayout
            icon="info-circle"
            label="Version"
            detail={Constants.expoConfig?.version ?? "unknown"}
          />
        </ListSection>
      </View>
    </ScrollView>
  );
}
