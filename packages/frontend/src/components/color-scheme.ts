export type ColorScheme = "dark" | "light";

const storageKey = "inkling-theme";
const listeners = new Set<() => void>();

/** Follows explicit scheme changes and, without one, the system preference. */
export function subscribeToColorScheme(listener: () => void): () => void {
  const systemScheme = matchMedia("(prefers-color-scheme: dark)");
  listeners.add(listener);
  systemScheme.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    systemScheme.removeEventListener("change", listener);
  };
}

/** The server cannot know the reader's scheme; hydration corrects it. */
export function serverColorScheme(): ColorScheme {
  return "light";
}

/** The scheme in effect: the stored choice on the root element, else the system preference. */
export function currentColorScheme(): ColorScheme {
  const selected = document.documentElement.dataset["colorScheme"];
  if (selected === "dark" || selected === "light") return selected;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Selects a scheme for Elanor's tokens and remembers it; the browser chrome follows the canvas. */
export function applyColorScheme(scheme: ColorScheme, remember: boolean): void {
  document.documentElement.dataset["colorScheme"] = scheme;
  if (remember) {
    try {
      localStorage.setItem(storageKey, scheme);
    } catch {
      // Remembering the choice is best effort.
    }
  }
  syncThemeColor();
  for (const listener of listeners) listener();
}

export function syncThemeColor(): void {
  const canvas = getComputedStyle(document.documentElement)
    .getPropertyValue("--semantic-color-background-canvas")
    .trim();
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", canvas);
}
