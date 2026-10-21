import { DeleteIcon, DescriptionIcon } from "@earendil-works/elanor-icons-react";
import { EmptyState } from "@earendil-works/elanor-react";
import type { DocumentResponse } from "@earendil-works/inkling-protocol";

import { useRenderedMarkdown } from "../markdown.tsx";
import { metadataWithFrontmatter } from "./document-metadata.ts";
import { DocumentPage } from "./document-page.tsx";
import { MarkdownArticle } from "./markdown-article.tsx";
import styles from "./reader.module.css";

export interface ReaderDocumentProps {
  readonly document: DocumentResponse;
}

export function ReaderDocument({ document }: ReaderDocumentProps): React.JSX.Element {
  const rendered = useRenderedMarkdown(document.body, true);
  if (document.metadata.deletedAt !== undefined) {
    return (
      <EmptyState.Root
        className={styles["unavailable"]}
        data-empty-state=""
        data-reader=""
        data-trashed=""
      >
        <EmptyState.Illustration>
          <DeleteIcon aria-hidden="true" className={styles["illustration"]} />
        </EmptyState.Illustration>
        <EmptyState.Body>
          <EmptyState.Copy>
            <p className={styles["trashedEyebrow"]}>In Trash</p>
            <EmptyState.Title level={1}>{document.metadata.title}</EmptyState.Title>
            <EmptyState.Description>
              Open the editor to inspect or change this document before it is permanently deleted.
            </EmptyState.Description>
          </EmptyState.Copy>
        </EmptyState.Body>
      </EmptyState.Root>
    );
  }
  if (document.metadata.publishedRevision === undefined) {
    return (
      <EmptyState.Root
        className={styles["unavailable"]}
        data-empty-state=""
        data-reader=""
        data-unpublished=""
      >
        <EmptyState.Illustration>
          <DescriptionIcon aria-hidden="true" className={styles["illustration"]} />
        </EmptyState.Illustration>
        <EmptyState.Body>
          <EmptyState.Copy>
            <EmptyState.Title level={1}>{document.metadata.title}</EmptyState.Title>
            <EmptyState.Description>
              This document has not been published yet.
            </EmptyState.Description>
          </EmptyState.Copy>
        </EmptyState.Body>
      </EmptyState.Root>
    );
  }
  const metadata = metadataWithFrontmatter(document.metadata, rendered.frontmatter, rendered.title);

  return (
    <div className={styles["document"]} data-reader="">
      <DocumentPage headings={rendered.headings} metadata={metadata}>
        <MarkdownArticle rendered={rendered} />
      </DocumentPage>
    </div>
  );
}
