// The contract of the server renderer, `@earendil-works/inkling-frontend/server`.
// Runtimes typecheck against this file; `server.tsx` implements it and is
// built into `dist-server/` with the browser assets it references.

export interface RenderApplicationOptions {
  /** The browser's page request. */
  readonly request: Request;
  /**
   * Answers the application's API requests in-process, as the server would
   * answer them from the browser. Requests carry the page request's cookies.
   */
  readonly fetch: (request: Request) => Promise<Response>;
  /** The built application shell, `dist/index.html`. */
  readonly template: string;
}

/**
 * Renders an application page on the server. The response streams the shell's
 * head immediately, so the browser fetches scripts and styles while the route
 * loads, then the rendered route and the data the browser hydrates it with.
 * Returns `undefined` for paths that are not application pages.
 */
export declare function renderApplication(options: RenderApplicationOptions): Response | undefined;
