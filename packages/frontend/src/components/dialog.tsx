import type { ReactNode } from "react";

import { CloseIcon } from "@earendil-works/elanor-icons-react";
import { IconButton, Modal, Stack } from "@earendil-works/elanor-react";

import styles from "./dialog.module.css";

export interface DialogProps {
  /** Additional attributes for the popup, such as `data-*` hooks. */
  readonly attributes?: Readonly<Record<`data-${string}`, string>> | undefined;
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly closeLabel: string;
  readonly description?: ReactNode;
  readonly onClose: () => void;
  readonly open: boolean;
  /** Keeps the dialog open while an action is pending. */
  readonly pending?: boolean | undefined;
  readonly size?: "medium" | "small" | undefined;
  readonly title: ReactNode;
}

/**
 * Elanor's modal with Inkling's standard header: a title and a close button. Escape, the backdrop,
 * and the close button call `onClose` unless an action is pending.
 */
export function Dialog({
  attributes,
  children,
  className,
  closeLabel,
  description,
  onClose,
  open,
  pending = false,
  size = "medium",
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
          <Modal.Popup
            {...attributes}
            className={[styles["popup"], size === "small" ? styles["small"] : undefined, className]
              .filter(Boolean)
              .join(" ")}
          >
            <Stack align="start" direction="row" gap="auto" className={styles["header"]}>
              <Modal.Title>{title}</Modal.Title>
              <Modal.Close
                aria-label={closeLabel}
                disabled={pending}
                render={<IconButton aria-label={closeLabel} />}
              >
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
