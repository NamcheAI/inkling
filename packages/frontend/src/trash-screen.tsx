import { useEffect, useState } from "react";

import {
  ArrowBackIcon,
  DeleteIcon,
  EditIcon,
  RestoreFromTrashIcon,
} from "@earendil-works/elanor-icons-react";
import {
  Button,
  Container,
  EmptyState,
  Layout,
  Page,
  PageHeader,
} from "@earendil-works/elanor-react";
import { documentTrashExpiresAt } from "@earendil-works/inkling-core";
import type { CatalogResponse, DocumentSummary } from "@earendil-works/inkling-protocol";

import type { ApiClientService, ApiError } from "./api.ts";
import { useAppContext } from "./app-context.tsx";
import { documentFolio, documentHref, formatLocalDate } from "./ui.ts";
import { ButtonLink } from "./components/button-link.tsx";
import { ConfirmationDialog } from "./components/confirmation-dialog.tsx";
import { useEffectAction } from "./effect-hooks.ts";
import styles from "./trash-screen.module.css";
import workspaceStyles from "./workspace.module.css";

export interface TrashScreenProps {
  readonly api: ApiClientService;
  readonly initialCatalog: CatalogResponse;
}

interface TrashMutation {
  readonly documentId: string;
  readonly expectedRevision: number;
}

export function TrashScreen({ api, initialCatalog }: TrashScreenProps): React.JSX.Element {
  const { showToast } = useAppContext();
  const [catalog, setCatalog] = useState(initialCatalog);
  const [permanentCandidate, setPermanentCandidate] = useState<DocumentSummary>();
  const restoreDocument = useEffectAction<TrashMutation, unknown, ApiError>(
    ({ documentId, expectedRevision }) => api.restoreDocument(documentId, expectedRevision),
  );
  const hardDeleteDocument = useEffectAction<TrashMutation, void, ApiError>(
    ({ documentId, expectedRevision }) => api.hardDeleteDocument(documentId, expectedRevision),
  );

  useEffect(() => setCatalog(initialCatalog), [initialCatalog]);

  const removeFromList = (documentId: string): void =>
    setCatalog((current) => ({
      ...current,
      documents: current.documents.filter((document) => document.metadata.id !== documentId),
    }));

  return (
    <>
      <Layout.Main
        className={workspaceStyles["layout"]}
        data-trash=""
        data-workspace-layout=""
        id="app"
        tabIndex={-1}
      >
        <Container>
          <Page>
            <PageHeader.Root data-workspace-heading="">
              <PageHeader.Row>
                <PageHeader.Title level={1}>Trash</PageHeader.Title>
                <PageHeader.Actions>
                  <ButtonLink hierarchy="tertiary" iconStart={<ArrowBackIcon />} href="/">
                    All documents
                  </ButtonLink>
                </PageHeader.Actions>
              </PageHeader.Row>
              <PageHeader.Description className={workspaceStyles["description"]}>
                Documents are permanently deleted 30 days after they enter Trash.
              </PageHeader.Description>
            </PageHeader.Root>
            {catalog.documents.length === 0 ? (
              <section className={styles["empty"]} data-trash-catalog="">
                <EmptyState.Root data-empty-state="">
                  <EmptyState.Illustration>
                    <DeleteIcon aria-hidden="true" className={styles["illustration"]} />
                  </EmptyState.Illustration>
                  <EmptyState.Body>
                    <EmptyState.Copy>
                      <EmptyState.Title level={2}>Trash is empty.</EmptyState.Title>
                      <EmptyState.Description>
                        Deleted documents will remain here for 30 days.
                      </EmptyState.Description>
                    </EmptyState.Copy>
                  </EmptyState.Body>
                </EmptyState.Root>
              </section>
            ) : (
              <section className={styles["catalog"]} data-trash-catalog="">
                {catalog.documents.map((document) => {
                  const metadata = document.metadata;
                  const expiresAt = documentTrashExpiresAt(metadata);
                  const busy = restoreDocument.state.pending || hardDeleteDocument.state.pending;
                  return (
                    <article
                      className={styles["row"]}
                      data-trash-document={metadata.id}
                      key={metadata.id}
                    >
                      <div className={styles["identity"]}>
                        <span className={styles["folio"]}>{documentFolio(metadata.rfcNumber)}</span>
                        <div className={styles["summary"]}>
                          <h2>
                            <a href={documentHref(metadata.id, metadata.rfcNumber, false, "edit")}>
                              {metadata.title}
                            </a>
                          </h2>
                          <p>
                            {metadata.deletedAt === undefined
                              ? "Deletion date unavailable"
                              : `Deleted ${formatLocalDate(metadata.deletedAt)}`}
                            {expiresAt === undefined
                              ? ""
                              : ` · Permanently deletes ${formatLocalDate(expiresAt)}`}
                          </p>
                        </div>
                      </div>
                      <div className={styles["actions"]}>
                        <ButtonLink
                          data-edit-trashed-document={metadata.id}
                          density="compact"
                          hierarchy="secondary"
                          href={documentHref(metadata.id, metadata.rfcNumber, false, "edit")}
                          iconStart={<EditIcon />}
                        >
                          Edit
                        </ButtonLink>
                        <Button
                          data-restore-document={metadata.id}
                          density="compact"
                          disabled={busy}
                          hierarchy="secondary"
                          iconStart={<RestoreFromTrashIcon />}
                          onClick={() =>
                            restoreDocument.execute(
                              {
                                documentId: metadata.id,
                                expectedRevision: metadata.headRevision,
                              },
                              {
                                onFailure: (error) => showToast(error.message, "error"),
                                onSuccess: () => {
                                  removeFromList(metadata.id);
                                  showToast("Document restored.", "success");
                                },
                              },
                            )
                          }
                        >
                          Restore
                        </Button>
                        <Button
                          data-hard-delete-document={metadata.id}
                          density="compact"
                          disabled={busy}
                          hierarchy="tertiary"
                          onClick={() => setPermanentCandidate(document)}
                          semantic="negative"
                        >
                          Delete forever
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </section>
            )}
          </Page>
        </Container>
      </Layout.Main>
      <ConfirmationDialog
        confirmLabel="Delete forever"
        description={
          permanentCandidate === undefined
            ? "This cannot be undone."
            : `“${permanentCandidate.metadata.title}” and all of its attachments and comments will be permanently deleted. This cannot be undone.`
        }
        onCancel={() => setPermanentCandidate(undefined)}
        onConfirm={() => {
          const candidate = permanentCandidate;
          if (candidate === undefined) return;
          hardDeleteDocument.execute(
            {
              documentId: candidate.metadata.id,
              expectedRevision: candidate.metadata.headRevision,
            },
            {
              onFailure: (error) => {
                setPermanentCandidate(undefined);
                showToast(error.message, "error");
              },
              onSuccess: () => {
                removeFromList(candidate.metadata.id);
                setPermanentCandidate(undefined);
                showToast("Document permanently deleted.", "success");
              },
            },
          );
        }}
        open={permanentCandidate !== undefined}
        pending={hardDeleteDocument.state.pending}
        title="Permanently delete this document?"
        tone="danger"
      />
    </>
  );
}
