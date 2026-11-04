import { useEffect } from "react";
import * as ReactNative from "react-native";

/**
 * Android hardware Back for IN-COMPONENT overlays (issue #44): the router
 * stack owns hardware Back between screens, but layers that are not routes —
 * the Story reader's lookup windows and hold menu, an Item List detail —
 * still have to unwind one layer before Back leaves the screen. While an
 * overlay is open, Back closes it instead of popping the route.
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
