import { useAtom, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useFocusEffect, type StaticScreenProps } from "@react-navigation/native";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import { AsyncResult } from "effect/reactivity";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { cn } from "../../lib/cn";
import { booksState } from "../../state/books";
import { nowAtom } from "../../state/clock";
import { BookId, BookStatus, labelOf } from "../sending/book";
import { BookCover } from "./BookCover";
import { CANCEL_FAILED, failureOf } from "./libraryCopy";
import { timelineOf, type Step, type StepState } from "./timeline";

const MARKER: Readonly<
  Record<
    StepState,
    { readonly className: string; readonly icon?: "check" | "x"; readonly tint?: string }
  >
> = {
  done: { className: "bg-primary", icon: "check", tint: "accent-primary-foreground" },
  now: { className: "border-2 border-primary" },
  next: { className: "border-2 border-border" },
  failed: { className: "bg-danger-foreground", icon: "x", tint: "accent-screen" },
};

function TimelineStep(props: { readonly step: Step; readonly last: boolean }) {
  const { label, state, detail } = props.step;
  const marker = MARKER[state];

  return (
    <View className="flex-row gap-3">
      <View className="items-center">
        <View
          className={cn(
            "mt-0.5 size-4.5 items-center justify-center rounded-full",
            marker.className,
          )}
        >
          {marker.icon ? (
            <SymbolView name={marker.icon} size={11} tintColorClassName={marker.tint} />
          ) : null}
        </View>
        {props.last ? null : <View className="mt-1 w-0.5 flex-1 bg-border" />}
      </View>
      <View className={cn("min-w-0 flex-1", !props.last && "pb-4")}>
        <AppText
          textRole="body"
          className={state === "next" ? "text-foreground-tertiary" : "text-foreground"}
        >
          {label}
        </AppText>
        {detail ? (
          <AppText
            textRole="footnote"
            className={state === "failed" ? "text-danger-foreground" : "text-foreground-muted"}
          >
            {detail}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

/** Where one book is, and the one thing to do about it. */
export function BookScreen({ route }: StaticScreenProps<{ readonly id: string }>) {
  const id = BookId.make(route.params.id);
  const insets = useSafeAreaInsets();
  const book = useAtomValue(booksState.bookAtom(id));
  const progress = useAtomValue(booksState.progressAtom);
  const now = useAtomValue(nowAtom);
  const refreshStatus = useAtomRefresh(booksState.kindleStatusAtom);
  const refreshNow = useAtomRefresh(nowAtom);
  const retry = useAtomSet(booksState.retryAtom);
  const [canceled, cancelSending] = useAtom(booksState.cancelSendingAtom);

  // Mounting the status atom is what asks the mailbox, so the timeline moves on while it is open.
  useAtomValue(booksState.kindleStatusAtom);

  useFocusEffect(() => {
    refreshNow();
    refreshStatus();
  });

  if (AsyncResult.isInitial(book)) return <View className="flex-1 bg-screen" />;

  const found = AsyncResult.value(book).pipe(Option.flatten);

  if (Option.isNone(found)) {
    return (
      <View className="flex-1 justify-center bg-screen px-4">
        <EmptyState
          variant="plain"
          icon="book"
          title="Book not found"
          detail="It may have been cleared from Recent"
        />
      </View>
    );
  }

  const shown = found.value;
  const { title, author } = labelOf(shown);

  const uploadProgress = AsyncResult.value(progress).pipe(
    Option.flatMap((all) => Option.fromNullishOr(all.get(id))),
  );

  const steps = timelineOf(shown, uploadProgress, now);
  const failure = failureOf(shown.status);

  const cancelError = AsyncResult.matchWithError(canceled, {
    onInitial: () => undefined,
    onSuccess: () => undefined,
    onDefect: () => CANCEL_FAILED.unexpected,
    onError: (error) =>
      Predicate.isTagged(error, "MailboxError")
        ? CANCEL_FAILED[error.reason]
        : CANCEL_FAILED.unexpected,
  });

  return (
    <ScrollView
      className="flex-1 bg-screen"
      contentContainerStyle={{ paddingTop: 8, paddingBottom: insets.bottom + 32 }}
    >
      <View className="gap-6 px-4">
        <View className="items-center gap-1">
          <View className="mb-3">
            <BookCover book={shown} size="detail" />
          </View>
          <AppText textRole="title" className="text-center font-sans-medium">
            {title}
          </AppText>
          {author ? (
            <AppText textRole="body" className="text-center text-foreground-muted">
              {author}
            </AppText>
          ) : null}
        </View>

        <View className="rounded-[20px] bg-grouped-card px-4 py-4">
          {steps.map((step, index) => (
            <TimelineStep key={step.label} step={step} last={index === steps.length - 1} />
          ))}
        </View>

        {Option.isSome(failure) ? (
          <View className="gap-3">
            <ErrorBanner message={failure.value} />
            <Button tone="contrast" fullWidth label="Try again" onPress={() => retry(id)} />
          </View>
        ) : null}

        {BookStatus.isAnyOf(["Waiting"])(shown.status) ? (
          <View className="gap-3">
            {cancelError && !canceled.waiting ? <ErrorBanner message={cancelError} /> : null}
            <Button
              tone="danger"
              fullWidth
              label="Cancel sending"
              loading={canceled.waiting}
              onPress={() =>
                Dialog.confirm({
                  title: "Cancel sending?",
                  message: `${title} won't reach your Kindle.`,
                  confirmText: "Cancel sending",
                  cancelText: "Keep",
                  destructive: true,
                  onConfirm: () => cancelSending(id),
                })
              }
            />
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}
