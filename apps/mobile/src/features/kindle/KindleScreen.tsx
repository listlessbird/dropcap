import { useAtom, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  Command,
  type BookPath,
  type CommandId,
  type Device,
  type QueuedCommand,
} from "@kindle-drop/worker/Api";
import { useFocusEffect } from "@react-navigation/native";
import type * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { IconButton } from "../../components/ui/IconButton";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { ListSection } from "../../components/ui/ListSection";
import { Notice } from "../../components/ui/Notice";
import { Progress } from "../../components/ui/Progress";
import { MOBILE_RADIUS } from "../../lib/designTokens";
import { booksState } from "../../state/books";
import { nowAtom } from "../../state/clock";
import { kindleState } from "../../state/kindle";
import { statusError } from "../library/libraryCopy";
import {
  commandError,
  deviceSummary,
  failures,
  libraryEntries,
  rescanPending,
  searchEntries,
  type LibraryEntry,
} from "./kindleCopy";

function Tile(props: {
  readonly label: string;
  readonly value: string;
  readonly children?: ReactNode;
}) {
  return (
    <View
      className="flex-1 gap-1 bg-grouped-card px-4 py-3"
      style={{ borderRadius: MOBILE_RADIUS.group.android }}
    >
      <AppText textRole="footnote" className="text-foreground-muted">
        {props.label}
      </AppText>
      <AppText textRole="display" className="font-sans-medium text-foreground">
        {props.value}
      </AppText>
      {props.children}
    </View>
  );
}

function DeviceTiles(props: { readonly device: Device; readonly now: DateTime.Utc }) {
  const { checkedIn, battery, free } = deviceSummary(props.device, props.now);

  return (
    <View className="gap-2">
      <View className="flex-row gap-2">
        {Option.isSome(battery) ? (
          <Tile
            label={battery.value.charging ? "Battery · Charging" : "Battery"}
            value={battery.value.value}
          />
        ) : null}
        {Option.isSome(free) ? (
          <Tile label="Free" value={free.value.value}>
            {Option.isSome(free.value.used) ? (
              <Progress value={free.value.used.value} label="Storage used" className="pt-1" />
            ) : null}
          </Tile>
        ) : null}
      </View>
      <AppText textRole="footnote" className="px-4 text-foreground-muted">
        {checkedIn}
      </AppText>
    </View>
  );
}

function FailureNotice(props: {
  readonly id: CommandId;
  readonly command: Command;
  readonly text: string;
}) {
  const [dismissed, dismiss] = useAtom(kindleState.dismissAtom(props.id));
  const [retried, retry] = useAtom(kindleState.retryAtom(props.id));

  return (
    <Notice
      tone="danger"
      icon="alert-circle"
      message={commandError(retried) ?? commandError(dismissed) ?? props.text}
      action={{ label: "Try again", onPress: () => retry(props.command) }}
      dismissLabel="Dismiss"
      onDismiss={() => dismiss()}
    />
  );
}

function BookRow(props: { readonly entry: LibraryEntry; readonly onDelete: () => void }) {
  const { book, deleting } = props.entry;
  const title = book.title || "Untitled";

  return Option.match(deleting, {
    onNone: () => (
      <ListActionRow
        label={title}
        onPress={() =>
          Dialog.confirm({
            title: `Delete ${title}?`,
            message: "Removed from your Kindle when it next wakes",
            confirmText: "Delete",
            cancelText: "Cancel",
            destructive: true,
            onConfirm: props.onDelete,
          })
        }
      />
    ),
    onSome: ({ id }) => <DeletingRow id={id} title={title} />,
  });
}

function DeletingRow(props: { readonly id: CommandId; readonly title: string }) {
  const [undone, undo] = useAtom(kindleState.dismissAtom(props.id));

  return (
    <ListRowLayout
      label={props.title}
      description={commandError(undone) ?? "Deleting · Waiting for Kindle"}
      accessory={
        <Button tone="text" label="Undo" loading={undone.waiting} onPress={() => undo()} />
      }
    />
  );
}

function Library(props: {
  readonly device: Device;
  readonly commands: ReadonlyArray<QueuedCommand>;
  readonly onDelete: (path: BookPath) => void;
  readonly onRescan: () => void;
  readonly rescanDisabled: boolean;
}) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const entries = libraryEntries(props.device.books, props.commands);
  const shown = searchEntries(entries, query);
  const rescanning = rescanPending(props.commands);

  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-1 pl-4">
        <AppText textRole="footnote" className="flex-1 font-sans-medium text-foreground-muted">
          {`Library · ${entries.length}`}
        </AppText>
        <IconButton
          icon={searching ? "x" : "search"}
          accessibilityLabel={searching ? "Close search" : "Search books"}
          onPress={() => {
            setSearching(!searching);
            setQuery("");
          }}
        />
        <Button
          tone="text"
          label="Rescan"
          disabled={rescanning || props.rescanDisabled}
          onPress={props.onRescan}
        />
      </View>

      {searching ? (
        <AppTextInput
          autoFocus
          accessibilityLabel="Search books"
          placeholder={`Search ${entries.length} books`}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          returnKeyType="search"
        />
      ) : null}

      <ListSection footer={rescanning ? "Rescan waiting for Kindle" : undefined}>
        {shown.length === 0 ? (
          <ListRowLayout label={entries.length === 0 ? "No books on your Kindle" : "No matches"} />
        ) : (
          shown.map((entry) => (
            <BookRow
              key={entry.book.path}
              entry={entry}
              onDelete={() => props.onDelete(entry.book.path)}
            />
          ))
        )}
      </ListSection>
    </View>
  );
}

/** The Kindle as of its last wake, and what to run on its next one. */
export function KindleScreen() {
  const insets = useSafeAreaInsets();
  const status = useAtomValue(booksState.kindleStatusAtom);
  const now = useAtomValue(nowAtom);
  const refreshStatus = useAtomRefresh(booksState.kindleStatusAtom);
  const refreshNow = useAtomRefresh(nowAtom);
  const [queued, queue] = useAtom(kindleState.queueAtom);

  useFocusEffect(() => {
    refreshNow();
    refreshStatus();
  });

  // A failed refresh keeps showing the last answer the mailbox gave.
  const last = AsyncResult.value(status);
  const error = status.waiting ? undefined : statusError(status);
  const queueError = commandError(queued);

  if (Option.isNone(last) && !error) return <View className="flex-1 bg-screen" />;

  const commands = Option.match(last, { onNone: () => [], onSome: (value) => value.commands });
  const device = Option.flatMap(last, (value) => value.device);

  return (
    <ScrollView
      className="flex-1 bg-screen"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingTop: 16, paddingBottom: insets.bottom + 32 }}
    >
      <View className="gap-5 px-4">
        {error ? <ErrorBanner message={error} /> : null}
        {queueError ? <ErrorBanner message={queueError} /> : null}

        {failures(commands).map(({ id, command, text }) => (
          <FailureNotice key={id} id={id} command={command} text={text} />
        ))}

        {Option.isSome(device) ? (
          <>
            <DeviceTiles device={device.value} now={now} />
            <Library
              device={device.value}
              commands={commands}
              onDelete={(path) => queue(Command.cases.DeleteBook.make({ path }))}
              onRescan={() => queue(Command.cases.Rescan.make({}))}
              rescanDisabled={queued.waiting}
            />
          </>
        ) : (
          <EmptyState
            icon="device-tablet"
            title="No report yet"
            detail="Wake your Kindle to see it here"
          />
        )}
      </View>
    </ScrollView>
  );
}
