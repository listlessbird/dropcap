import { ModalBottomSheet, RNHostView, type ModalBottomSheetRef } from "@expo/ui/jetpack-compose";
import type { ReactNode, Ref } from "react";
import { useWindowDimensions, View } from "react-native";

import { NativeThemeHost } from "./NativeThemeHost";
import { useControlTheme } from "./useControlTheme";

export type BottomSheetRef = ModalBottomSheetRef;

/**
 * A Material bottom sheet around React Native content, sized to that content. A swipe, the back
 * gesture, or a tap on the scrim calls `onDismiss`. Hide it through `ref` to animate it away first.
 */
export function BottomSheet({
  ref,
  ...props
}: {
  readonly children: ReactNode;
  readonly onDismiss: () => void;
  readonly ref?: Ref<BottomSheetRef>;
}) {
  const { colors } = useControlTheme();
  const { width } = useWindowDimensions();

  return (
    <NativeThemeHost style={{ position: "absolute", width: 0, height: 0 }}>
      <ModalBottomSheet
        ref={ref}
        onDismissRequest={props.onDismiss}
        skipPartiallyExpanded
        containerColor={colors["--color-sheet-solid"]}
        scrimColor={colors["--color-backdrop"]}
      >
        <RNHostView matchContents>
          <View style={{ width }}>{props.children}</View>
        </RNHostView>
      </ModalBottomSheet>
    </NativeThemeHost>
  );
}
