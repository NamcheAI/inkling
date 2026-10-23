import type { Plugin, Rollup } from "vite";

/** The lazily loaded screens the server renders, by name and source module. */
const screens = {
  editor: "/src/editor-screen.tsx",
  reader: "/src/reader-screen.tsx",
} as const;

/**
 * Records, in the built shell, the scripts and styles each lazily loaded
 * screen needs beyond the entry. The server renderer links them when it
 * renders that screen, so its styles apply before the screen's code loads and
 * the code loads in parallel with the entry instead of after it. The record is
 * an HTML comment, which the server removes.
 */
export function routeAssets(): Plugin {
  return {
    apply: "build",
    name: "inkling-route-assets",
    transformIndexHtml: {
      order: "post",
      handler(html, context) {
        const bundle = context.bundle;
        const entry = context.chunk;
        if (bundle === undefined || entry === undefined) return html;
        const loaded = staticClosure(bundle, entry.fileName);
        const loadedStyles = new Set([...loaded].flatMap((file) => importedCss(bundle, file)));
        const record: Record<string, { modules: string[]; styles: string[] }> = {};
        for (const [name, source] of Object.entries(screens)) {
          const chunk = Object.values(bundle).find(
            (candidate): candidate is Rollup.OutputChunk =>
              candidate.type === "chunk" && candidate.facadeModuleId?.endsWith(source) === true,
          );
          if (chunk === undefined) continue;
          const modules = [...staticClosure(bundle, chunk.fileName)].filter(
            (file) => !loaded.has(file),
          );
          const styles = [...new Set(modules.flatMap((file) => importedCss(bundle, file)))].filter(
            (file) => !loadedStyles.has(file),
          );
          record[name] = {
            modules: modules.map((file) => `/${file}`),
            styles: styles.map((file) => `/${file}`),
          };
        }
        return html.replace(
          "</head>",
          `<!--inkling-route-assets:${JSON.stringify(record)}--></head>`,
        );
      },
    },
  };
}

function staticClosure(bundle: Rollup.OutputBundle, fileName: string): Set<string> {
  const files = new Set<string>();
  const pending = [fileName];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || files.has(file)) continue;
    const chunk = bundle[file];
    if (chunk?.type !== "chunk") continue;
    files.add(file);
    pending.push(...chunk.imports);
  }
  return files;
}

function importedCss(bundle: Rollup.OutputBundle, fileName: string): string[] {
  const chunk = bundle[fileName];
  return chunk?.type === "chunk" ? [...(chunk.viteMetadata?.importedCss ?? [])] : [];
}
