import { DeleteIcon, DescriptionIcon } from "@earendil-works/elanor-icons-react";
import type { DocumentResponse } from "@earendil-works/inkling-protocol";

import { useRenderedMarkdown } from "../markdown.tsx";
import { metadataWithFrontmatter } from "./document-metadata.ts";
import { DocumentPage } from "./document-page.tsx";
import { EmptyMessage } from "./empty-message.tsx";
import { MarkdownArticle } from "./markdown-article.tsx";
import styles from "./reader.module.css";

export interface ReaderDocumentProps {
  readonly document: DocumentResponse;
}

export function ReaderDocument({ document }: ReaderDocumentProps): React.JSX.Element {
  const rendered = useRenderedMarkdown(document.body, true);
  if (document.metadata.deletedAt !== undefined) {
    return (
      <EmptyMessage
        data-reader=""
        data-trashed=""
        description="Open the editor to inspect or change this document before it is permanently deleted."
        icon={DeleteIcon}
        level={1}
        title={document.metadata.title}
        warning="In Trash"
      />
    );
  }
  if (document.metadata.publishedRevision === undefined) {
    return (
      <EmptyMessage
        data-reader=""
        data-unpublished=""
        description="This document has not been published yet."
        icon={DescriptionIcon}
        level={1}
        title={document.metadata.title}
      />
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
