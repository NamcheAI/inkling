import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { Effect, Either } from "effect";

import {
  createBackendApp,
  decodeThemeJson,
  findBundledTheme,
  inklingTheme,
  isDefaultThemeSelection,
  paperTheme,
  themeStylesheet,
} from "../src/index.ts";

test("the bundled themes define validated light, dark, font, syntax, and diagram values", async () => {
  const configurations = await Promise.all(
    (
      [
        ["inkling", inklingTheme],
        ["paper", paperTheme],
      ] as const
    ).map(async ([name, expected]) => {
      const source = await readFile(
        path.resolve(import.meta.dirname, `../../../themes/${name}.json`),
        "utf8",
      );
      return { expected, theme: await Effect.runPromise(decodeThemeJson(source)) };
    }),
  );
  for (const { expected, theme } of configurations) {
    const stylesheet = themeStylesheet(theme);
    const { $schema, ...configuration } = theme;
    assert.equal($schema, "../theme.schema.json");
    assert.deepEqual(configuration, expected);
    assert.match(stylesheet, /:root\[data-color-scheme="dark"\]/u);
    assert.match(stylesheet, /--semantic-color-background-canvas: oklch\(/u);
    assert.match(stylesheet, /--code-keyword: oklch\(/u);
    assert.match(stylesheet, /--mermaid-primary: oklch\(/u);
    assert.doesNotMatch(stylesheet, /#[\da-f]{3,8}\b|rgba?\(|hsla?\(/iu);
  }
  assert.match(themeStylesheet(inklingTheme), /--semantic-font-family-prose: "Newsreader"/u);
  assert.match(themeStylesheet(paperTheme), /--semantic-font-family-prose: "Literata"/u);
  assert.notEqual(paperTheme.light.page, inklingTheme.light.page);
  assert.equal(findBundledTheme("inkling"), inklingTheme);
  assert.equal(findBundledTheme("paper"), paperTheme);
  assert.equal(findBundledTheme("elanor"), undefined);
});

test("the default theme keeps Elanor's tokens without overrides", async () => {
  for (const selection of [undefined, "", "default", "Elanor"]) {
    assert.equal(isDefaultThemeSelection(selection), true);
  }
  assert.equal(isDefaultThemeSelection("inkling"), false);
  assert.doesNotMatch(themeStylesheet(undefined), /--/u);

  const app = createBackendApp();
  const cssResponse = await app.request("/theme.css");
  assert.equal(cssResponse.status, 200);
  assert.match(cssResponse.headers.get("content-type") ?? "", /^text\/css/u);
  assert.doesNotMatch(await cssResponse.text(), /:root/u);
  assert.equal(await (await app.request("/theme.json")).json(), null);
});

test("theme JSON rejects colors outside OKLCH", async () => {
  const invalid = {
    ...inklingTheme,
    light: { ...inklingTheme.light, accent: "#ff00ff" },
  };
  const result = await Effect.runPromise(Effect.either(decodeThemeJson(JSON.stringify(invalid))));

  assert.equal(Either.isLeft(result), true);
});

test("the backend serves the selected theme as JSON and CSS", async () => {
  const selected = {
    ...inklingTheme,
    fonts: { ...inklingTheme.fonts, heading: '"Custom Heading", serif' },
    light: { ...inklingTheme.light, accent: "oklch(62% 0.2 25)" },
  };
  const app = createBackendApp({ theme: selected });
  const cssResponse = await app.request("/theme.css");
  const jsonResponse = await app.request("/theme.json");

  assert.equal(cssResponse.status, 200);
  assert.match(cssResponse.headers.get("content-type") ?? "", /^text\/css/u);
  assert.match(
    await cssResponse.text(),
    /--semantic-color-background-fill-primary: oklch\(62% 0\.2 25\)/u,
  );
  assert.equal(((await jsonResponse.json()) as { name: string }).name, selected.name);
});
