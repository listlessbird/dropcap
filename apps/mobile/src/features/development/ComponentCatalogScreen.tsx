import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "../../components/ui/AppText";
import { BottomSheet } from "../../components/ui/BottomSheet";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import * as Dialog from "../../components/ui/Dialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { IconButton } from "../../components/ui/IconButton";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { ListRow } from "../../components/ui/ListRow";
import { ListSection } from "../../components/ui/ListSection";
import { ListToggleRow } from "../../components/ui/ListToggleRow";
import { LoadingStrip } from "../../components/ui/LoadingStrip";
import { Menu } from "../../components/ui/Menu";
import { Notice } from "../../components/ui/Notice";
import { Progress } from "../../components/ui/Progress";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { THEME_OPTIONS } from "../../lib/theme";
import { useAppearance } from "../settings/appearance/AppearanceProvider";

const MODE_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

const SORT_OPTIONS = ["Recent", "Title", "Author"] as const;

/**
 * Every UI kit component in one scrolling page, with the theme controls on top. Development builds
 * only: it is the quickest way to check a component change in light, dark and Material You.
 */
export function ComponentCatalogScreen() {
  const insets = useSafeAreaInsets();
  const { themeMode, themeId, setThemeMode, setThemeId } = useAppearance();
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [sort, setSort] = useState<(typeof SORT_OPTIONS)[number]>("Recent");
  const [selectedChip, setSelectedChip] = useState("Fiction");
  const [noticeVisible, setNoticeVisible] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <ScrollView
      className="flex-1 bg-screen"
      contentContainerStyle={{ paddingTop: 16, paddingBottom: insets.bottom + 32 }}
    >
      <View className="gap-6 px-4">
        <SegmentedControl options={MODE_OPTIONS} selected={themeMode} onSelect={setThemeMode} />
        <SegmentedControl
          options={THEME_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
          selected={themeId}
          onSelect={setThemeId}
        />

        <ListSection title="Rows" footer="Rows group inside a section card.">
          <ListRow icon="book" label="Library" detail="12" onPress={() => {}} />
          <ListToggleRow
            icon="refresh"
            label="Sync on wake"
            description="Pull new books when the Kindle wakes"
            value={syncEnabled}
            onValueChange={setSyncEnabled}
          />
          <ListActionRow icon="trash" label="Clear delivered" tone="danger" onPress={() => {}} />
        </ListSection>

        <ListSection title="Choice">
          {SORT_OPTIONS.map((option) => (
            <ListChoiceRow
              key={option}
              label={option}
              selected={sort === option}
              onPress={() => setSort(option)}
            />
          ))}
        </ListSection>

        <View className="gap-3">
          <AppText textRole="headline" className="text-foreground">
            Buttons
          </AppText>
          <View className="flex-row flex-wrap gap-2">
            <Button label="Primary" tone="primary" onPress={() => {}} />
            <Button label="Secondary" icon="plus" onPress={() => {}} />
            <Button label="Danger" tone="danger" onPress={() => {}} />
            <Button label="Text" tone="text" onPress={() => {}} />
            <Button label="Loading" loading onPress={() => {}} />
          </View>
          <View className="flex-row gap-2">
            <IconButton icon="search" accessibilityLabel="Search" onPress={() => {}} />
            <IconButton icon="plus" variant="primary" accessibilityLabel="Add" onPress={() => {}} />
            <IconButton
              icon="trash"
              variant="danger"
              accessibilityLabel="Delete"
              onPress={() => {}}
            />
            <Menu
              title="Book"
              actions={[
                { id: "share", title: "Share", image: "share" },
                { id: "copy", title: "Copy title", image: "copy" },
                {
                  id: "delete",
                  title: "Delete",
                  image: "trash",
                  attributes: { destructive: true },
                },
              ]}
              onPressAction={() => {}}
            >
              <IconButton icon="dots-vertical" accessibilityLabel="More" onPress={() => {}} />
            </Menu>
          </View>
        </View>

        <View className="flex-row flex-wrap gap-2">
          {["Fiction", "Articles", "Papers"].map((label) => (
            <Chip
              key={label}
              label={label}
              selected={selectedChip === label}
              onPress={() => setSelectedChip(label)}
            />
          ))}
          <Chip label="Kindle checked in 2 h ago" dot="positive" />
          <Chip label="Kindle checked in 3 days ago" dot="caution" />
        </View>

        <View className="gap-3">
          <AppText textRole="headline" className="text-foreground">
            Sheet
          </AppText>
          <Button label="Open bottom sheet" onPress={() => setSheetOpen(true)} />
          {sheetOpen ? (
            <BottomSheet onDismiss={() => setSheetOpen(false)}>
              <View className="gap-4 px-5 pb-4 pt-1">
                <AppText textRole="headline" className="font-sans-medium">
                  House of Chains
                </AppText>
                <Button
                  tone="contrast"
                  fullWidth
                  label="Send to Kindle"
                  onPress={() => setSheetOpen(false)}
                />
              </View>
            </BottomSheet>
          ) : null}
        </View>

        <View className="gap-3">
          <AppText textRole="headline" className="text-foreground">
            Feedback
          </AppText>
          <Progress value={0.6} />
          <LoadingStrip progress={0.35} />
          {noticeVisible ? (
            <Notice
              icon="info-circle"
              message="Three books are waiting for the Kindle to wake."
              onDismiss={() => setNoticeVisible(false)}
            />
          ) : null}
          <ErrorBanner message="Could not reach the Kindle." />
        </View>

        <View className="flex-row flex-wrap gap-2">
          <Button
            label="Confirm dialog"
            onPress={() =>
              Dialog.confirm({
                title: "Clear delivered books?",
                message: "They stay on the Kindle.",
                confirmText: "Clear",
                destructive: true,
                onConfirm: () => {},
              })
            }
          />
          <Button
            label="Prompt dialog"
            onPress={() =>
              Dialog.prompt({
                title: "Rename",
                initialValue: "Dune",
                confirmText: "Save",
                onConfirm: () => {},
              })
            }
          />
        </View>

        <EmptyState
          title="No books yet"
          detail="Share a book to Kindle Drop and it shows up here."
          actionLabel="Add a book"
          onAction={() => {}}
        />
      </View>
    </ScrollView>
  );
}
