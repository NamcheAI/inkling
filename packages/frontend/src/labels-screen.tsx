import { useMemo } from "react";

import { ArrowBackIcon, LabelIcon } from "@earendil-works/elanor-icons-react";
import { Container, Layout, Page, PageHeader, Text } from "@earendil-works/elanor-react";
import type { CatalogResponse } from "@earendil-works/inkling-protocol";

import { ButtonLink } from "./components/button-link.tsx";
import { DocumentCatalog } from "./components/document-catalog.tsx";
import { EmptyMessage } from "./components/empty-message.tsx";
import styles from "./labels-screen.module.css";
import workspaceStyles from "./workspace.module.css";

export interface LabelsScreenProps {
  readonly catalog: CatalogResponse;
  readonly publicCatalog?: boolean | undefined;
  readonly selectedLabel: string | undefined;
}

interface LabelGroup {
  readonly documents: CatalogResponse["documents"];
  readonly label: string;
}

export function LabelsScreen({
  catalog,
  publicCatalog = false,
  selectedLabel,
}: LabelsScreenProps): React.JSX.Element {
  const groups = useMemo(() => groupDocumentsByLabel(catalog), [catalog]);
  const selected =
    selectedLabel === undefined ? undefined : groups.find((group) => group.label === selectedLabel);

  return (
    <Layout.Main
      className={workspaceStyles["layout"]}
      data-workspace-layout=""
      id="app"
      tabIndex={-1}
    >
      <Container>
        <Page>
          <PageHeader.Root data-workspace-heading="">
            <PageHeader.Row>
              <PageHeader.Title level={1}>{selectedLabel ?? "Labels"}</PageHeader.Title>
              <PageHeader.Actions>
                <ButtonLink hierarchy="tertiary" iconStart={<ArrowBackIcon />} href="/">
                  All documents
                </ButtonLink>
              </PageHeader.Actions>
            </PageHeader.Row>
          </PageHeader.Root>
          {selectedLabel === undefined ? (
            <LabelIndex groups={groups} />
          ) : (
            <section aria-live="polite" className={styles["results"]}>
              <div className={styles["resultsHeading"]}>
                <Text className={styles["resultCount"]}>
                  {selected === undefined
                    ? "No notes or RFCs use this label."
                    : `${selected.documents.length} ${selected.documents.length === 1 ? "entry" : "entries"}`}
                </Text>
                <ButtonLink hierarchy="tertiary" iconStart={<LabelIcon />} href="/labels">
                  Browse all labels
                </ButtonLink>
              </div>
              <DocumentCatalog
                catalog={{ documents: selected?.documents ?? [] }}
                publicCatalog={publicCatalog}
              />
            </section>
          )}
        </Page>
      </Container>
    </Layout.Main>
  );
}

function LabelIndex({ groups }: { readonly groups: readonly LabelGroup[] }): React.JSX.Element {
  if (groups.length === 0) {
    return (
      <EmptyMessage
        data-label-index=""
        description="Add labels in a note or RFC’s Markdown frontmatter."
        icon={LabelIcon}
        level={2}
        title="No labels yet."
      />
    );
  }

  return (
    <section className={styles["index"]} data-label-index="" aria-label="Labels">
      {groups.map((group) => (
        <a
          className={styles["item"]}
          href={`/labels?label=${encodeURIComponent(group.label)}`}
          key={group.label}
        >
          <span className={styles["name"]}>{group.label}</span>
          <span className={styles["documents"]}>
            {group.documents
              .slice(0, 3)
              .map((document) => document.metadata.title)
              .join(" · ")}
          </span>
          <span className={styles["count"]}>
            {group.documents.length} {group.documents.length === 1 ? "entry" : "entries"}
          </span>
        </a>
      ))}
    </section>
  );
}

function groupDocumentsByLabel(catalog: CatalogResponse): readonly LabelGroup[] {
  const documentsByLabel = new Map<string, CatalogResponse["documents"]>();
  for (const document of catalog.documents) {
    for (const label of document.metadata.labels) {
      const documents = documentsByLabel.get(label) ?? [];
      documentsByLabel.set(label, [...documents, document]);
    }
  }
  return [...documentsByLabel]
    .map(([label, documents]) => ({ documents, label }))
    .toSorted((left, right) => left.label.localeCompare(right.label));
}
