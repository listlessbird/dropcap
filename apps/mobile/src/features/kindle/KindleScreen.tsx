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
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { ListSection } from "../../components/ui/ListSection";
import { Notice } from "../../components/ui/Notice";
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
  type LibraryEntry,
} from "./kindleCopy";

function DeviceSection(props: { readonly device: Device; readonly now: DateTime.Utc }) {
  const { reported, battery, free, firmware } = deviceSummary(props.device, props.now);

  return (
    <ListSection
      title="Kindle"
      footer="As of its last wake. It reports again the next time it wakes."
    >
      <ListRowLayout label="Last report" detail={reported} />
      {Option.isSome(battery) ? <ListRowLayout label="Battery" detail={battery.value} /> : null}
      {Option.isSome(free) ? <ListRowLayout label="Storage" detail={free.value} /> : null}
      {Option.isSome(firmware) ? <ListRowLayout label="Firmware" detail={firmware.value} /> : null}
    </ListSection>
  );
}

function FailureNotice(props: { readonly id: CommandId; readonly text: string }) {
  const [dismissed, dismiss] = useAtom(kindleState.dismissAtom(props.id));

  return (
    <Notice
      tone="danger"
      icon="alert-circle"
      message={commandError(dismissed) ?? props.text}
      dismissLabel="Dismiss"
      onDismiss={() => dismiss()}
    />
  );
}

function BookEntryRow(props: { readonly entry: LibraryEntry; readonly onDelete: () => void }) {
  const { book, deleting } = props.entry;

  return Option.match(deleting, {
    onNone: () => (
      <ListActionRow
        icon="book"
        label={book.title || "Untitled"}
        onPress={() =>
          Dialog.confirm({
            title: `Delete ${book.title || "this book"}?`,
            message:
              "It's removed from your Kindle, with your place in it, the next time your Kindle wakes.",
            confirmText: "Delete",
            cancelText: "Cancel",
            destructive: true,
            onConfirm: props.onDelete,
          })
        }
      />
    ),
    onSome: ({ id }) => <PendingDeleteRow id={id} title={book.title || "Untitled"} />,
  });
}

function PendingDeleteRow(props: { readonly id: CommandId; readonly title: string }) {
  const [cancelled, cancel] = useAtom(kindleState.dismissAtom(props.id));

  return (
    <ListActionRow
      icon="trash"
      label={props.title}
      description={commandError(cancelled) ?? "Deletes when your Kindle wakes. Tap to keep it."}
      loading={cancelled.waiting}
      onPress={() =>
        Dialog.confirm({
          title: `Keep ${props.title}?`,
          message: "Your Kindle won't delete it.",
          confirmText: "Keep",
          cancelText: "Cancel",
          onConfirm: () => cancel(),
        })
      }
    />
  );
}

function Report(props: {
  readonly device: Device;
  readonly commands: ReadonlyArray<QueuedCommand>;
  readonly now: DateTime.Utc;
  readonly onDelete: (path: BookPath) => void;
}) {
  const entries = libraryEntries(props.device.books, props.commands);

  return (
    <>
      <DeviceSection device={props.device} now={props.now} />

      <ListSection title={`Library (${entries.length})`}>
        {entries.length === 0 ? (
          <ListRowLayout label="No books on your Kindle" />
        ) : (
          entries.map((entry) => (
            <BookEntryRow
              key={entry.book.path}
              entry={entry}
              onDelete={() => props.onDelete(entry.book.path)}
            />
          ))
        )}
      </ListSection>
    </>
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
  const rescanning = rescanPending(commands);

  return (
    <ScrollView
      className="flex-1 bg-screen"
      contentContainerStyle={{ paddingTop: 16, paddingBottom: insets.bottom + 32 }}
    >
      <View className="gap-6 px-4">
        {error ? <ErrorBanner message={error} /> : null}
        {queueError ? <ErrorBanner message={queueError} /> : null}

        {failures(commands).map(({ id, text }) => (
          <FailureNotice key={id} id={id} text={text} />
        ))}

        {Option.isSome(device) ? (
          <Report
            device={device.value}
            commands={commands}
            now={now}
            onDelete={(path) => queue(Command.cases.DeleteBook.make({ path }))}
          />
        ) : (
          <EmptyState
            icon="device-tablet"
            title="No report yet"
            detail="Your Kindle reports its battery and library the next time it wakes."
          />
        )}

        <Button
          tone="secondary"
          fullWidth
          icon="refresh"
          label={rescanning ? "Rescans when your Kindle wakes" : "Rescan library"}
          disabled={rescanning || queued.waiting}
          onPress={() => queue(Command.cases.Rescan.make({}))}
        />
      </View>
    </ScrollView>
  );
}
