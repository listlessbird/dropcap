import "react-native-gesture-handler";
import { registerRootComponent } from "expo";
import { AppRegistry } from "react-native";

import App from "./src/App";
import { ShareRoot } from "./src/features/share/ShareSheet";

registerRootComponent(App);

// modules/share-sheet's ShareActivity renders this over the app that shared a file.
AppRegistry.registerComponent("share", () => ShareRoot);
