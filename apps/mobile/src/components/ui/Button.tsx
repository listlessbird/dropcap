import { SymbolView } from "./AppSymbol";
import { NativeThemeHost } from "./NativeThemeHost";
import {
  Box,
  Button as ComposeButton,
  LoadingIndicator,
  FilledTonalButton,
  Row,
  RNHostView,
  Text,
  TextButton,
} from "@expo/ui/jetpack-compose";
import { defaultMinSize, fillMaxWidth, size } from "@expo/ui/jetpack-compose/modifiers";
import { View } from "react-native";

import { useControlTheme } from "./useControlTheme";
import { MOBILE_TYPOGRAPHY } from "../../lib/typography";
import type { ThemeToken } from "../../lib/theme";
import type { ButtonProps } from "./Button.types";
import { ANDROID_CONTROL_SIZING } from "../../lib/androidControlSizing";

type ButtonTone = NonNullable<ButtonProps["tone"]>;

const TRANSPARENT = "#00000000";

const BUTTON_COMPONENT = {
  primary: ComposeButton,
  secondary: FilledTonalButton,
  danger: ComposeButton,
  text: TextButton,
  contrast: ComposeButton,
} satisfies Record<ButtonTone, typeof ComposeButton | typeof FilledTonalButton | typeof TextButton>;

// [container, content] roles per tone. A text button has no container.
const TONE_COLORS: Record<ButtonTone, readonly [ThemeToken | null, ThemeToken]> = {
  primary: ["--color-primary", "--color-primary-foreground"],
  secondary: ["--color-secondary", "--color-secondary-foreground"],
  danger: ["--color-danger", "--color-danger-foreground"],
  text: [null, "--color-primary-text"],
  contrast: ["--color-foreground", "--color-screen"],
};

export function Button(props: ButtonProps) {
  const { colors } = useControlTheme();
  const typography = MOBILE_TYPOGRAPHY.footnote;
  const { mediumIconSize } = ANDROID_CONTROL_SIZING;
  const tone = props.tone ?? "secondary";

  const Component = BUTTON_COMPONENT[tone];
  const [container, content] = TONE_COLORS[tone];
  const containerColor = container ? colors[container] : TRANSPARENT;
  const contentColor = colors[content];

  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityHint={props.accessibilityHint}
      accessibilityState={{
        disabled: Boolean(props.disabled || props.loading),
        busy: Boolean(props.loading),
      }}
      accessibilityActions={[{ name: "activate" }]}
      onAccessibilityAction={() => {
        if (!props.disabled && !props.loading) props.onPress();
      }}
      style={props.fullWidth ? { width: "100%" } : { alignSelf: "flex-start" }}
    >
      <View importantForAccessibility="no-hide-descendants">
        <NativeThemeHost
          matchContents={props.fullWidth ? { vertical: true } : true}
          ignoreSafeAreaKeyboardInsets
          style={props.fullWidth ? { width: "100%" } : { alignSelf: "flex-start" }}
        >
          <Component
            enabled={!props.disabled && !props.loading}
            onClick={props.onPress}
            modifiers={[
              defaultMinSize({ minHeight: 48 }),
              ...(props.fullWidth ? [fillMaxWidth()] : []),
            ]}
            colors={{
              containerColor,
              contentColor,
              disabledContainerColor: colors["--color-subtle-strong"],
              disabledContentColor: colors["--color-foreground-muted"],
            }}
          >
            <Row verticalAlignment="center">
              {props.loading ? (
                <>
                  <LoadingIndicator
                    modifiers={[size(mediumIconSize, mediumIconSize)]}
                    color={colors["--color-foreground-muted"]}
                  />
                  <Box modifiers={[size(8, 1)]} />
                </>
              ) : props.icon ? (
                <>
                  <RNHostView matchContents modifiers={[size(mediumIconSize, mediumIconSize)]}>
                    <View style={{ width: mediumIconSize, height: mediumIconSize }}>
                      <SymbolView
                        name={props.icon}
                        size={mediumIconSize}
                        tintColor={
                          props.disabled ? colors["--color-foreground-muted"] : contentColor
                        }
                      />
                    </View>
                  </RNHostView>
                  <Box modifiers={[size(8, 1)]} />
                </>
              ) : null}
              <Text style={{ ...typography, fontWeight: "500" }}>{props.label}</Text>
            </Row>
          </Component>
        </NativeThemeHost>
      </View>
    </View>
  );
}
