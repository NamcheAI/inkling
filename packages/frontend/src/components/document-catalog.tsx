import { useCallback, useEffect, useRef, useState } from "react";

import { DescriptionIcon } from "@earendil-works/elanor-icons-react";
import type { CatalogResponse } from "@earendil-works/inkling-protocol";

import { isEditableElement } from "../ui.ts";
import styles from "./document-catalog.module.css";
import { DocumentCatalogRow } from "./document-catalog-row.tsx";
import { EmptyMessage } from "./empty-message.tsx";

export interface DocumentCatalogProps {
  readonly catalog: CatalogResponse;
  readonly publicCatalog?: boolean | undefined;
}

export function DocumentCatalog({
  catalog,
  publicCatalog = false,
}: DocumentCatalogProps): React.JSX.Element {
  // The anchor is where j/k continues from; the marker is only shown after keyboard navigation.
  const selectionAnchorRef = useRef<string | undefined>(undefined);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>();
  const selectedDocumentIdRef = useRef<string | undefined>(undefined);
  const selectDocument = useCallback((documentId: string | undefined, scroll: boolean): void => {
    selectionAnchorRef.current = documentId;
    selectedDocumentIdRef.current = documentId;
    setSelectedDocumentId(documentId);
    if (!scroll || documentId === undefined) return;
    requestAnimationFrame(() => {
      catalogRow(documentId)?.scrollIntoView({ block: "nearest" });
    });
  }, []);
  const moveSelection = useCallback(
    (direction: -1 | 1): void => {
      const documents = catalog.documents;
      if (documents.length === 0) return;
      const currentIndex = documents.findIndex(
        (document) => document.metadata.id === selectionAnchorRef.current,
      );
      const nextIndex =
        currentIndex === -1
          ? direction === 1
            ? 0
            : documents.length - 1
          : Math.max(0, Math.min(documents.length - 1, currentIndex + direction));
      const nextDocument = documents[nextIndex];
      if (nextDocument !== undefined) selectDocument(nextDocument.metadata.id, true);
    },
    [catalog.documents, selectDocument],
  );

  const resultKey = catalog.documents.map((document) => document.metadata.id).join("\n");
  useEffect(() => {
    // Different results start a fresh selection so Enter never opens a stale choice.
    selectDocument(undefined, false);
  }, [resultKey, selectDocument]);

  useEffect(() => {
    // Editing the query starts a new search, so Enter should submit it rather than open a row.
    const handleSearchInput = (event: Event): void => {
      if (event.target instanceof HTMLElement && event.target.matches("[data-search]")) {
        selectDocument(undefined, false);
      }
    };
    document.addEventListener("input", handleSearchInput);
    return () => document.removeEventListener("input", handleSearchInput);
  }, [selectDocument]);

  useEffect(() => {
    const handleKeyboardSelection = (event: KeyboardEvent): void => {
      if (catalog.documents.length === 0 || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [popover]') !== null
      ) {
        return;
      }
      const editable = isEditableElement(target);
      const searchInput = target instanceof HTMLElement && target.matches("[data-search]");
      if (event.key === "Enter" || event.key === "Escape") {
        const selected = selectedDocumentIdRef.current;
        // Only act for the page itself or the search field; other controls own their keys.
        if (selected === undefined || !(searchInput || isPageTarget(target))) return;
        if (event.key === "Escape") {
          selectDocument(undefined, false);
          return;
        }
        if (event.shiftKey) return;
        event.preventDefault();
        catalogRow(selected)?.click();
        return;
      }
      const key = event.key.toLowerCase();
      const direction =
        event.key === "ArrowDown" || (key === "j" && !editable)
          ? 1
          : event.key === "ArrowUp" || (key === "k" && !editable)
            ? -1
            : undefined;
      if (direction === undefined) return;
      if (editable && !searchInput) return;
      event.preventDefault();
      moveSelection(direction);
    };
    document.addEventListener("keydown", handleKeyboardSelection);
    return () => document.removeEventListener("keydown", handleKeyboardSelection);
  }, [catalog.documents.length, moveSelection, selectDocument]);

  if (catalog.documents.length === 0) {
    return (
      <section aria-live="polite" data-catalog="">
        <EmptyMessage
          description={
            publicCatalog
              ? "No public revisions have been published yet."
              : "Create one or adjust the search."
          }
          icon={DescriptionIcon}
          level={2}
          title="No notes or RFCs found."
        />
      </section>
    );
  }

  return (
    <section aria-live="polite" className={styles["catalog"]} data-catalog="">
      {catalog.documents.map((document) => (
        <DocumentCatalogRow
          document={document}
          key={document.metadata.id}
          onFocus={() => {
            selectionAnchorRef.current = document.metadata.id;
          }}
          publicDocument={publicCatalog}
          selected={document.metadata.id === selectedDocumentId}
        />
      ))}
    </section>
  );
}

function catalogRow(documentId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-catalog-document-id="${CSS.escape(documentId)}"]`,
  );
}

function isPageTarget(target: EventTarget | null): boolean {
  return target === null || target === document.body || target === document.documentElement;
}
