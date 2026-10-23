export interface NavigateOptions {
  readonly replace?: boolean;
}

export interface ClientRouter {
  readonly dispose: () => void;
  readonly navigate: (destination: string | URL, options?: NavigateOptions) => void;
  readonly refresh: () => void;
}

/**
 * Installs same-document navigation for application routes while leaving
 * downloads, modified clicks, API endpoints, and external links to the browser.
 */
export function installClientRouter(
  isApplicationUrl: (url: URL) => boolean,
  onNavigate: () => void,
): ClientRouter {
  // The route the application last rendered. Fragment-only history moves fire `popstate` too, but
  // they only scroll within the current route and must not reload it.
  let routeLocation = routeLocationOf(location);

  const navigate = (destination: string | URL, options: NavigateOptions = {}): void => {
    const url = destination instanceof URL ? destination : new URL(destination, location.href);
    if (!isApplicationUrl(url)) {
      location.assign(url.href);
      return;
    }

    const next = `${url.pathname}${url.search}${url.hash}`;
    if (options.replace === true) {
      history.replaceState(null, "", next);
    } else if (url.href !== location.href) {
      history.pushState(null, "", next);
    }
    routeLocation = routeLocationOf(location);
    onNavigate();
  };

  const handleClick = (event: MouseEvent): void => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    if (
      anchor === null ||
      anchor.target !== "" ||
      anchor.hasAttribute("download") ||
      anchor.hasAttribute("data-native-navigation")
    ) {
      return;
    }

    const url = new URL(anchor.href, location.href);
    if (!isApplicationUrl(url)) return;
    if (
      url.pathname === location.pathname &&
      url.search === location.search &&
      url.hash !== location.hash
    ) {
      // The browser scrolls to the fragment itself. The route may have changed the search through
      // `history.replaceState`, so remember it as the one the fragment belongs to.
      routeLocation = routeLocationOf(location);
      return;
    }

    event.preventDefault();
    navigate(url);
  };
  const handlePopState = (): void => {
    const next = routeLocationOf(location);
    if (next === routeLocation) return;
    routeLocation = next;
    onNavigate();
  };

  document.addEventListener("click", handleClick);
  window.addEventListener("popstate", handlePopState);

  return {
    dispose: () => {
      document.removeEventListener("click", handleClick);
      window.removeEventListener("popstate", handlePopState);
    },
    navigate,
    refresh: onNavigate,
  };
}

function routeLocationOf({ pathname, search }: Location): string {
  return `${pathname}${search}`;
}
