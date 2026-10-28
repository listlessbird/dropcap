import { useAtom } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { pairWithDetailsAtom } from "../../state/connection";
import { pairingErrorMessage } from "./pairingCopy";

function Field(props: {
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly keyboardType?: "url";
  readonly onChangeText: (value: string) => void;
  readonly onSubmitEditing?: () => void;
}) {
  return (
    <View className="gap-2">
      <AppText textRole="footnote" className="px-1 font-sans-medium text-foreground-muted">
        {props.label}
      </AppText>
      <AppTextInput
        accessibilityLabel={props.label}
        value={props.value}
        placeholder={props.placeholder}
        keyboardType={props.keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        onChangeText={props.onChangeText}
        returnKeyType={props.onSubmitEditing ? "go" : "next"}
        onSubmitEditing={props.onSubmitEditing}
      />
    </View>
  );
}

/** The fallback when the pairing code cannot be scanned: the same two values, typed. */
export function EnterDetailsScreen() {
  const insets = useSafeAreaInsets();
  const [server, setServer] = useState("");
  const [key, setKey] = useState("");
  const [pairing, pair] = useAtom(pairWithDetailsAtom);
  const error = pairing.waiting ? undefined : pairingErrorMessage(pairing, "details");
  const canConnect = server.trim() !== "" && key.trim() !== "" && !pairing.waiting;

  const connect = () => {
    if (canConnect) pair({ server, key });
  };

  // An error describes the values that were sent, so editing either field clears it.
  const edit = (setValue: (value: string) => void) => (value: string) => {
    setValue(value);

    if (AsyncResult.isFailure(pairing)) pair(Atom.Reset);
  };

  return (
    <ScrollView
      className="flex-1 bg-screen"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
    >
      <View className="gap-5">
        <Field
          label="Server address"
          placeholder="https://"
          keyboardType="url"
          value={server}
          onChangeText={edit(setServer)}
        />
        <Field
          label="Access key"
          value={key}
          onChangeText={edit(setKey)}
          onSubmitEditing={connect}
        />
        {error ? <ErrorBanner message={error} /> : null}
        <Button
          tone="contrast"
          fullWidth
          label={pairing.waiting ? "Connecting" : "Connect"}
          loading={pairing.waiting}
          disabled={!canConnect}
          onPress={connect}
        />
      </View>
    </ScrollView>
  );
}
