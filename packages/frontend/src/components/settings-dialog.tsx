import { useEffect, useState } from "react";

import {
  Button,
  CodeSnippet,
  ControlAndLabel,
  Form,
  Heading,
  InlineCode,
  Input,
  Link,
  Separator,
  Stack,
  Text,
} from "@earendil-works/elanor-react";
import type { ApiKeyCreated, ApiKeyDto } from "@earendil-works/inkling-protocol";

import type { ApiClientService, ApiError } from "../api.ts";
import { copyText } from "../clipboard.ts";
import type { ClipboardError } from "../clipboard.ts";
import { useEffectAction, useEffectQuery } from "../effect-hooks.ts";
import { formatLocalDate } from "../ui.ts";
import { ConfirmationDialog } from "./confirmation-dialog.tsx";
import { Dialog } from "./dialog.tsx";
import { FormError } from "./form-error.tsx";
import styles from "./settings-dialog.module.css";

export interface SettingsDialogProps {
  readonly api: ApiClientService;
  readonly onClose: () => void;
}

export function SettingsDialog({ api, onClose }: SettingsDialogProps): React.JSX.Element {
  const [label, setLabel] = useState("Agent access");
  const [keys, setKeys] = useState<readonly ApiKeyDto[]>([]);
  const [revealedKeys, setRevealedKeys] = useState<Readonly<Record<string, string>>>({});
  const [visibleKeyIds, setVisibleKeyIds] = useState<readonly string[]>([]);
  const [copiedKeyId, setCopiedKeyId] = useState<string>();
  const [revealingKeyId, setRevealingKeyId] = useState<string>();
  const [createOpen, setCreateOpen] = useState(false);
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKeyDto>();
  const keyQuery = useEffectQuery(api.listApiKeys, "api-keys");
  const createKey = useEffectAction<string, ApiKeyCreated, ApiError>((value) =>
    api.createApiKey(value),
  );
  const revealKey = useEffectAction<string, ApiKeyCreated, ApiError>((keyId) =>
    api.revealApiKey(keyId),
  );
  const revokeKey = useEffectAction<string, void, ApiError>((keyId) => api.revokeApiKey(keyId));
  const copyKey = useEffectAction<string, void, ClipboardError>(copyText);

  useEffect(() => {
    const loaded = keyQuery.state.data;
    if (loaded === undefined) return;
    setKeys(loaded);
    if (!loaded.some((key) => key.revokedAt === undefined)) setCreateOpen(true);
  }, [keyQuery.state.data]);

  const activeKeys = keys.filter((key) => key.revokedAt === undefined);
  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const normalizedLabel = label.trim();
    if (normalizedLabel === "") return;
    createKey.execute(normalizedLabel, {
      onSuccess: (created) => {
        setKeys((current) => [created.metadata, ...current]);
        setRevealedKeys((current) => ({ ...current, [created.metadata.id]: created.key }));
        setVisibleKeyIds((current) => [...new Set([...current, created.metadata.id])]);
        setCopiedKeyId(undefined);
        setCreateOpen(false);
        setLabel("Agent access");
      },
    });
  };

  const toggleKey = (key: ApiKeyDto): void => {
    if (visibleKeyIds.includes(key.id)) {
      setVisibleKeyIds((current) => current.filter((id) => id !== key.id));
      setCopiedKeyId(undefined);
      return;
    }
    if (revealedKeys[key.id] !== undefined) {
      setVisibleKeyIds((current) => [...new Set([...current, key.id])]);
      return;
    }
    setRevealingKeyId(key.id);
    revealKey.execute(key.id, {
      onFailure: () => setRevealingKeyId(undefined),
      onSuccess: (revealed) => {
        setRevealedKeys((current) => ({ ...current, [key.id]: revealed.key }));
        setVisibleKeyIds((current) => [...new Set([...current, key.id])]);
        setRevealingKeyId(undefined);
      },
    });
  };

  const errors = [
    keyQuery.state.status === "failure" ? keyQuery.state.error.message : undefined,
    createKey.state.error?.message,
    revealKey.state.error?.message,
    revokeKey.state.error?.message,
    copyKey.state.error?.message,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <Dialog
        attributes={{ "data-settings-dialog": "" }}
        closeLabel="Close API keys"
        onClose={onClose}
        open
        title="API keys"
      >
        <Stack align="stretch" gap="large">
          <Stack align="stretch" gap="small">
            <Text className={styles["note"]} data-settings-note="">
              Reuse an active key for coding agents. Create another only when you need separate
              rotation or revocation. Keys have the same workspace permissions you do.
            </Text>
            <Text className={styles["note"]} data-mcp-endpoint="">
              Agents connect to the MCP server at{" "}
              <InlineCode>{`${location.origin}/mcp`}</InlineCode> and send the key as a bearer
              token. <Link href="/AGENTS.md">Setup instructions</Link>
            </Text>
          </Stack>

          <Separator />

          <section
            aria-labelledby="api-key-list-title"
            className={styles["section"]}
            data-api-keys=""
          >
            <Stack align="start" direction="row" gap="auto">
              <Stack gap="xxSmall">
                <Heading id="api-key-list-title" level={3}>
                  Reusable access
                </Heading>
                <Text className={styles["note"]}>
                  Show and copy a key whenever you connect another agent.
                </Text>
              </Stack>
              <span aria-label={`${activeKeys.length} active keys`} className={styles["count"]}>
                {activeKeys.length}
              </span>
            </Stack>
            {keyQuery.state.status === "loading" && keys.length === 0 ? (
              <Text className={styles["note"]}>Loading keys…</Text>
            ) : null}
            {activeKeys.length === 0 && keyQuery.state.status !== "loading" ? (
              <Text className={styles["note"]}>
                Create one key and reuse it across your agents.
              </Text>
            ) : null}
            {activeKeys.map((key) => {
              const secret = revealedKeys[key.id];
              const visible = visibleKeyIds.includes(key.id) && secret !== undefined;
              return (
                <article className={styles["key"]} data-api-key={key.id} key={key.id}>
                  <Stack align="stretch" gap="xSmall">
                    <Stack align="center" direction="row" gap="auto" wrap="wrap">
                      <strong className={styles["keyLabel"]}>{key.label}</strong>
                      <Text className={styles["meta"]} render={<span />}>
                        {keyActivity(key)}
                      </Text>
                    </Stack>
                    {visible ? (
                      <CodeSnippet className={styles["secret"]} data-api-key-secret="">
                        {secret}
                      </CodeSnippet>
                    ) : (
                      <CodeSnippet
                        className={styles["secret"]}
                      >{`${key.id}.••••••••••••`}</CodeSnippet>
                    )}
                    {key.oauthClientName !== undefined ? (
                      <Text className={styles["meta"]} data-oauth-key="">
                        Connected by signing in from {key.oauthClientName}. Revoke it to disconnect.
                      </Text>
                    ) : !key.revealable ? (
                      <Text className={styles["meta"]}>
                        This older key cannot be shown again. Replace it when convenient.
                      </Text>
                    ) : null}
                  </Stack>
                  <Stack direction="row" gap="xSmall" wrap="wrap">
                    {key.oauthClientName === undefined ? (
                      <Button
                        data-show-api-key={key.id}
                        density="compact"
                        disabled={!key.revealable}
                        hierarchy="secondary"
                        onClick={() => toggleKey(key)}
                        pending={revealingKeyId === key.id}
                      >
                        {visible ? "Hide" : "Show"}
                      </Button>
                    ) : null}
                    {visible && secret !== undefined ? (
                      <Button
                        data-copy-api-key=""
                        density="compact"
                        hierarchy="secondary"
                        onClick={() =>
                          copyKey.execute(secret, {
                            onSuccess: () => setCopiedKeyId(key.id),
                          })
                        }
                      >
                        {copiedKeyId === key.id ? "Copied" : "Copy API key"}
                      </Button>
                    ) : null}
                    <Button
                      data-revoke-key={key.id}
                      density="compact"
                      hierarchy="tertiary"
                      onClick={() => setKeyToRevoke(key)}
                      semantic="negative"
                    >
                      Revoke
                    </Button>
                  </Stack>
                </article>
              );
            })}
          </section>

          <Separator />

          {createOpen ? (
            <Form
              aria-labelledby="api-key-create-title"
              className={styles["section"]}
              data-settings-form=""
              onSubmit={submit}
            >
              <Stack gap="xxSmall">
                <Heading id="api-key-create-title" level={3}>
                  {activeKeys.length === 0 ? "Create your API key" : "Create another API key"}
                </Heading>
                <Text className={styles["note"]}>
                  Use a separate key only when it needs its own revocation lifecycle.
                </Text>
              </Stack>
              <div className={styles["createControls"]}>
                <ControlAndLabel label="Key name">
                  <Input
                    maxLength={200}
                    name="api-key-label"
                    onValueChange={setLabel}
                    placeholder="Agent access"
                    required
                    value={label}
                  />
                </ControlAndLabel>
                <Button pending={createKey.state.pending} type="submit">
                  Create API key
                </Button>
              </div>
              {activeKeys.length > 0 ? (
                <div>
                  <Button hierarchy="tertiary" onClick={() => setCreateOpen(false)}>
                    Cancel
                  </Button>
                </div>
              ) : null}
            </Form>
          ) : (
            <Stack align="center" direction="row" gap="auto" wrap="wrap">
              <Text className={styles["note"]}>Need an independently revocable key?</Text>
              <Button hierarchy="secondary" onClick={() => setCreateOpen(true)}>
                Create another key
              </Button>
            </Stack>
          )}

          <Text className={styles["note"]}>
            Store keys only in your agent's secret storage, an environment variable, or a password
            manager. Never put one in AGENTS.md, an agent skill, chat, or source control.
          </Text>
          <FormError data-settings-error="">{errors}</FormError>
        </Stack>
      </Dialog>
      <ConfirmationDialog
        confirmLabel="Revoke key"
        description={
          keyToRevoke === undefined
            ? "This API key will stop working immediately."
            : `“${keyToRevoke.label}” will stop working immediately.`
        }
        onCancel={() => setKeyToRevoke(undefined)}
        onConfirm={() => {
          if (keyToRevoke === undefined) return;
          revokeKey.execute(keyToRevoke.id, {
            onFailure: () => setKeyToRevoke(undefined),
            onSuccess: () => {
              setKeys((current) => current.filter((item) => item.id !== keyToRevoke.id));
              setRevealedKeys((current) =>
                Object.fromEntries(Object.entries(current).filter(([id]) => id !== keyToRevoke.id)),
              );
              setVisibleKeyIds((current) => current.filter((id) => id !== keyToRevoke.id));
              setKeyToRevoke(undefined);
            },
          });
        }}
        open={keyToRevoke !== undefined}
        pending={revokeKey.state.pending}
        title="Revoke this API key?"
        tone="danger"
      />
    </>
  );
}

function keyActivity(key: ApiKeyDto): string {
  return key.lastUsedAt === undefined
    ? `Created ${formatLocalDate(key.createdAt)} · Never used`
    : `Last used ${formatLocalDate(key.lastUsedAt)}`;
}
