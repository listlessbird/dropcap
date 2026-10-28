import type { AppSymbolName } from "./AppSymbol";

export interface ButtonProps {
  readonly label: string;
  readonly accessibilityLabel?: string;
  readonly icon?: AppSymbolName;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly accessibilityHint?: string;
  readonly loading?: boolean;
  readonly tone?: "primary" | "secondary" | "danger" | "text" | "contrast";
  readonly fullWidth?: boolean;
}
