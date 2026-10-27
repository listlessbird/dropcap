import type { IconButtonProps } from "./IconButton.types";
import type { ThemeToken } from "../../lib/theme";
import { NativeThemeHost } from "./NativeThemeHost";
import {
  FilledIconButton,
  FilledTonalIconButton,
  IconButton as ComposeIconButton,
} from "@expo/ui/jetpack-compose";
import { size } from "@expo/ui/jetpack-compose/modifiers";
import { View } from "react-native";

import { useControlTheme } from "./useControlTheme";
import { ANDROID_CONTROL_SIZING } from "../../lib/androidControlSizing";
import { SymbolView } from "./AppSymbol";

type IconButtonVariant = NonNullable<IconButtonProps["variant"]>;

const ICON_BUTTON_COMPONENT = {
  standard: ComposeIconButton,
  tonal: FilledTonalIconButton,
  primary: FilledIconButton,
  danger: FilledIconButton,
} satisfies Record<
  IconButtonVariant,
  typeof ComposeIconButton | typeof FilledTonalIconButton | typeof FilledIconButton
>;

const VARIANT_CONTAINER: Record<IconButtonVariant, ThemeToken> = {
  standard: "--color-secondary",
  tonal: "--color-secondary",
  primary: "--color-primary",
  danger: "--color-danger",
};

export function IconButton(props: IconButtonProps) {
  const { colors } = useControlTheme();
  const { iconSize, buttonSize } = ANDROID_CONTROL_SIZING;
  const variant = props.variant ?? "standard";

  const Component = ICON_BUTTON_COMPONENT[variant];
  const containerColor = colors[VARIANT_CONTAINER[variant]];

  const iconTint = props.disabled
    ? "accent-icon-subtle"
    : variant === "primary"
      ? "accent-primary-foreground"
      : variant === "danger"
        ? "accent-danger-foreground"
        : variant === "tonal"
          ? "accent-secondary-foreground"
          : (props.tintColorClassName ?? "accent-foreground");

  return (
    <View
      accessible
      accessibilityLabel={props.accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(props.disabled), selected: props.selected }}
      accessibilityActions={[{ name: "activate" }]}
      onAccessibilityAction={() => {
        if (!props.disabled) props.onPress?.();
      }}
      style={{ width: buttonSize, height: buttonSize }}
    >
      <View importantForAccessibility="no-hide-descendants">
        <NativeThemeHost
          ignoreSafeAreaKeyboardInsets
          style={{ width: buttonSize, height: buttonSize }}
        >
          <Component
            onClick={props.onPress}
            enabled={!props.disabled}
            modifiers={[size(buttonSize, buttonSize)]}
            colors={
              variant === "standard"
                ? undefined
                : { containerColor, disabledContainerColor: colors["--color-subtle-strong"] }
            }
          >
            {null}
          </Component>
        </NativeThemeHost>
      </View>
      {/* Keep RN SVG measurement outside Compose; the native button owns touch and ripple. */}
      <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
        <SymbolView name={props.icon} size={iconSize} tintColorClassName={iconTint} />
      </View>
    </View>
  );
}
