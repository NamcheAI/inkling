import { useEffect, useState } from "react";
import { Effect } from "effect";

import { ShareIcon } from "@earendil-works/elanor-icons-react";
import {
  Button,
  Checkbox,
  ControlAndLabel,
  Fieldset,
  Form,
  Heading,
  Input,
  Radio,
  SelectionControlAndLabel,
  Separator,
  Stack,
  Text,
} from "@earendil-works/elanor-react";
import type {
  ShareLinkDto,
  ShareLinksResponse,
  SharingPolicyDto,
} from "@earendil-works/inkling-protocol";

import type { ApiClientService, ApiError } from "../api.ts";
import { useAppContext } from "../app-context.tsx";
import { copyText } from "../clipboard.ts";
import type { ClipboardError } from "../clipboard.ts";
import { useEffectAction, useEffectQuery } from "../effect-hooks.ts";
import { formatDate } from "../ui.ts";
import { Dialog } from "./dialog.tsx";
import { FormError } from "./form-error.tsx";
import styles from "./sharing-control.module.css";

type ShareAccess = "view" | "comment" | "edit";
type ShareAction =
  | {
      readonly access: ShareAccess;
      readonly password?: string | undefined;
      readonly type: "create";
    }
  | { readonly id: string; readonly type: "delete" };

const accessOptions: readonly { readonly label: string; readonly value: ShareAccess }[] = [
  { label: "View", value: "view" },
  { label: "View and comment", value: "comment" },
  { label: "View, comment, and edit", value: "edit" },
];

export interface SharingControlProps {
  readonly access: SharingPolicyDto["access"];
  readonly api: ApiClientService;
  readonly documentId: string;
  readonly onUpdated: (response: ShareLinksResponse) => void;
}

export function SharingControl({
  access,
  api,
  documentId,
  onUpdated,
}: SharingControlProps): React.JSX.Element {
  const { showToast } = useAppContext();
  const [open, setOpen] = useState(false);
  const [selectedAccess, setSelectedAccess] = useState<ShareAccess>(
    access === "disabled" ? "view" : access,
  );
  const [passwordProtected, setPasswordProtected] = useState(false);
  const [password, setPassword] = useState("");
  const linksQuery = useEffectQuery(
    open ? api.listShareLinks(documentId) : Effect.succeed(undefined),
    `share-links:${documentId}:${open ? "open" : "closed"}`,
  );
  const links = linksQuery.state.data?.links ?? [];
  const shareAction = useEffectAction<ShareAction, ShareLinksResponse, ApiError>((action) =>
    api.listShareLinks(documentId).pipe(
      Effect.flatMap((current) =>
        action.type === "create"
          ? api.createShareLink(documentId, {
              access: action.access,
              expectedRevision: current.revision,
              password: action.password,
            })
          : api.deleteShareLink(documentId, action.id, current.revision),
      ),
    ),
  );

  useEffect(() => {
    if (access !== "disabled") setSelectedAccess(access);
  }, [access]);

  const duplicateConfiguration = links.some(
    (link) => link.access === selectedAccess && link.passwordProtected === passwordProtected,
  );
  const pending = shareAction.state.pending;
  const copy = useEffectAction<string, void, ClipboardError>(copyText);
  const copyLink = (url: string, copiedMessage: string): void =>
    copy.execute(url, {
      onFailure: (error) => showToast(error.message, "error"),
      onSuccess: () => showToast(copiedMessage, "success"),
    });
  const applyResponse = (response: ShareLinksResponse): void => {
    onUpdated(response);
    linksQuery.refresh();
  };

  return (
    <>
      <Button
        data-share=""
        hierarchy="tertiary"
        iconStart={<ShareIcon />}
        onClick={() => setOpen(true)}
      >
        Share
      </Button>
      <Dialog
        closeLabel="Close sharing settings"
        description="Links grant access to the working draft without a workspace account."
        onClose={() => setOpen(false)}
        open={open}
        pending={pending}
        title="Share document"
      >
        <Stack align="stretch" gap="large">
          <section aria-labelledby="share-link-list-title" className={styles["section"]}>
            <Stack align="center" direction="row" gap="auto">
              <Heading id="share-link-list-title" level={3}>
                Active links
              </Heading>
              <span className={styles["count"]}>{links.length}</span>
            </Stack>
            {linksQuery.state.status === "loading" && links.length === 0 ? (
              <Text className={styles["note"]}>Loading share links…</Text>
            ) : links.length === 0 ? (
              <Text className={styles["note"]}>This document has no share links.</Text>
            ) : (
              <ul className={styles["links"]}>
                {links.map((link) => (
                  <ShareLinkRow
                    disabled={pending}
                    key={link.id}
                    link={link}
                    onCopy={(url) => copyLink(url, "Share link copied.")}
                    onDelete={(id) =>
                      shareAction.execute(
                        { id, type: "delete" },
                        {
                          onSuccess: (response) => {
                            applyResponse(response);
                            showToast("Share link deleted.", "success");
                          },
                        },
                      )
                    }
                  />
                ))}
              </ul>
            )}
            {linksQuery.state.status === "failure" ? (
              <FormError>{linksQuery.state.error.message}</FormError>
            ) : null}
          </section>

          <Separator />

          <Form
            aria-labelledby="share-link-create-title"
            className={styles["section"]}
            onSubmit={(event) => {
              event.preventDefault();
              if (duplicateConfiguration || (passwordProtected && password.length < 8)) return;
              const previousIds = new Set(links.map((link) => link.id));
              shareAction.execute(
                {
                  access: selectedAccess,
                  password: passwordProtected ? password : undefined,
                  type: "create",
                },
                {
                  onSuccess: (response) => {
                    applyResponse(response);
                    const created = response.links.find((link) => !previousIds.has(link.id));
                    setPassword("");
                    if (created?.url === undefined) showToast("Share link created.", "success");
                    else copyLink(created.url, "Share link created and copied.");
                  },
                },
              );
            }}
          >
            <Heading id="share-link-create-title" level={3}>
              Create a link
            </Heading>
            <Fieldset.Root
              render={
                <Radio.Group
                  onValueChange={(value) => {
                    if (isShareAccess(value)) setSelectedAccess(value);
                  }}
                  value={selectedAccess}
                />
              }
            >
              <Fieldset.Legend>Anyone with this link can</Fieldset.Legend>
              <Stack gap="small">
                {accessOptions.map((option) => (
                  <SelectionControlAndLabel
                    control={
                      <Radio.Root value={option.value}>
                        <Radio.Indicator />
                      </Radio.Root>
                    }
                    key={option.value}
                  >
                    {option.label}
                  </SelectionControlAndLabel>
                ))}
              </Stack>
            </Fieldset.Root>
            <SelectionControlAndLabel
              control={
                <Checkbox.Root checked={passwordProtected} onCheckedChange={setPasswordProtected}>
                  <Checkbox.Indicator />
                </Checkbox.Root>
              }
            >
              Require a password
            </SelectionControlAndLabel>
            {passwordProtected ? (
              <ControlAndLabel
                description="At least eight characters."
                error="Enter at least eight characters."
                label="Password"
              >
                <Input
                  autoComplete="new-password"
                  minLength={8}
                  onValueChange={setPassword}
                  required
                  type="password"
                  value={password}
                />
              </ControlAndLabel>
            ) : null}
            {duplicateConfiguration ? (
              <Text className={styles["note"]} data-share-duplicate="">
                A link with this access and protection already exists.
              </Text>
            ) : null}
            <FormError>{shareAction.state.error?.message}</FormError>
            <div>
              <Button
                disabled={
                  linksQuery.state.status === "loading" ||
                  duplicateConfiguration ||
                  (passwordProtected && password.length < 8)
                }
                pending={pending}
                type="submit"
              >
                Create and copy link
              </Button>
            </div>
          </Form>
        </Stack>
      </Dialog>
    </>
  );
}

