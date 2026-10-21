import { useState } from "react";

import { LockIcon } from "@earendil-works/elanor-icons-react";
import {
  Button,
  ControlAndLabel,
  Form,
  Heading,
  Input,
  Layout,
  Stack,
  Text,
} from "@earendil-works/elanor-react";

import type { ApiClientService, ApiError } from "../api.ts";
import { useEffectAction } from "../effect-hooks.ts";
import { FormError } from "./form-error.tsx";
import styles from "./share-password-screen.module.css";

export function SharePasswordScreen({
  api,
  documentId,
  onUnlocked,
}: {
  readonly api: ApiClientService;
  readonly documentId: string;
  readonly onUnlocked: () => void;
}): React.JSX.Element {
  const [password, setPassword] = useState("");
  const unlock = useEffectAction<string, { readonly unlocked: true }, ApiError>((value) =>
    api.unlockShareLink(documentId, value),
  );

  return (
    <Layout.Main className={styles["layout"]} data-share-password-screen="" id="app" tabIndex={-1}>
      <Form
        className={styles["form"]}
        onSubmit={(event) => {
          event.preventDefault();
          if (password === "") return;
          unlock.execute(password, { onSuccess: onUnlocked });
        }}
      >
        <Stack gap="small">
          <LockIcon aria-hidden="true" className={styles["icon"]} />
          <Heading level={1} size={3}>
            Password required
          </Heading>
          <Text className={styles["description"]}>
            Enter the password supplied by the person who shared this document.
          </Text>
        </Stack>
        <ControlAndLabel label="Password">
          <Input
            autoComplete="current-password"
            autoFocus
            onValueChange={setPassword}
            required
            type="password"
            value={password}
          />
        </ControlAndLabel>
        <FormError>{unlock.state.error?.message}</FormError>
        <div>
          <Button pending={unlock.state.pending} type="submit">
            Open document
          </Button>
        </div>
      </Form>
    </Layout.Main>
  );
}
