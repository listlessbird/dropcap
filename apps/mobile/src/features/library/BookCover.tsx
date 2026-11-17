import * as Option from "effect/Option";
import { File, Paths } from "expo-file-system";
import { Image, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { cn } from "../../lib/cn";
import { BOOKS_DIRECTORY } from "../../persistence/book-files";
import { convertedOf, type Book } from "../sending/book";

const SIZE = {
  row: { className: "h-14 w-[38px] rounded-[5px]", icon: 18 },
  sheet: { className: "h-24 w-16 rounded-[7px]", icon: 24 },
  detail: { className: "h-36 w-24 rounded-lg", icon: 32 },
} as const;

/**
 * The Kindle thumbnail the converter made, or a plain book before conversion, for PDFs, and while a
 * shared file is still being copied in and has no book yet.
 */
export function BookCover(props: { readonly book?: Book; readonly size: keyof typeof SIZE }) {
  const { className, icon } = SIZE[props.size];
  const { book } = props;

  const thumbnail = Option.flatMap(
    Option.flatMap(Option.fromNullishOr(book), ({ status }) => convertedOf(status)),
    (converted) => converted.thumbnail,
  );

  if (book && Option.isSome(thumbnail)) {
    const uri = new File(Paths.document, BOOKS_DIRECTORY, book.id, thumbnail.value).uri;

    return (
      <Image
        source={{ uri }}
        accessibilityIgnoresInvertColors
        className={cn(className, "border border-border-subtle bg-subtle-strong")}
      />
    );
  }

  return (
    <View className={cn(className, "items-center justify-center bg-subtle-strong")}>
      <SymbolView name="book" size={icon} tintColorClassName="accent-icon-subtle" />
    </View>
  );
}
