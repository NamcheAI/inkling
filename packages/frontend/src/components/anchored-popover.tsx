import type { ComponentPropsWithoutRef, ReactNode, RefObject } from "react";

import { Popover } from "@earendil-works/elanor-react";

import styles from "./comments.module.css";

export interface AnchoredPopoverProps extends Omit<
  ComponentPropsWithoutRef<"div">,
  "children" | "className"
> {
  readonly anchorRef: RefObject<HTMLElement | undefined>;
  /** Changes whenever `anchorRef` points at another element, so the popover follows it. */
  readonly anchorRevision: number;
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly onClose: () => void;
  readonly open: boolean;
}

/**
 * An Elanor popover anchored to an element outside React, such as a comment bubble that
 * CodeMirror or the rendered preview owns. Escape and pressing outside call `onClose`.
 */
export function AnchoredPopover({
  anchorRef,
  anchorRevision,
  children,
  className,
  onClose,
  open,
  ...props
}: AnchoredPopoverProps): React.JSX.Element {
  // The anchor lives outside React; `anchorRevision` re-renders this component when it moves.
  const anchor = open && anchorRevision >= 0 ? anchorRef.current : undefined;
  return (
    <Popover.Root
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      open={open && anchor !== undefined}
    >
      <Popover.Portal>
        <Popover.Positioner
          align="start"
          anchor={anchor}
          collisionPadding={12}
          side="right"
          sideOffset={12}
        >
          <Popover.Popup
            {...props}
            className={[styles["anchoredPopover"], className].filter(Boolean).join(" ")}
          >
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
