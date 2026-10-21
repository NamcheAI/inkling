import type { ReactNode } from "react";

import { Button, Modal } from "@earendil-works/elanor-react";

import { Dialog } from "./dialog.tsx";

export interface ConfirmationDialogProps {
  readonly confirmLabel: string;
  readonly description: ReactNode;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly open: boolean;
  readonly pending?: boolean | undefined;
  readonly title: string;
  readonly tone?: "danger" | "default" | undefined;
}

export function ConfirmationDialog({
  confirmLabel,
  description,
  onCancel,
  onConfirm,
  open,
  pending = false,
  title,
  tone = "default",
}: ConfirmationDialogProps): React.JSX.Element {
  return (
    <Dialog
      attributes={{ "data-confirmation-dialog": "" }}
      closeLabel="Cancel"
      description={description}
      onClose={onCancel}
      open={open}
      pending={pending}
      title={title}
    >
      <Modal.Actions>
        <Button
          onClick={onConfirm}
          pending={pending}
          semantic={tone === "danger" ? "negative" : "neutral"}
        >
          {confirmLabel}
        </Button>
        <Button disabled={pending} hierarchy="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </Modal.Actions>
    </Dialog>
  );
}
