import { Text, View } from "react-native";

// Grammar (#44 placeholder, built out in #50): the list of known/learning
// grammar points will live here; /grammar/:id (a Grammar point detail) is
// already routed so reader-style deep links resolve once #50 fills them in.
export default function GrammarRoute() {
  return (
    <View className="flex-1 gap-4 bg-background p-4">
      <Text className="text-title font-semibold text-foreground">Grammar</Text>
      <Text className="text-body text-muted-foreground">
        Your known and learning grammar points will appear here.
      </Text>
    </View>
  );
}
