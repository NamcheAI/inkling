import { useState } from "react";

import { AddIcon } from "@earendil-works/elanor-icons-react";
import { Button } from "@earendil-works/elanor-react";

import type { ApiClientService } from "../api.ts";
import { NewDocumentDialog } from "./new-document-dialog.tsx";

export interface NewDocumentControlProps {
  readonly api: ApiClientService;
}

export function NewDocumentControl({ api }: NewDocumentControlProps): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button data-new-document="" iconStart={<AddIcon />} onClick={() => setOpen(true)}>
        New note or RFC
      </Button>
      <NewDocumentDialog api={api} onDismiss={() => setOpen(false)} open={open} />
    </>
  );
}
