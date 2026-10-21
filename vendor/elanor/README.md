# Elanor

The [Elanor](https://github.com/earendil-works/elanor) design system comes from the pinned `vendor/elanor-src`
submodule. `scripts/build-elanor.mjs` builds the packages Inkling consumes into this directory, where they are pnpm
workspace packages. The build output is not committed: only this README and `icons.json` are. `SOURCE.json` records the
Elanor commit, the token brand, and the icons that were kept; the script skips the build while it matches.

| Directory | Package |
| --- | --- |
| `elanor-react` | `@earendil-works/elanor-react`: React components (Base UI) and precompiled component CSS |
| `elanor-icons-react` | `@earendil-works/elanor-icons-react`: Material Symbols components, pruned to the icons in use |
| `design-tokens` | `@earendil-works/design-tokens`: token CSS and catalogue for the `earendil` brand |
| `elanor-fonts` | `@earendil-works/elanor-fonts`: Earendil and Commit Mono fonts, CSS entry points, and licenses |

Build Elanor before `pnpm install`, since the frontend depends on these workspace packages; `make setup` does both. The
build uses Elanor's own pinned pnpm, lockfile, and supply-chain policy in a temporary copy of the submodule, so Elanor's
development dependencies stay out of Inkling's lockfile. The script points the built packages' dependencies on each
other at the workspace, and `pnpm-workspace.yaml` hoists the React types their declarations import. The frontend lists
them as development dependencies because Vite bundles them; published Inkling packages never depend on them.

CI checks out the submodule with the `ELANOR_TOKEN` secret, a token with read access to the Elanor repository.

## Styles

`packages/frontend/src/styles/index.css` declares the cascade layers and imports
`@earendil-works/elanor-react/elanor.min.css`. Elanor's JavaScript does not import component CSS. Inkling's own CSS
Modules are unlayered, so they win over Elanor's layered styles.

## Fonts and tokens

The frontend's Vite plugin (`packages/frontend/scripts/elanor-assets.ts`) serves the font package's CSS, font files,
and licenses at `/fonts/elanor/`, and the `earendil` brand tokens followed by Inkling's domain tokens at `/tokens.css`.
It serves them directly in development and emits them unchanged into the build, so the application shell and the
server-rendered public and OAuth pages share the same URLs. A deployment theme (`/theme.css`) loads after the tokens and
overrides them. Tokens select font families; the font stylesheets only register faces.

## Updating

```sh
git -C vendor/elanor-src fetch
git -C vendor/elanor-src checkout <commit>
node scripts/build-elanor.mjs
pnpm install
```

Commit the submodule pointer and `pnpm-lock.yaml` together.

## Icons

The icon package contains about 4,000 Material Symbols. Only the icons Elanor's components import and those listed in
`icons.json` are kept. To use another icon, add its export name (for example `"TerminalIcon"`) to `icons.json` and
rerun the script.
