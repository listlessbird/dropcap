import { RegistryContext, useAtomSet, useAtomValue } from "@effect/atom-react";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, type Atom } from "effect/reactivity";
import * as Linking from "expo-linking";
import { useRef } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppText } from "../../components/ui/AppText";
import { BottomSheet, type BottomSheetRef } from "../../components/ui/BottomSheet";
import { Button } from "../../components/ui/Button";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { fileSize } from "../../lib/units";
import { booksState } from "../../state/books";
import { appAtomRegistry } from "../../state/atom-registry";
import { BookCover } from "../library/BookCover";
import {
  failureOf,
  FILE_UNREADABLE,
  FORMAT_LABEL,
  UNSUPPORTED_FILE,
  UNSUPPORTED_TEXT,
} from "../library/libraryCopy";
import {
  formatOf,
  labelOf,
  siteOf,
  stem,
  waitsForConnection,
  type Book,
  type BookId,
  type Source,
} from "../sending/book";
import { AppearanceProvider } from "../settings/appearance/AppearanceProvider";
import { articleOf, closeSheet, ShareOutcome, shareAtom, Shared } from "./shareState";

const decodeShared = Schema.decodeUnknownOption(Shared);

/** The book, or the shared file before it is copied in: cover, title, author, and format and size. */
function Summary(props: {
  readonly book?: Book;
  readonly title: string;
  readonly author: string;
  readonly detail: string;
}) {
  return (
    <View className="flex-row items-center gap-4">
      <BookCover book={props.book} size="sheet" />
      <View className="min-w-0 flex-1">
        <AppText textRole="headline" className="font-sans-medium" numberOfLines={2}>
          {props.title}
        </AppText>
        {props.author ? (
          <AppText textRole="footnote" className="text-foreground-muted" numberOfLines={1}>
            {props.author}
          </AppText>
        ) : null}
        <AppText textRole="footnote" className="mt-2 text-foreground-muted">
          {props.detail}
        </AppText>
      </View>
    </View>
  );
}

/** "EPUB · 9.1 MB", or "Article · example.com". */
const detailOf = (format: Option.Option<Source["format"]>, more: Option.Option<string>) =>
  [...Option.toArray(Option.map(format, (f) => FORMAT_LABEL[f])), ...Option.toArray(more)].join(
    " · ",
  );

const sourceDetail = (source: Source) =>
  source.format === "article"
    ? detailOf(Option.some(source.format), Option.some(siteOf(source.url)))
    : detailOf(Option.some(source.format), Option.some(fileSize(source.bytes)));

function Message(props: {
  readonly title: string;
  readonly message: string;
  readonly action?: { readonly label: string; readonly onPress: () => Promise<void> };
  readonly close: () => Promise<void>;
}) {
  const { action, close } = props;

  return (
    <>
      <View className="gap-1.5">
        <AppText textRole="headline" className="font-sans-medium">
          {props.title}
        </AppText>
        <AppText textRole="body" className="text-foreground-muted">
          {props.message}
        </AppText>
      </View>
      <View className="gap-1">
        {action ? (
          <Button
            tone="contrast"
            fullWidth
            label={action.label}
            onPress={() => void action.onPress().then(close)}
          />
        ) : null}
        <Button
          tone={action ? "text" : "secondary"}
          fullWidth
          label={action ? "Cancel" : "Close"}
          onPress={() => void close()}
        />
      </View>
    </>
  );
}

/** Send and Cancel. Send waits, busy, until there is a book to send. */
function Actions(props: {
  readonly send: Option.Option<() => void>;
  readonly close: () => Promise<void>;
}) {
  return (
    <View className="gap-1">
      <Button
        tone="contrast"
        fullWidth
        label="Send to Kindle"
        loading={Option.isNone(props.send)}
        onPress={() => Option.map(props.send, (send) => send())}
      />
      <Button tone="text" fullWidth label="Cancel" onPress={() => void props.close()} />
    </View>
  );
}

function Confirm(props: {
  readonly id: BookId;
  readonly pending: React.ReactNode;
  readonly send: (id: BookId) => void;
  readonly close: () => Promise<void>;
}) {
  const book = useAtomValue(booksState.bookAtom(props.id));
  const shown = AsyncResult.value(book).pipe(Option.flatten);

  if (Option.isNone(shown)) return props.pending;

  const { title, author } = labelOf(shown.value);
  const { source, status } = shown.value;
  const failure = failureOf(shown.value);
  const actions = <Actions send={Option.some(() => props.send(props.id))} close={props.close} />;

  return (
    <>
      <Summary book={shown.value} title={title} author={author} detail={sourceDetail(source)} />
      {Option.isSome(failure) ? (
        <>
          <ErrorBanner message={failure.value} />
          {/* An article the phone could not fetch offline still sends, once it is online. */}
          {waitsForConnection(status) ? (
            actions
          ) : (
            <Button tone="text" fullWidth label="Cancel" onPress={() => void props.close()} />
          )}
        </>
      ) : (
        actions
      )}
    </>
  );
}

