import { useEffect } from "react";

import { CloseIcon } from "@earendil-works/elanor-icons-react";
import { Button, IconButton, Stack } from "@earendil-works/elanor-react";
import type { CommentThreadDto } from "@earendil-works/inkling-protocol";

import { AnchoredPopover } from "./anchored-popover.tsx";
import { CommentComposer } from "./comment-composer.tsx";
import styles from "./comments.module.css";

export interface CommentThreadCardProps {
  readonly anchorRef: React.RefObject<HTMLElement | undefined>;
  readonly anchorRevision: number;
  readonly canManage: boolean;
  readonly canReply: boolean;
  readonly onClose: () => void;
  readonly onDeleteMessage: (messageId: string) => void;
  readonly onDeleteThread: () => void;
  readonly onEdit: (messageId: string, body: string) => void;
  readonly onReply: () => void;
  readonly onResolve: () => void;
  readonly replyComposer:
    | {
        readonly onCancel: () => void;
        readonly onSubmit: (body: string) => void;
        readonly pending: boolean;
      }
    | undefined;
  readonly thread: CommentThreadDto | undefined;
}

export function CommentThreadCard({
  anchorRef,
  anchorRevision,
  canManage,
  canReply,
  onClose,
  onDeleteMessage,
  onDeleteThread,
  onEdit,
  onReply,
  onResolve,
  replyComposer,
  thread,
}: CommentThreadCardProps): React.JSX.Element {
  useEffect(() => {
    document.querySelectorAll<HTMLElement>("[data-comment-bubble]").forEach((bubble) => {
      bubble.classList.toggle(
        styles["activeBubble"] ?? "",
        thread !== undefined && bubble.dataset["commentBubble"] === thread.id,
      );
    });
    return () => {
      document
        .querySelectorAll("[data-comment-bubble]")
        .forEach((bubble) => bubble.classList.remove(styles["activeBubble"] ?? ""));
    };
  }, [thread]);

  return (
    <AnchoredPopover
      anchorRef={anchorRef}
      anchorRevision={anchorRevision}
      aria-label="Comment thread"
      className={styles["card"]}
      data-comment-card=""
      onClose={onClose}
      open={thread !== undefined}
    >
      {thread === undefined ? null : (
        <section
          className={`${styles["thread"]}${thread.resolved ? ` ${styles["resolved"]}` : ""}`}
        >
          <Stack align="center" direction="row" gap="auto">
            <span className={styles["threadLabel"]}>
              {thread.resolved ? "Resolved thread" : "Thread"}
            </span>
            <IconButton aria-label="Close comment thread" data-comment-close="" onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </Stack>
          <blockquote className={styles["quote"]}>
            {thread.anchor.quote || "Orphaned selection"}
          </blockquote>
          {thread.messages.map((message) => (
            <div className={styles["message"]} key={message.id}>
              <b>{message.authorDisplayName}</b>
              <p>{message.body}</p>
              <Stack direction="row" gap="xSmall">
                <Button
                  data-edit-message={`${thread.id}:${message.id}`}
                  density="compact"
                  hierarchy="tertiary"
                  onClick={() => onEdit(message.id, message.body)}
                >
                  Edit
                </Button>
                <Button
                  data-delete-message={`${thread.id}:${message.id}`}
                  density="compact"
                  hierarchy="tertiary"
                  onClick={() => onDeleteMessage(message.id)}
                  semantic="negative"
                >
                  Delete
                </Button>
              </Stack>
            </div>
          ))}
          {replyComposer === undefined ? null : (
            <CommentComposer
              onCancel={replyComposer.onCancel}
              onSubmit={replyComposer.onSubmit}
              pending={replyComposer.pending}
              presentation="inline"
              submitLabel="Reply"
              title="Reply to thread"
            />
          )}
          <Stack className={styles["threadActions"]} direction="row" gap="xSmall" wrap="wrap">
            {canReply && replyComposer === undefined ? (
              <Button data-reply-thread={thread.id} hierarchy="secondary" onClick={onReply}>
                Reply
              </Button>
            ) : null}
            <Button data-resolve-thread={thread.id} hierarchy="secondary" onClick={onResolve}>
              {thread.resolved ? "Reopen" : "Resolve"}
            </Button>
            {canManage ? (
              <Button
                data-delete-thread={thread.id}
                hierarchy="tertiary"
                onClick={onDeleteThread}
                semantic="negative"
              >
                Delete thread
              </Button>
            ) : null}
          </Stack>
        </section>
      )}
    </AnchoredPopover>
  );
}
