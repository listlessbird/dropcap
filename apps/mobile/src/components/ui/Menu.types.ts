import type { ReactNode } from "react";
import type { AccessibilityProps, ColorValue, StyleProp, ViewStyle } from "react-native";

import type { AppSymbolName } from "./AppSymbol";

export interface MenuAction {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly image?: AppSymbolName;
  readonly imageColor?: ColorValue;
  /** `on` shows a check beside the item. */
  readonly state?: "on" | "off";
  readonly attributes?: {
    readonly destructive?: boolean;
    readonly disabled?: boolean;
    readonly hidden?: boolean;
  };
  /** Opens a submenu in place of the parent's items. */
  readonly subactions?: readonly MenuAction[];
}

export type MenuProps = Pick<
  AccessibilityProps,
  "accessible" | "accessibilityLabel" | "accessibilityRole"
> & {
  readonly actions: readonly MenuAction[];
  readonly title?: string;
  readonly onPressAction?: (actionId: string) => void;
  readonly shouldOpenOnLongPress?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly className?: string;
  readonly children: ReactNode;
};