function ShareLinkRow({
  disabled,
  link,
  onCopy,
  onDelete,
}: {
  readonly disabled: boolean;
  readonly link: ShareLinkDto;
  readonly onCopy: (url: string) => void;
  readonly onDelete: (id: string) => void;
}): React.JSX.Element {
  const label = accessLabel(link.access);
  return (
    <li className={styles["link"]} data-share-link={link.id}>
      <Stack gap="xxSmall">
        <strong className={styles["linkLabel"]}>{label}</strong>
        <Text className={styles["meta"]}>
          {link.passwordProtected ? "Password protected" : "No password"} · Created{" "}
          {formatDate(link.createdAt)}
        </Text>
        {link.url === undefined ? (
          <Text className={styles["meta"]}>
            Created before retained links; its URL cannot be shown again.
          </Text>
        ) : null}
      </Stack>
      <Stack direction="row" gap="xSmall">
        {link.url === undefined ? null : (
          <Button
            aria-label={`Copy ${label.toLocaleLowerCase("en")} share link`}
            density="compact"
            disabled={disabled}
            hierarchy="secondary"
            onClick={() => onCopy(link.url ?? "")}
          >
            Copy
          </Button>
        )}
        <Button
          aria-label={`Delete ${label.toLocaleLowerCase("en")} share link`}
          density="compact"
          disabled={disabled}
          hierarchy="tertiary"
          onClick={() => onDelete(link.id)}
          semantic="negative"
        >
          Delete
        </Button>
      </Stack>
    </li>
  );
}

function accessLabel(access: ShareAccess): string {
  switch (access) {
    case "view":
      return "Can view";
    case "comment":
      return "Can comment";
    case "edit":
      return "Can edit";
  }
}

function isShareAccess(value: unknown): value is ShareAccess {
  return value === "view" || value === "comment" || value === "edit";
}
