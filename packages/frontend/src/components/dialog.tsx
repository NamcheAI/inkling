import type { ReactNode } from "react";

import { CloseIcon } from "@earendil-works/elanor-icons-react";
import { IconButton, Modal, Stack } from "@earendil-works/elanor-react";

export interface DialogProps {
  /** Additional attributes for the popup, such as `data-*` hooks. */
  readonly attributes?: Readonly<Record<`data-${string}`, string>> | undefined;
  readonly children: ReactNode;
  readonly closeLabel: string;
  readonly description?: ReactNode;
  readonly onClose: () => void;
  readonly open: boolean;
  /** Keeps the dialog open while an action is pending. */
  readonly pending?: boolean | undefined;
  readonly title: ReactNode;
}

/**
 * Elanor's modal with Inkling's standard header: a title and a close button. Escape, the backdrop,
 * and the close button call `onClose` unless an action is pending.
 */
export function Dialog({
  attributes,
  children,
  closeLabel,
  description,
  onClose,
  open,
  pending = false,
  title,
}: DialogProps): React.JSX.Element {
  return (
    <Modal.Root
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending) onClose();
      }}
      open={open}
    >
      <Modal.Portal>
        <Modal.Backdrop />
        <Modal.Viewport>
          <Modal.Popup {...attributes}>
            <Stack align="start" direction="row" gap="auto">
              <Modal.Title>{title}</Modal.Title>
              <Modal.Close disabled={pending} render={<IconButton aria-label={closeLabel} />}>
                <CloseIcon />
              </Modal.Close>
            </Stack>
            {description === undefined ? null : (
              <Modal.Description>{description}</Modal.Description>
            )}
            {children}
          </Modal.Popup>
        </Modal.Viewport>
      </Modal.Portal>
    </Modal.Root>
  );
}
