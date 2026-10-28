import * as Haptics from "expo-haptics";
import { cloneElement, isValidElement } from "react";
import { AndroidAnchoredMenu } from "./AndroidAnchoredMenu";
import type { MenuProps } from "./Menu.types";

export function Menu(props: MenuProps) {
  const child = props.children;

  if (props.shouldOpenOnLongPress && isValidElement<{ onLongPress?: () => void }>(child)) {
    return (
      <AndroidAnchoredMenu
        actions={props.actions}
        className={props.className}
        title={props.title}
        style={props.style}
        onPressAction={props.onPressAction}
      >
        {(open) =>
          cloneElement(child, {
            onLongPress: () => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              open();
            },
          })
        }
      </AndroidAnchoredMenu>
    );
  }

  return (
    <AndroidAnchoredMenu
      actions={props.actions}
      className={props.className}
      title={props.title}
      style={props.style}
      onPressAction={props.onPressAction}
    >
      {props.children}
    </AndroidAnchoredMenu>
  );
}
