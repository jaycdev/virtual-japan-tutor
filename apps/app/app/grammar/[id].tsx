import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

// Grammar point detail (#44 route placeholder, built out in #50). It exists now
// so the route tree, the chrome (reader routes hide the tab bar) and deep links
// are all in place before #50 fills in the content.
export default function GrammarPointRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <View className="flex-1 gap-4 bg-background p-4">
      <Text className="text-title font-semibold text-foreground">Grammar</Text>
      <Text className="text-body text-muted-foreground">
        The detail for grammar point {id} will appear here.
      </Text>
    </View>
  );
}
