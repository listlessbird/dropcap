import { RegistryContext, useAtomSet, useAtomValue } from "@effect/atom-react";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/reactivity";
import * as Linking from "expo-linking";
import { useRef } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppText } from "../../components/ui/AppText";
import { BottomSheet, type BottomSheetRef } from "../../components/ui/BottomSheet";
import { Button } from "../../components/ui/Button";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { megabytes } from "../../lib/units";
import { booksState } from "../../state/books";
import { appAtomRegistry } from "../../state/atom-registry";
import { BookCover } from "../library/BookCover";
import { failureOf, FILE_UNREADABLE, FORMAT_LABEL, UNSUPPORTED_FILE } from "../library/libraryCopy";
import { labelOf, type BookId } from "../sending/book";
import { AppearanceProvider } from "../settings/appearance/AppearanceProvider";
import { closeSheet, ShareOutcome, shareAtom, SharedFile } from "./shareState";

const decodeSharedFile = Schema.decodeUnknownOption(SharedFile);

/** Closes once, however many of hide, swipe and back the user manages. */
function useClose(before: () => Promise<void>) {
  const sheet = useRef<BottomSheetRef>(null);
  const closing = useRef(false);

  const close = async () => {
    if (closing.current) return;

    closing.current = true;
    await before();
    await sheet.current?.hide();
    await closeSheet();
  };

  return { sheet, close };
}

function MessageSheet(props: {
  readonly title: string;
  readonly message: string;
  readonly action?: { readonly label: string; readonly onPress: () => Promise<void> };
}) {
  const { sheet, close } = useClose(async () => {});
  const { action } = props;

  return (
    <BottomSheet ref={sheet} onDismiss={() => void close()}>
      <View className="gap-5 px-5 pb-4 pt-1">
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
      </View>
    </BottomSheet>
  );
}

function ConfirmSheet(props: { readonly id: BookId }) {
  const book = useAtomValue(booksState.bookAtom(props.id));
  const confirm = useAtomSet(booksState.confirmAtom, { mode: "promise" });
  const decision = useRef<"send" | "cancel">("cancel");

  // Swipe, back and the scrim all mean Cancel, which closes without confirming. The share atom
  // discards an unconfirmed book when the sheet unmounts.
  const { sheet, close } = useClose(async () => {
    if (decision.current === "send") await confirm(props.id);
  });

  const shown = AsyncResult.value(book).pipe(Option.flatten);

  if (Option.isNone(shown)) return null;

  const { title, author } = labelOf(shown.value);
  const { source, status } = shown.value;
  const failure = failureOf(status);

  return (
    <BottomSheet ref={sheet} onDismiss={() => void close()}>
      <View className="gap-5 px-5 pb-4 pt-1">
        <View className="flex-row items-center gap-4">
          <BookCover book={shown.value} size="sheet" />
          <View className="min-w-0 flex-1">
            <AppText textRole="headline" className="font-sans-medium" numberOfLines={2}>
              {title}
            </AppText>
            {author ? (
              <AppText textRole="footnote" className="text-foreground-muted" numberOfLines={1}>
                {author}
              </AppText>
            ) : null}
            <AppText textRole="footnote" className="mt-2 text-foreground-muted">
              {`${FORMAT_LABEL[source.format]} · ${megabytes(source.bytes)}`}
            </AppText>
          </View>
        </View>
        {Option.isSome(failure) ? <ErrorBanner message={failure.value} /> : null}
        <View className="gap-1">
          <Button
            tone="contrast"
            fullWidth
            label="Send to Kindle"
            disabled={Option.isSome(failure)}
            onPress={() => {
              decision.current = "send";
              void close();
            }}
          />
          <Button tone="text" fullWidth label="Cancel" onPress={() => void close()} />
        </View>
      </View>
    </BottomSheet>
  );
}

function ShareSheet(props: { readonly shared: SharedFile }) {
  const outcome = useAtomValue(shareAtom(props.shared));
  const name = props.shared.name ?? "This file";

  if (AsyncResult.isSuccess(outcome)) {
    return ShareOutcome.$match(outcome.value, {
      Confirming: ({ id }) => <ConfirmSheet id={id} />,
      Sent: () => null,
    });
  }

  if (!AsyncResult.isFailure(outcome)) return null;

  return Option.match(AsyncResult.error(outcome), {
    onNone: () => <MessageSheet title={name} message={FILE_UNREADABLE} />,
    onSome: Match.valueTags({
      UnsupportedFile: () => <MessageSheet title={name} message={UNSUPPORTED_FILE} />,
      NotConnected: () => (
        <MessageSheet
          title="Connect your Kindle"
          message="Scan the pairing code from your computer, then share the book again"
          action={{
            label: "Connect Kindle",
            onPress: async () => {
              await Linking.openURL(Linking.createURL("connect"));
            },
          }}
        />
      ),
      BookFilesError: () => <MessageSheet title={name} message={FILE_UNREADABLE} />,
      BookStoreError: () => <MessageSheet title={name} message={FILE_UNREADABLE} />,
      MobileDatabaseError: () => <MessageSheet title={name} message={FILE_UNREADABLE} />,
      ConnectionStoreError: () => <MessageSheet title={name} message={FILE_UNREADABLE} />,
    }),
  });
}

/** The root ShareActivity renders over the app that shared. Its props are the shared file. */
export function ShareRoot(props: typeof SharedFile.Encoded) {
  const shared = decodeSharedFile(props).pipe(Option.getOrElse((): SharedFile => ({})));

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
