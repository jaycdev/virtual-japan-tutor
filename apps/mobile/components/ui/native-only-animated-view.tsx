import { Pressable } from 'react-native';
import Animated from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * An animated View or Pressable. Every target is native now (phone-only, #75),
 * so the animation always runs.
 * @example
 * <NativeOnlyAnimatedView entering={FadeIn} exiting={FadeOut}>
 *   <Text>I am animated</Text>
 * </NativeOnlyAnimatedView>
 */
function NativeOnlyAnimatedView(
  props: (React.ComponentProps<typeof Animated.View> & React.RefAttributes<typeof Animated.View>
    & { as?: "View" }) | (React.ComponentProps<typeof AnimatedPressable> & React.RefAttributes<typeof AnimatedPressable> & { as: "Pressable" })
) {
  if (props.as === "Pressable") {
    return <AnimatedPressable {...props} />;
  }
  return <Animated.View {...props} />;
}

export { NativeOnlyAnimatedView };