/** What the sheet holds: the file while it copies in, then the book, or why it cannot be sent. */
function Content(props: {
  readonly outcome: Atom.Type<ReturnType<typeof shareAtom>>;
  readonly name: string;
  readonly pending: React.ReactNode;
  readonly send: (id: BookId) => void;
  readonly close: () => Promise<void>;
}) {
  const { outcome, name, close } = props;

  if (AsyncResult.isSuccess(outcome)) {
    return ShareOutcome.$match(outcome.value, {
      Confirming: ({ id }) => (
        <Confirm id={id} pending={props.pending} send={props.send} close={close} />
      ),
      Sent: () => null,
    });
  }

  if (!AsyncResult.isFailure(outcome)) return props.pending;

  return Option.match(AsyncResult.error(outcome), {
    onNone: () => <Message title={name} message={FILE_UNREADABLE} close={close} />,
    onSome: Match.valueTags({
      UnsupportedFile: () => <Message title={name} message={UNSUPPORTED_FILE} close={close} />,
      UnsupportedText: () => <Message title={name} message={UNSUPPORTED_TEXT} close={close} />,
      NotConnected: () => (
        <Message
          title="Connect your Kindle"
          message="Scan the pairing code from your computer, then share the book again"
          close={close}
          action={{
            label: "Connect Kindle",
            onPress: async () => {
              await Linking.openURL(Linking.createURL("connect"));
            },
          }}
        />
      ),
      BookFilesError: () => <Message title={name} message={FILE_UNREADABLE} close={close} />,
      BookStoreError: () => <Message title={name} message={FILE_UNREADABLE} close={close} />,
      MobileDatabaseError: () => <Message title={name} message={FILE_UNREADABLE} close={close} />,
      ConnectionStoreError: () => <Message title={name} message={FILE_UNREADABLE} close={close} />,
    }),
  });
}

/**
 * The sheet shows from the first frame, so the app that shared never looks frozen behind the
 * transparent activity while a large file copies in.
 */
function ShareSheet(props: { readonly shared: Shared }) {
  const { shared } = props;
  const outcome = useAtomValue(shareAtom(shared));
  const confirm = useAtomSet(booksState.confirmAtom, { mode: "promise" });
  const sheet = useRef<BottomSheetRef>(null);
  const closing = useRef(false);
  const sending = useRef<BookId | undefined>(undefined);

  // Closes once, however many of Send, Cancel, a swipe, back and the scrim the user manages. The
  // share atom discards a book that was not sent.
  const close = async () => {
    if (closing.current) return;

    closing.current = true;

    if (sending.current !== undefined) await confirm(sending.current);

    await sheet.current?.hide();
    await closeSheet();
  };

  const send = (id: BookId) => {
    sending.current = id;
    void close();
  };

  const name = shared.name ?? shared.subject ?? (shared.uri ? "This file" : "Shared text");

  const preview = Option.match(articleOf(shared), {
    onSome: ({ url, title }) => ({
      title: Option.getOrElse(title, () => url),
      detail: detailOf(Option.some("article"), Option.some(siteOf(url))),
    }),
    onNone: () => ({
      title: stem(name),
      detail: detailOf(
        formatOf(name, Option.fromNullishOr(shared.mimeType)),
        Option.map(Option.fromNullishOr(shared.bytes), fileSize),
      ),
    }),
  });

  const pending = (
    <>
      <Summary title={preview.title} author="" detail={preview.detail} />
      <Actions send={Option.none()} close={close} />
    </>
  );

  if (AsyncResult.isSuccess(outcome) && ShareOutcome.$is("Sent")(outcome.value)) return null;

  return (
    <BottomSheet ref={sheet} onDismiss={() => void close()}>
      <View className="gap-5 px-5 pb-4 pt-1">
        <Content outcome={outcome} name={name} pending={pending} send={send} close={close} />
      </View>
    </BottomSheet>
  );
}

/** The root ShareActivity renders over the app that shared. Its props are the shared file or text. */
export function ShareRoot(props: typeof Shared.Encoded) {
  const shared = decodeShared(props).pipe(Option.getOrElse((): Shared => ({})));

  return (
    <RegistryContext value={appAtomRegistry}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <AppearanceProvider>
            <ShareSheet shared={shared} />
          </AppearanceProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </RegistryContext>
  );
}
