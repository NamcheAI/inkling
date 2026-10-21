import type { ReactNode } from "react";

import { Heading, KeyValue } from "@earendil-works/elanor-react";
import type { DocumentMetadataDto } from "@earendil-works/inkling-protocol";
import type { RenderHeading } from "@earendil-works/inkling-renderer";

import { formatDate } from "../ui.ts";
import chipStyles from "./chip.module.css";
import { DocumentTableOfContents, useMediaQuery } from "./document-table-of-contents.tsx";
import { LifecycleStateChip, VisibilityChip } from "./chip.tsx";
import styles from "./reader.module.css";

export interface DocumentPageProps {
  readonly children: ReactNode;
  readonly headings: readonly RenderHeading[];
  readonly metadata: DocumentMetadataDto;
  readonly presentation?: "preview" | "reader" | undefined;
}

export function DocumentPage({
  children,
  headings,
  metadata,
  presentation = "reader",
}: DocumentPageProps): React.JSX.Element {
  const wide = useMediaQuery("(width > 68rem)");
  const folio =
    metadata.rfcNumber === undefined
      ? "Note"
      : `RFC ${String(metadata.rfcNumber).padStart(4, "0")}`;
  const tableOfContents = (
    <DocumentTableOfContents
      headings={headings}
      presentation={presentation === "reader" && wide ? "list" : "menu"}
    />
  );

  return (
    <div
      className={`${styles["page"]}${presentation === "preview" ? ` ${styles["preview"]}` : ""}`}
      data-document-page=""
    >
      <header className={styles["heading"]}>
        <p className={styles["folio"]}>{folio}</p>
        <div className={styles["headingMain"]}>
          <div className={styles["badges"]}>
            <LifecycleStateChip
              href={`/?q=${encodeURIComponent(`state:${metadata.lifecycleState}`)}`}
              state={metadata.lifecycleState}
            />
            <VisibilityChip
              href={`/?q=${encodeURIComponent(`visibility:${metadata.visibility}`)}`}
              visibility={metadata.visibility}
            />
          </div>
          <Heading className={styles["title"]} level={1} size={presentation === "preview" ? 2 : 1}>
            {metadata.title}
          </Heading>
          {metadata.labels.length === 0 ? null : (
            <div aria-label="Labels" className={styles["labels"]}>
              {metadata.labels.map((label) => (
                <a
                  className={chipStyles["chip"]}
                  href={`/labels?label=${encodeURIComponent(label)}`}
                  key={label}
                >
                  {label}
                </a>
              ))}
            </div>
          )}
        </div>
      </header>
      <DocumentMetadata metadata={metadata} />
      {presentation === "reader" && wide ? null : tableOfContents}
      <div className={styles["contentGrid"]}>
        {children}
        {presentation === "reader" && wide ? tableOfContents : null}
      </div>
    </div>
  );
}

function DocumentMetadata({
  metadata,
}: {
  readonly metadata: DocumentMetadataDto;
}): React.JSX.Element {
  return (
    <KeyValue.Grid className={styles["metadata"]} data-document-metadata="">
      <KeyValue.Key>Authors</KeyValue.Key>
      <KeyValue.Value>
        {metadata.authors.length === 0 ? (
          <span className={styles["metadataEmpty"]}>Not specified</span>
        ) : (
          <PeopleList people={metadata.authors} />
        )}
      </KeyValue.Value>
      <KeyValue.Key>Created</KeyValue.Key>
      <KeyValue.Value>
        <time dateTime={metadata.createdAt}>{formatDate(metadata.createdAt)}</time>
      </KeyValue.Value>
      <KeyValue.Key>Updated</KeyValue.Key>
      <KeyValue.Value>
        <time dateTime={metadata.updatedAt}>{formatDate(metadata.updatedAt)}</time>
      </KeyValue.Value>
      {metadata.reviewers.length === 0 ? null : (
        <>
          <KeyValue.Key>Reviewers</KeyValue.Key>
          <KeyValue.Value>
            <PeopleList people={metadata.reviewers} />
          </KeyValue.Value>
        </>
      )}
      {metadata.approvers.length === 0 ? null : (
        <>
          <KeyValue.Key>Approvers</KeyValue.Key>
          <KeyValue.Value>
            <PeopleList people={metadata.approvers} />
          </KeyValue.Value>
        </>
      )}
      {metadata.targetDecisionDate === undefined ? null : (
        <>
          <KeyValue.Key>Target decision</KeyValue.Key>
          <KeyValue.Value>
            <time dateTime={metadata.targetDecisionDate}>
              {formatDate(metadata.targetDecisionDate)}
            </time>
          </KeyValue.Value>
        </>
      )}
    </KeyValue.Grid>
  );
}

function PeopleList({
  people,
}: {
  readonly people: DocumentMetadataDto["authors"];
}): React.JSX.Element {
  return (
    <>
      {people.map((person, index) => (
        <span key={person.id}>
          {index === 0 ? null : ", "}
          <a href={`mailto:${person.email}`} title={person.email}>
            {person.displayName}
          </a>
        </span>
      ))}
    </>
  );
}
