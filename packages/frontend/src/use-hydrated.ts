import { useSyncExternalStore } from "react";

const subscribe = (): (() => void) => () => undefined;

/**
 * Whether the browser has taken over the page. Values that depend on the
 * reader's environment, such as the time zone, render after hydration so the
 * server-rendered markup still matches.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
