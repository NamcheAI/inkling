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
  themeContentSecurityPolicy,
  themeStylesheet,
  withThemeFontSources,
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

test("the content security policy allows only the theme's font origins", () => {
  const selfHosted = {
    ...inklingTheme,
    fonts: {
      ...inklingTheme.fonts,
      imports: ["https://fonts.example.com/sans.css", "https://fonts.example.com/mono.css"],
    },
  };

  assert.equal(
    themeContentSecurityPolicy(inklingTheme),
    "default-src 'none'; img-src 'self' https: data:; style-src 'self' https://fonts.googleapis.com; script-src 'self'; connect-src 'self'; font-src 'self' https://fonts.gstatic.com; base-uri 'none'; frame-ancestors 'none'",
  );
  assert.match(
    themeContentSecurityPolicy(selfHosted),
    /style-src 'self' https:\/\/fonts\.example\.com; .*font-src 'self' https:\/\/fonts\.example\.com;/u,
  );
  assert.match(
    themeContentSecurityPolicy({ ...inklingTheme, fonts: { ...inklingTheme.fonts, imports: [] } }),
    /style-src 'self'; .*font-src 'self';/u,
  );
  assert.match(themeContentSecurityPolicy(undefined), /style-src 'self'; .*font-src 'self';/u);
});

test("theme JSON rejects font imports without a plain host", async () => {
  const invalid = {
    ...inklingTheme,
    fonts: { ...inklingTheme.fonts, imports: ["https://fonts.example;script-src/fonts.css"] },
  };
  const result = await Effect.runPromise(Effect.either(decodeThemeJson(JSON.stringify(invalid))));

  assert.equal(Either.isLeft(result), true);
});

test("shape, weight, and brand overrides appear only when a theme sets them", () => {
  const logo = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg"/>')}`;
  const shaped = {
    ...inklingTheme,
    brand: { logo, logoAspectRatio: 5.25 },
    fonts: { ...inklingTheme.fonts, weights: { semiBold: 500 } },
    shape: { borderWidth: { default: "0.5px" }, radius: { small: "0.75rem" }, shadows: false },
  };
  const stylesheet = themeStylesheet(shaped);

  assert.match(stylesheet, /--semantic-dimension-border-width-default: 0\.5px;/u);
  assert.match(stylesheet, /--semantic-dimension-radius-small: 0\.75rem;/u);
  assert.match(stylesheet, /--semantic-shadow-popup: none;/u);
  assert.match(stylesheet, /--primitive-font-weight-semi-bold: 500;/u);
  assert.ok(stylesheet.includes(`--brand-logo: url("${logo}");`));
  assert.doesNotMatch(stylesheet, /--semantic-dimension-border-width-small|radius-medium/u);
  assert.doesNotMatch(
    themeStylesheet(inklingTheme),
    /--semantic-dimension-|--semantic-shadow-|--primitive-font-weight-|--brand-/u,
  );
});

test("theme JSON rejects remote logos and lengths outside px and rem", async () => {
  const results = await Promise.all(
    [
      { ...inklingTheme, brand: { logo: "https://example.com/logo.svg", logoAspectRatio: 2 } },
      { ...inklingTheme, shape: { radius: { small: "1px;color:red" } } },
    ].map((theme) => Effect.runPromise(Effect.either(decodeThemeJson(JSON.stringify(theme))))),
  );

  assert.deepEqual(
    results.map((result) => Either.isLeft(result)),
    [true, true],
  );
});

test("a theme's selection colors apply only when the theme sets them", () => {
  const selected = {
    ...inklingTheme,
    dark: {
      ...inklingTheme.dark,
      selection: { background: "oklch(40% 0.1 60)", text: "oklch(95% 0.01 90)" },
    },
    light: {
      ...inklingTheme.light,
      selection: { background: "oklch(85% 0.08 70)", text: "oklch(25% 0 0)" },
    },
  };
  const stylesheet = themeStylesheet(selected);

  assert.match(stylesheet, /--selection-background: oklch\(85% 0\.08 70\);/u);
  assert.match(stylesheet, /--selection-background: oklch\(40% 0\.1 60\);/u);
  assert.match(stylesheet, /::selection \{\n {2}color: var\(--selection-text, currentColor\);/u);
  assert.doesNotMatch(themeStylesheet(inklingTheme), /--selection-|::selection/u);
});

test("pages with their own policy take the theme's font origins", () => {
  const response = new Response("", {
    headers: {
      "Content-Security-Policy":
        "default-src 'none'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; form-action 'self'",
    },
  });
  const selfHosted = {
    ...inklingTheme,
    fonts: { ...inklingTheme.fonts, imports: ["https://fonts.example.com/sans.css"] },
  };

  assert.equal(
    withThemeFontSources(response, selfHosted).headers.get("Content-Security-Policy"),
    "default-src 'none'; style-src 'self' https://fonts.example.com; font-src 'self' https://fonts.example.com; form-action 'self'",
  );
});
