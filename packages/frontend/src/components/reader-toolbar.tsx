import { EditIcon } from "@earendil-works/elanor-icons-react";
import type { DocumentMetadataDto } from "@earendil-works/inkling-protocol";

import { documentHref } from "../ui.ts";
import { ButtonLink } from "./button-link.tsx";
import styles from "./reader.module.css";

export interface ReaderToolbarProps {
  readonly metadata: DocumentMetadataDto;
  readonly publicDocument?: boolean | undefined;
  readonly shared: boolean;
}

export function ReaderToolbar({
  metadata,
  publicDocument = false,
  shared,
}: ReaderToolbarProps): React.JSX.Element | null {
  const canEdit = !publicDocument && (!shared || metadata.sharing.access === "edit");
  if (!canEdit) return null;

  return (
    <nav aria-label="Document navigation" className={styles["toolbar"]}>
      <ButtonLink
        data-open-editor=""
        iconStart={<EditIcon />}
        href={documentHref(metadata.id, metadata.rfcNumber, shared, "edit")}
      >
        Edit
      </ButtonLink>
    </nav>
  );
}
