import { useState } from "react";

import { Button, ControlAndLabel, Form, Input, Modal } from "@earendil-works/elanor-react";

import { Dialog } from "./dialog.tsx";
import styles from "./dialog.module.css";

export interface GuestIdentityDialogProps {
  readonly onCancel: () => void;
  readonly onIdentify: (displayName: string) => void;
  readonly open: boolean;
}

export function GuestIdentityDialog({
  onCancel,
  onIdentify,
  open,
}: GuestIdentityDialogProps): React.JSX.Element {
  const [displayName, setDisplayName] = useState("");

  return (
    <Dialog
      closeLabel="Return to reader"
      description="This name is shown to other document participants."
      onClose={onCancel}
      open={open}
      title="Join the discussion"
    >
      <Form
        className={styles["form"]}
        onSubmit={(event) => {
          event.preventDefault();
          const name = displayName.trim();
          if (name !== "") onIdentify(name);
        }}
      >
        <ControlAndLabel label="Display name">
          <Input
            autoComplete="name"
            autoFocus
            maxLength={120}
            onValueChange={setDisplayName}
            required
            value={displayName}
          />
        </ControlAndLabel>
        <Modal.Actions>
          <Button type="submit">Join document</Button>
        </Modal.Actions>
      </Form>
    </Dialog>
  );
}
