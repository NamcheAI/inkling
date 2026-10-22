import { hasPendingPublicationChanges } from "@earendil-works/inkling-core";
import type { CatalogResponse } from "@earendil-works/inkling-protocol";

import { documentFolio, documentHref, formatDate, publicDocumentHref } from "../ui.ts";
import styles from "./document-catalog.module.css";
import { Chip, LifecycleStateChip, VisibilityChip } from "./chip.tsx";

export interface DocumentCatalogRowProps {
  readonly document: CatalogResponse["documents"][number];
  readonly onFocus?: (() => void) | undefined;
  readonly publicDocument?: boolean | undefined;
  readonly selected?: boolean | undefined;
}

export function DocumentCatalogRow({
  document,
  onFocus,
  publicDocument = false,
  selected = false,
}: DocumentCatalogRowProps): React.JSX.Element {
  const { excerpt, metadata } = document;

  return (
    <a
      className={styles["row"]}
      data-catalog-document-id={metadata.id}
      data-catalog-selected={selected ? "" : undefined}
      data-document-visibility={metadata.visibility}
      data-native-navigation={publicDocument ? "" : undefined}
      href={
        publicDocument
          ? publicDocumentHref(metadata.id, metadata.rfcNumber)
          : documentHref(metadata.id, metadata.rfcNumber, false, "read", "")
      }
      onFocus={onFocus}
    >
      <span className={styles["folio"]} data-catalog-folio="">
        {documentFolio(metadata.rfcNumber)}
      </span>
      <span className={styles["main"]}>
        <span className={styles["title"]}>
          <strong>{metadata.title}</strong>
          {!publicDocument && hasPendingPublicationChanges(metadata) ? (
            <Chip data-pending-edits="">Pending edits</Chip>
          ) : null}
        </span>
        <small>{excerpt || "No body text yet"}</small>
      </span>
      <span className={styles["meta"]} data-catalog-metadata="">
        <span className={styles["chipCell"]} data-catalog-visibility="">
          <VisibilityChip visibility={metadata.visibility} />
        </span>
        <span className={styles["chipCell"]}>
          <LifecycleStateChip state={metadata.lifecycleState} />
        </span>
        <time dateTime={metadata.updatedAt}>{formatDate(metadata.updatedAt)}</time>
      </span>
    </a>
  );
}
