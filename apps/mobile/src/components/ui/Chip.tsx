import { Pressable, View } from "react-native";

import { cn } from "../../lib/cn";
import { AppText } from "./AppText";
import { SymbolView, type AppSymbolName } from "./AppSymbol";

export function Chip(props: {
  readonly label: string;
  readonly selected?: boolean;
  readonly icon?: AppSymbolName;
  readonly trailingIcon?: AppSymbolName;
  readonly size?: "small" | "default";
  readonly onPress?: () => void;
  readonly accessibilityLabel?: string;
  readonly disabled?: boolean;
}) {
  const small = props.size === "small";

  const layout = cn(
    "flex-row items-center gap-1.5 rounded-2xl px-3",
    small ? "py-1" : "min-h-8 py-1.5",
  );

  const iconColor = props.selected ? "accent-primary-foreground" : "accent-icon-muted";

  const content = (
    <>
      {props.icon ? (
        <SymbolView name={props.icon} size={15} tintColorClassName={iconColor} />
      ) : null}
      <AppText
        textRole={small ? "caption" : "footnote"}
        numberOfLines={small ? undefined : 1}
        className={cn(
          "shrink",
          !small && "max-w-[180px]",
          !small && "font-sans-medium",
          props.selected ? "text-primary-foreground" : "text-foreground-muted",
        )}
      >
        {props.label}
      </AppText>
      {props.trailingIcon ? (
        <SymbolView name={props.trailingIcon} size={11} tintColorClassName={iconColor} />
      ) : null}
    </>
  );

  const body = (
    <View
      className={cn(
        layout,
        props.selected ? "bg-primary" : small ? "bg-grouped-card" : "bg-subtle",
      )}
    >
      {content}
    </View>
  );

  return props.onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ selected: props.selected, disabled: Boolean(props.disabled) }}
      disabled={props.disabled}
      onPress={props.onPress}
      hitSlop={6}
      className={props.disabled ? "opacity-45" : "active:opacity-70"}
    >
      {body}
    </Pressable>
  ) : (
    body
  );
}
