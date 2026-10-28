import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import Constants from "expo-constants";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { ListRow } from "../../components/ui/ListRow";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { ListSection } from "../../components/ui/ListSection";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { relativeTime } from "../../lib/relativeTime";
import { THEME_OPTIONS } from "../../lib/theme";
import { disconnectAtom, kindleStatusAtom } from "../../state/connection";
import { useAppearance } from "./appearance/AppearanceProvider";

const MODE_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

const STATUS_ERROR = {
  unauthorized: "This pairing code no longer works. Create a new one on your computer.",
  unreachable: "Couldn't check on your Kindle. Check your connection and try again.",
  unexpected: "Couldn't check on your Kindle. Try again in a few minutes.",
} as const;

function KindleSection() {
  const status = useAtomValue(kindleStatusAtom);
  const refresh = useAtomRefresh(kindleStatusAtom);

  useFocusEffect(() => {
    refresh();
  });

  // A failed refresh keeps showing the last answer the mailbox gave.
  const lastCheckIn = AsyncResult.value(status).pipe(
    Option.map(({ checkedInAt, askedAt }) =>
      Option.match(checkedInAt, {
        onNone: () => "Not yet",
        onSome: (at) => relativeTime(at, askedAt),
      }),
    ),
    Option.getOrElse(() => (AsyncResult.isFailure(status) ? "Unknown" : "Checking")),
  );

  const error = AsyncResult.matchWithError(status, {
    onInitial: () => undefined,
    onSuccess: () => undefined,
    onDefect: () => STATUS_ERROR.unexpected,
    onError: Match.valueTags({
      MailboxError: (error) => STATUS_ERROR[error.reason],
      NoSuchElementError: () => undefined,
      MobileDatabaseError: () => STATUS_ERROR.unexpected,
    }),
  });

  return (
    <View className="gap-3">
      <ListSection title="Kindle">
        <ListRowLayout label="Status" detail="Connected" />
        <ListRowLayout label="Last check-in" detail={lastCheckIn} />
      </ListSection>
      {error && !status.waiting ? <ErrorBanner message={error} /> : null}
    </View>
  );
}

export function SettingsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { themeMode, themeId, materialYouAvailable, setThemeMode, setThemeId } = useAppearance();
  const disconnect = useAtomSet(disconnectAtom);

  return (
    <ScrollView
      className="flex-1 bg-screen"
      contentContainerStyle={{ paddingTop: 16, paddingBottom: insets.bottom + 32 }}
    >
      <View className="gap-6 px-4">
        <KindleSection />

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

        <Button
          tone="danger"
          fullWidth
          label="Disconnect Kindle"
          onPress={() =>
            Dialog.confirm({
              title: "Disconnect Kindle?",
              message: "Books waiting to send stay on this phone.",
              confirmText: "Disconnect",
              cancelText: "Cancel",
              destructive: true,
              onConfirm: () => disconnect(),
            })
          }
        />
      </View>
    </ScrollView>
  );
}
