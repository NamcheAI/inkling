import { DeleteIcon, LabelIcon } from "@earendil-works/elanor-icons-react";
import type { CatalogResponse } from "@earendil-works/inkling-protocol";

import type { ApiClientService } from "../api.ts";
import { ButtonLink } from "./button-link.tsx";
import styles from "./catalog-controls.module.css";
import { DocumentSearch } from "./document-search.tsx";

export interface CatalogControlsProps {
  readonly api: ApiClientService;
  readonly initialCatalog: CatalogResponse;
  readonly onResultsChange: (catalog: CatalogResponse) => void;
  readonly publicCatalog?: boolean | undefined;
  readonly showTrash?: boolean | undefined;
}

export function CatalogControls({
  api,
  initialCatalog,
  onResultsChange,
  publicCatalog = false,
  showTrash = false,
}: CatalogControlsProps): React.JSX.Element {
  return (
    <section aria-label="Document tools" className={styles["tools"]} data-catalog-tools="">
      <DocumentSearch
        api={api}
        initialCatalog={initialCatalog}
        onResultsChange={onResultsChange}
        publicCatalog={publicCatalog}
      />
      <div className={styles["links"]} data-catalog-tool-links="">
        <ButtonLink hierarchy="tertiary" iconStart={<LabelIcon />} href="/labels">
          Browse labels
        </ButtonLink>
        {showTrash ? (
          <ButtonLink hierarchy="tertiary" iconStart={<DeleteIcon />} href="/trash">
            Trash
          </ButtonLink>
        ) : null}
      </div>
    </section>
  );
}
