import { useState } from "react";

import { KeyboardArrowDownIcon, KeyIcon, LogoutIcon } from "@earendil-works/elanor-icons-react";
import { Button, Menu } from "@earendil-works/elanor-react";
import type { AuthenticationStatus } from "@earendil-works/inkling-protocol";

import type { ApiClientService, ApiError } from "../api.ts";
import { useAppContext } from "../app-context.tsx";
import { useEffectAction } from "../effect-hooks.ts";
import styles from "./app-header.module.css";
import { SettingsDialog } from "./settings-dialog.tsx";

export interface AccountControlProps {
  readonly account: NonNullable<AuthenticationStatus["principal"]>;
  readonly api: ApiClientService;
}

export function AccountControl({ account, api }: AccountControlProps): React.JSX.Element {
  const { navigate } = useAppContext();
  const [apiKeysOpen, setApiKeysOpen] = useState(false);
  const logout = useEffectAction<void, void, ApiError>(() => api.logout);
  const accountName = account.displayName.trim() || account.email?.trim() || "Account";

  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          className={styles["account"]}
          data-account=""
          data-account-trigger=""
          render={<Button hierarchy="tertiary" iconEnd={<KeyboardArrowDownIcon />} />}
          title={account.email ?? accountName}
        >
          <span className={styles["accountName"]} data-account-name="">
            {accountName}
          </span>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="end" sideOffset={4}>
            <Menu.Popup data-account-menu="">
              <Menu.Item
                data-open-api-keys=""
                icon={<KeyIcon />}
                onClick={() => setApiKeysOpen(true)}
              >
                API keys
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item
                closeOnClick={false}
                data-logout=""
                disabled={logout.state.pending}
                icon={<LogoutIcon />}
                onClick={() =>
                  logout.execute(undefined, { onSuccess: () => navigate("/", { replace: true }) })
                }
              >
                {logout.state.pending ? "Signing out…" : "Sign out"}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {apiKeysOpen ? <SettingsDialog api={api} onClose={() => setApiKeysOpen(false)} /> : null}
    </>
  );
}
