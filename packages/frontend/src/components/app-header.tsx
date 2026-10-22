import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { DarkModeIcon, LightModeIcon } from "@earendil-works/elanor-icons-react";
import { IconButton, Layout, TopNavigation } from "@earendil-works/elanor-react";
import type { PresenceDto } from "@earendil-works/inkling-protocol";

import type { ApiClientService } from "../api.ts";
import type { AppStatus } from "../app-context.tsx";
import { AccountControl } from "./account-control.tsx";
import type { AccountControlProps } from "./account-control.tsx";
import styles from "./app-header.module.css";
import { ButtonLink } from "./button-link.tsx";
import { applyColorScheme, currentColorScheme, syncThemeColor } from "./color-scheme.ts";
import type { ColorScheme } from "./color-scheme.ts";

export interface BreadcrumbItem {
  readonly href?: string | undefined;
  readonly label: string;
  readonly truncate?: boolean | undefined;
}

export interface AppHeaderProps {
  readonly account: AccountControlProps["account"] | undefined;
  readonly api: ApiClientService | undefined;
  readonly breadcrumbs: readonly BreadcrumbItem[];
  /** Shows a progress bar along the header while the next route loads. */
  readonly navigating: boolean;
  readonly participants: readonly PresenceDto[];
  readonly status: AppStatus | undefined;
}

export function AppHeader({
  account,
  api,
  breadcrumbs,
  navigating,
  participants,
  status,
}: AppHeaderProps): React.JSX.Element {
  const [scheme, setScheme] = useState<ColorScheme>(currentColorScheme);
  const navigation = useNavigationProgress(navigating);

  useEffect(() => {
    syncThemeColor();
    const systemScheme = matchMedia("(prefers-color-scheme: dark)");
    const followSystem = (): void => {
      setScheme(currentColorScheme());
      syncThemeColor();
    };
    systemScheme.addEventListener("change", followSystem);
    return () => systemScheme.removeEventListener("change", followSystem);
  }, []);

  const toggleScheme = (): void => {
    const next = currentColorScheme() === "dark" ? "light" : "dark";
    applyColorScheme(next, true);
    setScheme(next);
  };
  const nextScheme = scheme === "dark" ? "light" : "dark";

  return (
    <Layout.Header
      className={styles["masthead"]}
      data-navigation={navigation}
      render={<TopNavigation.Root />}
    >
      <TopNavigation.Identity className={styles["identity"]}>
        <nav aria-label="Breadcrumb" className={styles["breadcrumbs"]} data-breadcrumbs="">
          <ol>
            {breadcrumbs.map((breadcrumb, index) => {
              const Crumb = breadcrumb.href === undefined ? "span" : "a";
              return (
                <li
                  className={breadcrumb.truncate === true ? styles["truncate"] : undefined}
                  key={`${index}:${breadcrumb.label}`}
                >
                  {index === 0 ? null : (
                    <span aria-hidden="true" className={styles["separator"]}>
                      /
                    </span>
                  )}
                  <Crumb
                    aria-current={index === breadcrumbs.length - 1 ? "page" : undefined}
                    aria-label={index === 0 && Crumb === "a" ? "Inkling home" : undefined}
                    className={index === 0 ? styles["wordmark"] : styles["crumb"]}
                    data-breadcrumb=""
                    href={breadcrumb.href}
                    title={breadcrumb.truncate === true ? breadcrumb.label : undefined}
                  >
                    {index === 0 ? (
                      <>
                        <span aria-hidden="true" className={styles["brandLogo"]} />
                        <span aria-hidden="true" className={styles["brandSeparator"]} />
                      </>
                    ) : null}
                    {breadcrumb.label}
                  </Crumb>
                </li>
              );
            })}
          </ol>
        </nav>
      </TopNavigation.Identity>
      <TopNavigation.Actions className={styles["actions"]}>
        {participants.length === 0 ? null : (
          <div
            aria-label="Connected participants"
            className={styles["participants"]}
            data-participants=""
          >
            {participants.map((participant) => (
              <span
                className={styles["participant"]}
                key={participant.participantId}
                style={{ "--participant": participant.color } as CSSProperties}
                title={participant.displayName}
              >
                {participant.displayName.slice(0, 1).toUpperCase()}
              </span>
            ))}
          </div>
        )}
        {status === undefined ? null : (
          <div aria-live="polite" className={styles["status"]} role="status">
            <span aria-hidden="true" className={styles["statusLight"]} data-state={status.state} />
            <span data-api-status="">{status.label}</span>
          </div>
        )}
        <IconButton
          aria-label={`Switch to ${nextScheme} theme`}
          data-theme-toggle=""
          onClick={(event) => {
            if (event.detail <= 1) toggleScheme();
          }}
        >
          {scheme === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
        </IconButton>
        {api === undefined ? null : account === undefined ? (
          <ButtonLink data-sign-in="" href="/api/auth/google/start">
            Sign in
          </ButtonLink>
        ) : (
          <AccountControl account={account} api={api} />
        )}
      </TopNavigation.Actions>
    </Layout.Header>
  );
}

/** Loading while navigating, then briefly complete so the progress bar can finish and fade. */
function useNavigationProgress(navigating: boolean): "complete" | "idle" | "loading" {
  const [progress, setProgress] = useState<"complete" | "idle" | "loading">("idle");
  useEffect(() => {
    if (navigating) {
      setProgress("loading");
      return;
    }
    setProgress((current) => (current === "loading" ? "complete" : current));
    const timer = setTimeout(() => setProgress("idle"), 180);
    return () => clearTimeout(timer);
  }, [navigating]);
  return progress;
}
