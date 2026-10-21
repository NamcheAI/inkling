PNPM ?= pnpm

.PHONY: build check dev elanor format format-check lint setup test typecheck

# Clones the Elanor submodule, builds its packages, and installs dependencies.
setup:
	git submodule update --init vendor/elanor-src
	node scripts/build-elanor.mjs
	$(PNPM) install

# Rebuilds Elanor when the submodule moved; a no-op otherwise.
elanor:
	node scripts/build-elanor.mjs

dev: elanor
	$(PNPM) run dev

build: elanor
	$(PNPM) run build

format:
	$(PNPM) run format

format-check:
	$(PNPM) run format:check

lint:
	$(PNPM) run lint

test:
	$(PNPM) run test

typecheck:
	$(PNPM) run typecheck

check: elanor format-check lint typecheck test build
