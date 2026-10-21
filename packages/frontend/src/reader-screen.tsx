import { useEffect } from "react";

import { Container, Layout } from "@earendil-works/elanor-react";
import type { DocumentResponse } from "@earendil-works/inkling-protocol";

import { useAppContext } from "./app-context.tsx";
import { ReaderDocument } from "./components/reader-document.tsx";
import styles from "./components/reader.module.css";
import { ReaderToolbar } from "./components/reader-toolbar.tsx";

export interface ReaderScreenProps {
  readonly document: DocumentResponse;
  readonly publicDocument?: boolean | undefined;
  readonly shared: boolean;
}

export function ReaderScreen({
  document,
  publicDocument = false,
  shared,
}: ReaderScreenProps): React.JSX.Element {
  const { setParticipants } = useAppContext();
  useEffect(() => {
    setParticipants([]);
  }, [setParticipants]);

  return (
    <Layout.Main className={styles["layout"]} id="app" tabIndex={-1}>
      <Container>
        <ReaderToolbar
          metadata={document.metadata}
          publicDocument={publicDocument}
          shared={shared}
        />
        <ReaderDocument document={document} />
      </Container>
    </Layout.Main>
  );
}
