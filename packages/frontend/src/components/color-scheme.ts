export type ColorScheme = "dark" | "light";

const storageKey = "inkling-theme";

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
}

export function syncThemeColor(): void {
  const canvas = getComputedStyle(document.documentElement)
    .getPropertyValue("--semantic-color-background-canvas")
    .trim();
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", canvas);
}
