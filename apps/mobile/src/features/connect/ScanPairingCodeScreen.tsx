import { useAtom } from "@effect/atom-react";
import { useIsFocused } from "@react-navigation/native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { Notice } from "../../components/ui/Notice";
import { pairWithCodeAtom } from "../../state/connection";
import { pairingErrorMessage } from "./pairingCopy";

export function ScanPairingCodeScreen() {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const [pairing, pair] = useAtom(pairWithCodeAtom);
  // The scanner reports the code in view on every frame. Each code gets one attempt.
  const [lastScanned, setLastScanned] = useState<string>();
  const error = pairing.waiting ? undefined : pairingErrorMessage(pairing, "code");

  if (!permission?.granted) {
    const canAsk = permission?.canAskAgain ?? true;

    return (
      <View className="flex-1 bg-screen px-5" style={{ paddingBottom: insets.bottom + 24 }}>
        <View className="flex-1 justify-center px-4">
          <AppText textRole="body" className="text-center leading-normal text-foreground-muted">
            Dropcap uses the camera only to scan the pairing code.
          </AppText>
        </View>
        <Button
          tone="contrast"
          fullWidth
          label={canAsk ? "Allow camera" : "Open settings"}
          onPress={() => {
            if (canAsk) void requestPermission();
            else void Linking.openSettings();
          }}
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black">
      <CameraView
        active={focused && !pairing.waiting}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => {
          if (pairing.waiting || data === lastScanned) return;
          setLastScanned(data);
          pair(data);
        }}
        style={StyleSheet.absoluteFill}
      />
      <View className="absolute inset-x-4" style={{ bottom: insets.bottom + 24 }}>
        {error ? (
          <ErrorBanner message={error} />
        ) : (
          <Notice
            floating
            message={pairing.waiting ? "Connecting" : "Point the camera at the pairing code"}
          />
        )}
      </View>
    </View>
  );
}
