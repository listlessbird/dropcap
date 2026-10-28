import { View } from "react-native";

import { EmptyState } from "../../components/ui/EmptyState";

export function HomeScreen() {
  return (
    <View className="flex-1 bg-screen px-4 pt-4">
      <EmptyState
        title="No books yet"
        detail="Share an EPUB or PDF from any app. It arrives the next time your Kindle wakes."
      />
    </View>
  );
}
