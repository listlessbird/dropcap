import type { Icon } from "@tabler/icons-react-native/types";
/* Package-root imports eagerly register the entire Tabler icon set in Metro. */
import IconAlertCircle from "@tabler/icons-react-native/IconAlertCircle";
import IconAlertTriangle from "@tabler/icons-react-native/IconAlertTriangle";
import IconArrowLeft from "@tabler/icons-react-native/IconArrowLeft";
import IconBook from "@tabler/icons-react-native/IconBook";
import IconCheck from "@tabler/icons-react-native/IconCheck";
import IconChevronDown from "@tabler/icons-react-native/IconChevronDown";
import IconChevronRight from "@tabler/icons-react-native/IconChevronRight";
import IconCopy from "@tabler/icons-react-native/IconCopy";
import IconDeviceMobile from "@tabler/icons-react-native/IconDeviceMobile";
import IconDotsVertical from "@tabler/icons-react-native/IconDotsVertical";
import IconInfoCircle from "@tabler/icons-react-native/IconInfoCircle";
import IconLayoutGrid from "@tabler/icons-react-native/IconLayoutGrid";
import IconMoon from "@tabler/icons-react-native/IconMoon";
import IconPalette from "@tabler/icons-react-native/IconPalette";
import IconPencil from "@tabler/icons-react-native/IconPencil";
import IconPlus from "@tabler/icons-react-native/IconPlus";
import IconRefresh from "@tabler/icons-react-native/IconRefresh";
import IconSearch from "@tabler/icons-react-native/IconSearch";
import IconSettings from "@tabler/icons-react-native/IconSettings";
import IconShare from "@tabler/icons-react-native/IconShare";
import IconSun from "@tabler/icons-react-native/IconSun";
import IconTrash from "@tabler/icons-react-native/IconTrash";
import IconX from "@tabler/icons-react-native/IconX";
import type { ColorValue, StyleProp, ViewStyle } from "react-native";
import { withUniwind } from "uniwind";

// Add an icon here before using it. Tabler names map one to one: https://tabler.io/icons
const ICONS = {
  "alert-circle": IconAlertCircle,
  "alert-triangle": IconAlertTriangle,
  "arrow-left": IconArrowLeft,
  book: IconBook,
  check: IconCheck,
  "chevron-down": IconChevronDown,
  "chevron-right": IconChevronRight,
  copy: IconCopy,
  "device-mobile": IconDeviceMobile,
  "dots-vertical": IconDotsVertical,
  "info-circle": IconInfoCircle,
  "layout-grid": IconLayoutGrid,
  moon: IconMoon,
  palette: IconPalette,
  pencil: IconPencil,
  plus: IconPlus,
  refresh: IconRefresh,
  search: IconSearch,
  settings: IconSettings,
  share: IconShare,
  sun: IconSun,
  trash: IconTrash,
  x: IconX,
} satisfies Record<string, Icon>;

export type AppSymbolName = keyof typeof ICONS;

export interface AppSymbolViewProps {
  readonly name: AppSymbolName;
  readonly size?: number;
  readonly tintColor?: ColorValue;
  readonly style?: StyleProp<ViewStyle>;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

export function isAppSymbolName(name: string): name is AppSymbolName {
  return Object.hasOwn(ICONS, name);
}

function AppSymbolView(props: AppSymbolViewProps) {
  const AppIcon = ICONS[props.name];

  return (
    <AppIcon
      accessibilityLabel={props.accessibilityLabel}
      color={props.tintColor}
      size={props.size}
      strokeWidth={2}
      style={props.style}
      testID={props.testID}
    />
  );
}

/** A Tabler icon by name. `tintColorClassName` takes a theme text class, as in `accent-foreground-muted`. */
export const SymbolView = withUniwind(AppSymbolView);
