# rfc.namche.ai

The Namche deployment of this fork: the Cloudflare runtime unchanged, with the
Namche theme bundled by `worker.ts` (a complete theme exceeds Cloudflare's 5 KB
variable limit) and released by `.github/workflows/deploy-namche.yml`.

- **Theme.** `themes/namche.json` is generated in NamcheAI/design-kit from the
  brand tokens and published as `@namche/design-tokens/inkling-theme.json`.
  Never edit it here; update it with `deploy/namche/sync-theme.sh <version>`.
- **Infrastructure.** NamcheAI/infra owns the deploy token (`foundation/`,
  `inkling-worker-deploy`) and the DNS record and route (`apps/inkling.tf`).
- **Once, by an operator.** The R2 bucket `namche-inkling-objects`, the Worker
  secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `GOOGLE_ALLOWED_DOMAINS=namche.ai`, `GOOGLE_ADMIN_EMAILS`,
  `INKLING_OAUTH_STATE_SECRET`), and the repository variable
  `DEPLOYS_ENABLED=1`.
