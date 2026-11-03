import { Text, View } from "react-native";

// Today (#44 placeholder, built out in #47): the signed-in landing route.
export default function TodayScreen() {
  return (
    <View className="flex-1 gap-4 bg-background p-4">
      <Text className="text-title font-semibold text-foreground">Today</Text>
      <Text className="text-body text-muted-foreground">
        Your daily story and review queue will appear here.
      </Text>
    </View>
  );
}
