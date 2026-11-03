import { useEffect } from "react";
import * as ReactNative from "react-native";

/**
 * Android hardware Back inside state-driven drill-ins (issue #13 review):
 * while a Settings section or an Item List detail is open, Back pops to the
 * parent view instead of leaving the app; on master views no listener is
 * attached, so the default behavior (exit) stands.
 *
 * react-native-web — the jsdom test host — has no BackHandler, so it is probed
 * off the namespace import rather than named-imported (a missing named export
 * would break every screen). Tests inject a fake with setBackHandlerForTests.
 */
type BackSubscription = { remove(): void };

export interface BackHandlerLike {
  addEventListener(type: "hardwareBackPress", listener: () => boolean): BackSubscription;
}

let backHandler: BackHandlerLike | undefined = (
  ReactNative as unknown as { BackHandler?: BackHandlerLike }
).BackHandler;

export function setBackHandlerForTests(handler: BackHandlerLike | undefined): void {
  backHandler = handler;
}

/** Subscribe while `active`; the listener consumes the press and pops via onBack. */
export function useHardwareBack(active: boolean, onBack: () => void): void {
  useEffect(() => {
    if (!active || !backHandler) return;
    const subscription = backHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [active, onBack]);
}
