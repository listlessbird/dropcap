import { useAtom } from "@effect/atom-react";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { Directory, File, Paths } from "expo-file-system";
import { Image, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/ui/Button";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { ListSection } from "../../components/ui/ListSection";
import * as KindleCore from "../../lib/kindleCore";

const runtime = Atom.runtime(KindleCore.layer);

const toPath = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ""));

const convertTestEpubAtom = runtime.fn(() =>
  Effect.gen(function* () {
    const kindleCore = yield* KindleCore.KindleCore;
    const epub = new File(Paths.document, "test.epub");
    const outDir = new Directory(Paths.cache, "converted");

    const [elapsed, converted] = yield* kindleCore
      .convertEpub(toPath(epub.uri), toPath(outDir.uri))
      .pipe(Effect.timed);

    const book = new File(`file://${encodeURI(converted.bookPath)}`);

    return { converted, elapsed, bookBytes: book.size };
  }),
);

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const seconds = (duration: Duration.Duration) =>
  `${(Duration.toMillis(duration) / 1000).toFixed(1)} s`;

/**
 * Converts `<documents>/test.epub` with the Rust core into `<cache>/converted/`. Development builds
 * only: push a book with `adb push` and `run-as`, then open kindledrop-dev://dev/kindle-core.
 */
export function KindleCoreScreen() {
  const insets = useSafeAreaInsets();
  const [result, convert] = useAtom(convertTestEpubAtom);
  const conversion = AsyncResult.isSuccess(result) ? result.value : undefined;

  const errorMessage = AsyncResult.matchWithError(result, {
    onInitial: () => undefined,
    onError: (error) => `${error.stage}: ${error.message}`,
    onDefect: (defect) => String(defect),
    onSuccess: () => undefined,
  });

  return (
    <ScrollView
      className="flex-1 bg-screen"
      contentContainerStyle={{ paddingTop: 16, paddingBottom: insets.bottom + 32 }}
    >
      <View className="gap-6 px-4">
        <Button
          label="Convert test.epub"
          icon="book"
          loading={result.waiting}
          disabled={result.waiting}
          onPress={() => convert()}
        />

        {errorMessage ? <ErrorBanner message={errorMessage} /> : null}

        {conversion ? (
          <>
            <ListSection title="Converted">
              <ListRowLayout label="Title" detail={conversion.converted.title} />
              <ListRowLayout label="Author" detail={conversion.converted.author} />
              <ListRowLayout label="Book size" detail={megabytes(conversion.bookBytes)} />
              <ListRowLayout label="Time" detail={seconds(conversion.elapsed)} />
            </ListSection>
            <Image
              source={{ uri: `file://${conversion.converted.thumbnailPath}` }}
              accessibilityLabel="Kindle thumbnail"
              className="aspect-[2/3] w-40 self-center rounded-md"
            />
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}
