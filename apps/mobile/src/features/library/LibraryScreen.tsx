import { useAtom, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import { AsyncResult } from "effect/reactivity";
import * as Haptics from "expo-haptics";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResolveClassNames } from "uniwind";

import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { ListSection } from "../../components/ui/ListSection";
import { Notice } from "../../components/ui/Notice";
import { Progress } from "../../components/ui/Progress";
import { RowPressable } from "../../components/ui/RowPressable";
import { cn } from "../../lib/cn";
import { booksState } from "../../state/books";
import { nowAtom } from "../../state/clock";
import { BookStatus, labelOf, type Book, type BookId } from "../sending/book";
import { BookCover } from "./BookCover";
import { chooseFileAtom } from "./chooseFile";
import {
  checkInChip,
  quietNotice,
  statusLine,
  UNSUPPORTED_FILE,
  FILE_UNREADABLE,
  librarySections,
  type StatusTone,
} from "./libraryCopy";

const TONE: Readonly<Record<StatusTone, string>> = {
  default: "text-foreground-secondary",
  muted: "text-foreground-muted",
  danger: "text-danger-foreground",
};

function BookRow(props: {
  readonly book: Book;
  readonly progress: Option.Option<number>;
  readonly now: DateTime.Utc;
  readonly onPress: () => void;
  readonly onLongPress?: () => void;
}) {
  const ripple = useResolveClassNames("bg-subtle-strong");
  const { title, author } = labelOf(props.book);
  const line = statusLine(props.book.status, props.progress, props.now);

  // Converting has no known length, so its bar is indeterminate.
  const bar = BookStatus.matchOrElse<
    { readonly label: string; readonly value?: number } | undefined
  >(
    props.book.status,
    {
      Converting: () => ({ label: "Converting" }),
      Uploading: () => ({
        label: "Uploading",
        value: Option.getOrElse(props.progress, () => 0),
      }),
    },
    () => undefined,
  );

  return (
    <RowPressable
      accessibilityRole="button"
      accessibilityLabel={[title, author, line.text].filter(Boolean).join(", ")}
      accessibilityHint={props.onLongPress ? "Long-press to clear" : undefined}
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      android_ripple={{ color: ripple.backgroundColor }}
      unstable_pressDelay={50}
      className="bg-grouped-card"
    >
      <View className="flex-row items-center gap-3 px-4 py-3">
        <BookCover book={props.book} size="row" />
        <View className="min-w-0 flex-1">
          <AppText textRole="body" className="font-sans-medium" numberOfLines={1}>
            {title}
          </AppText>
          {author ? (
            <AppText textRole="footnote" className="text-foreground-muted" numberOfLines={1}>
              {author}
            </AppText>
          ) : null}
          {bar ? <Progress className="mt-2" label={bar.label} value={bar.value} /> : null}
          <AppText textRole="footnote" className={cn("mt-1", TONE[line.tone])}>
            {line.text}
          </AppText>
        </View>
      </View>
    </RowPressable>
  );
}

function KindleChip(props: { readonly now: DateTime.Utc; readonly waiting: boolean }) {
  const status = useAtomValue(booksState.kindleStatusAtom);
  // A failed refresh keeps showing the last answer the mailbox gave.
  const checkedInAt = AsyncResult.value(status).pipe(Option.map((value) => value.checkedInAt));

  if (Option.isNone(checkedInAt)) {
    return AsyncResult.isFailure(status) && !status.waiting ? (
      <View className="self-start">
        <Chip label="Couldn't check on your Kindle" />
      </View>
    ) : null;
  }

  const chip = checkInChip(checkedInAt.value, props.now);
  const quiet = props.waiting ? quietNotice(checkedInAt.value, props.now) : Option.none();

  return (
    <View className="gap-3">
      <View className="self-start">
        <Chip label={chip.label} dot={chip.dot} />
      </View>
      {Option.isSome(quiet) ? <Notice message={quiet.value} icon="alert-circle" /> : null}
    </View>
  );
}

/** The one main screen: books on their way, and books sent in the last 30 days. */
export function LibraryScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const books = useAtomValue(booksState.booksAtom);
  const progress = useAtomValue(booksState.progressAtom);
  const now = useAtomValue(nowAtom);
  const refreshStatus = useAtomRefresh(booksState.kindleStatusAtom);
  const refreshNow = useAtomRefresh(nowAtom);
  const clear = useAtomSet(booksState.clearAtom);
  const [chosen, chooseFile] = useAtom(chooseFileAtom);

  useFocusEffect(() => {
    refreshNow();
    refreshStatus();
  });

  const progressOf = (id: BookId) =>
    AsyncResult.value(progress).pipe(Option.flatMap((all) => Option.fromNullishOr(all.get(id))));

  const openBook = (id: BookId) => navigation.navigate("Book", { id });

  const chooseError = AsyncResult.matchWithError(chosen, {
    onInitial: () => undefined,
    onSuccess: () => undefined,
    onDefect: () => FILE_UNREADABLE,
    onError: (error) =>
      Predicate.isTagged(error, "UnsupportedFile") ? UNSUPPORTED_FILE : FILE_UNREADABLE,
  });

  if (AsyncResult.isInitial(books)) return <View className="flex-1 bg-screen" />;

  const { sending, recent } = librarySections(AsyncResult.getOrElse(books, () => []));

  if (sending.length === 0 && recent.length === 0) {
    return (
      <View
        className="flex-1 justify-center bg-screen px-4"
        style={{ paddingBottom: insets.bottom }}
      >
        <EmptyState
          variant="plain"
          icon="book"
          title="No books yet"
          detail="Share an EPUB or PDF from any app. It arrives the next time your Kindle wakes."
          action={
            <Button
              tone="secondary"
              label="Choose a file"
              loading={chosen.waiting}
              onPress={() => chooseFile()}
            />
          }
        />
        {chooseError ? <ErrorBanner message={chooseError} /> : null}
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-screen"
      contentContainerStyle={{ paddingTop: 8, paddingBottom: insets.bottom + 32 }}
    >
      <View className="gap-6 px-4">
        <KindleChip
          now={now}
          waiting={sending.some((book) => BookStatus.isAnyOf(["Waiting"])(book.status))}
        />

        {chooseError ? <ErrorBanner message={chooseError} /> : null}

        {sending.length > 0 ? (
          <ListSection title="Sending">
            {sending.map((book) => (
              <BookRow
                key={book.id}
                book={book}
                progress={progressOf(book.id)}
                now={now}
                onPress={() => openBook(book.id)}
              />
            ))}
          </ListSection>
        ) : null}

        {recent.length > 0 ? (
          <ListSection title="Recent">
            {recent.map((book) => (
              <BookRow
                key={book.id}
                book={book}
                progress={Option.none()}
                now={now}
                onPress={() => openBook(book.id)}
                onLongPress={() => {
                  void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Long_Press);
                  clear(book.id);
                }}
              />
            ))}
          </ListSection>
        ) : null}
      </View>
    </ScrollView>
  );
}
