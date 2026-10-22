// Deployment entry for rfc.namche.ai. It runs the Cloudflare runtime unchanged
// and supplies the Namche theme from the repository instead of a Worker
// variable: Cloudflare caps variables at 5 KB, and a complete theme exceeds that.
import {
  DocumentDurableObject as InklingDocumentDurableObject,
  WorkspaceDurableObject as InklingWorkspaceDurableObject,
  default as inkling,
} from "../../packages/runtime-cloudflare/src/index.ts";
import type { CloudflareEnvironment } from "../../packages/runtime-cloudflare/src/index.ts";
import namcheTheme from "../../themes/namche.json";

const theme = JSON.stringify(namcheTheme);

function themed(environment: CloudflareEnvironment): CloudflareEnvironment {
  return { ...environment, INKLING_THEME: theme };
}

export class WorkspaceDurableObject extends InklingWorkspaceDurableObject {
  constructor(state: DurableObjectState, environment: CloudflareEnvironment) {
    super(state, themed(environment));
  }
}

export class DocumentDurableObject extends InklingDocumentDurableObject {
  constructor(state: DurableObjectState, environment: CloudflareEnvironment) {
    super(state, themed(environment));
  }
}

export default {
  fetch: (request, environment, context) => inkling.fetch!(request, themed(environment), context),
} satisfies ExportedHandler<CloudflareEnvironment>;
