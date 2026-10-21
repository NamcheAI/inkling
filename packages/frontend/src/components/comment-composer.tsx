import { useEffect, useId, useRef, useState } from "react";

import { CloseIcon } from "@earendil-works/elanor-icons-react";
import {
  Button,
  Field,
  Form,
  Heading,
  IconButton,
  KeyboardKey,
  KeyboardShortcut,
  Stack,
  TextArea,
} from "@earendil-works/elanor-react";

import styles from "./comments.module.css";
import { Dialog } from "./dialog.tsx";

export interface CommentComposerProps {
  readonly initialBody?: string | undefined;
  readonly onCancel: () => void;
  readonly onSubmit: (body: string) => void;
  readonly pending: boolean;
  readonly presentation?: "dialog" | "inline" | undefined;
  readonly quote?: string | undefined;
  readonly submitLabel: string;
  readonly title: string;
}

export function CommentComposer({
  initialBody = "",
  onCancel,
  onSubmit,
  pending,
  presentation = "dialog",
  quote,
  submitLabel,
  title,
}: CommentComposerProps): React.JSX.Element {
  const titleId = useId();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState(initialBody);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    const textarea = bodyRef.current;
    textarea?.focus();
    textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  const submit = (): void => {
    const value = body.trim();
    if (value === "") {
      setInvalid(true);
      bodyRef.current?.focus();
      return;
    }
    setInvalid(false);
    onSubmit(value);
  };

  const fields = (
    <>
      {quote === undefined || quote.length === 0 ? null : (
        <blockquote className={styles["quote"]} data-comment-composer-quote="">
          {quote}
        </blockquote>
      )}
      <Field.Root invalid={invalid}>
        <Field.Label>Comment</Field.Label>
        <TextArea
          className={styles["composerBody"]}
          data-comment-body=""
          maxLength={20_000}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit();
            }
          }}
          onValueChange={(value) => {
            setBody(value);
            if (invalid) setInvalid(false);
          }}
          placeholder="Write a clear, useful comment…"
          ref={bodyRef}
          rows={presentation === "inline" ? 3 : 7}
          value={body}
        />
        {invalid ? <Field.Error match>Enter a comment before submitting.</Field.Error> : null}
      </Field.Root>
      <div className={styles["composerFooter"]}>
        <span className={styles["shortcut"]}>
          <KeyboardShortcut>
            <KeyboardKey>⌘</KeyboardKey>+<KeyboardKey>Enter</KeyboardKey>
          </KeyboardShortcut>{" "}
          to submit
        </span>
        <Stack direction="row" gap="xSmall">
          <Button
            data-comment-cancel=""
            disabled={pending}
            hierarchy="secondary"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button data-comment-submit="" pending={pending} type="submit">
            {submitLabel}
          </Button>
        </Stack>
      </div>
    </>
  );
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    submit();
  };

  if (presentation === "dialog") {
    return (
      <Dialog
        attributes={{ "data-comment-composer-dialog": "" }}
        closeLabel="Cancel comment"
        onClose={onCancel}
        open
        pending={pending}
        title={<span data-comment-composer-title="">{title}</span>}
      >
        <Form
          className={styles["composerForm"]}
          data-comment-composer-form=""
          onSubmit={handleSubmit}
        >
          {fields}
        </Form>
      </Dialog>
    );
  }

  return (
    <Form
      aria-labelledby={titleId}
      className={styles["inlineComposer"]}
      data-comment-composer-form=""
      data-comment-composer-inline=""
      onSubmit={handleSubmit}
    >
      <Stack align="start" direction="row" gap="auto">
        <Heading id={titleId} level={3}>
          {title}
        </Heading>
        <IconButton aria-label="Cancel comment" disabled={pending} onClick={onCancel}>
          <CloseIcon />
        </IconButton>
      </Stack>
      {fields}
    </Form>
  );
}
