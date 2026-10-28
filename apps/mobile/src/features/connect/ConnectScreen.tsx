import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { Button } from "../../components/ui/Button";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { pairWithCodeAtom } from "../../state/connection";
import { pairingErrorMessage } from "./pairingCopy";

/** First run. Also where `<scheme>://connect` links land while they pair. */
export function ConnectScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const linkPairing = useAtomValue(pairWithCodeAtom);
  const error = linkPairing.waiting ? undefined : pairingErrorMessage(linkPairing, "code");

  return (
    <View className="flex-1 bg-screen px-5" style={{ paddingBottom: insets.bottom + 24 }}>
      <View className="flex-1 items-center justify-center gap-2 px-4">
        <SymbolView name="device-tablet" size={44} tintColorClassName="accent-icon" />
        <AppText textRole="title" className="mt-2 text-center font-sans-medium">
          Connect your Kindle
        </AppText>
        <AppText textRole="body" className="text-center leading-normal text-foreground-muted">
          Scan the pairing code from your computer. You only do this once.
        </AppText>
      </View>
      <View className="gap-3">
        {error ? <ErrorBanner message={error} /> : null}
        <Button
          tone="contrast"
          fullWidth
          label={linkPairing.waiting ? "Connecting" : "Scan pairing code"}
          loading={linkPairing.waiting}
          onPress={() => navigation.navigate("ScanPairingCode")}
        />
        <Button
          tone="text"
          fullWidth
          label="Enter details"
          disabled={linkPairing.waiting}
          onPress={() => navigation.navigate("EnterDetails")}
        />
      </View>
    </View>
  );
}
