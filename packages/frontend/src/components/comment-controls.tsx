import { useImperativeHandle, useState } from "react";
import type { RefObject } from "react";

import { CloseIcon } from "@earendil-works/elanor-icons-react";
import {
  Checkbox,
  IconButton,
  Popover,
  SelectionControlAndLabel,
  Stack,
} from "@earendil-works/elanor-react";

import type { ProjectedCommentThread } from "../comments.ts";
import styles from "./comments.module.css";

export interface CommentControlsHandle {
  readonly close: () => void;
  readonly open: () => void;
}

export interface CommentControlsProps {
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly onShowResolvedChange: (show: boolean) => void;
  readonly orphaned: readonly ProjectedCommentThread[];
  readonly ref?: React.Ref<CommentControlsHandle> | undefined;
  readonly showResolved: boolean;
}

export function CommentControls({
  anchorRef,
  onShowResolvedChange,
  orphaned,
  ref,
  showResolved,
}: CommentControlsProps): React.JSX.Element {
  const [open, setOpen] = useState(false);

  useImperativeHandle(
    ref,
    () => ({
      close: () => setOpen(false),
      open: () => setOpen(true),
    }),
    [],
  );

  return (
    <Popover.Root onOpenChange={setOpen} open={open}>
      <Popover.Portal>
        <Popover.Positioner align="end" anchor={anchorRef} collisionPadding={16} sideOffset={8}>
          <Popover.Popup
            aria-label="Comment controls"
            className={styles["menu"]}
            data-comment-controls=""
            id="comment-menu"
          >
            <Stack align="start" direction="row" gap="auto">
              <Stack gap="xxSmall">
                <Popover.Title>Comments in context</Popover.Title>
                <Popover.Description>
                  Select Markdown or rendered text to reveal its inline comment control.
                </Popover.Description>
              </Stack>
              <IconButton aria-label="Close comment controls" onClick={() => setOpen(false)}>
                <CloseIcon />
              </IconButton>
            </Stack>
            <SelectionControlAndLabel
              control={
                <Checkbox.Root
                  checked={showResolved}
                  data-show-resolved=""
                  onCheckedChange={onShowResolvedChange}
                >
                  <Checkbox.Indicator />
                </Checkbox.Root>
              }
            >
              Show resolved threads
            </SelectionControlAndLabel>
            {orphaned.length === 0 ? null : (
              <div className={styles["orphaned"]} data-orphaned-comments="">
                <p>
                  <b>
                    {orphaned.length} orphaned {orphaned.length === 1 ? "thread" : "threads"}
                  </b>
                  <br />
                  {orphaned.length === 1 ? "Its" : "Their"} original text was removed.
                </p>
                {orphaned.map((projection) => (
                  <button
                    className={styles["orphanedThread"]}
                    data-comment-bubble={projection.thread.id}
                    data-comment-surface="preview"
                    key={projection.thread.id}
                    type="button"
                  >
                    <span>
                      {projection.thread.messages[0]?.authorDisplayName ?? "Unknown author"}
                    </span>
                    {projection.thread.messages[0]?.body ?? "Open comment"}
                  </button>
                ))}
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
