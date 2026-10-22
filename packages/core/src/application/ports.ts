import { Context, Data, type Effect } from "effect";

import type { DocumentId, DocumentRevision } from "../domain/document.ts";
import type { SearchVariant } from "../domain/search.ts";
import type { IdentifierTag } from "./identifiers.ts";

export class StorageError extends Data.TaggedError("StorageError")<{
  readonly operation: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

export interface StoredObject {
  readonly bytes: Uint8Array;
  readonly digest: string;
  readonly mediaType?: string | undefined;
}

export interface PutObjectOptions {
  readonly digest: string;
  readonly mediaType?: string | undefined;
}

/** Portable storage for checkpoints, projections, artifacts, and attachments. */
export interface ObjectStoreService {
  readonly get: (key: string) => Effect.Effect<StoredObject | undefined, StorageError>;
  readonly put: (
    key: string,
    bytes: Uint8Array,
    options: PutObjectOptions,
  ) => Effect.Effect<void, StorageError>;
  readonly delete: (key: string) => Effect.Effect<void, StorageError>;
  readonly list: (prefix: string) => Effect.Effect<readonly string[], StorageError>;
}

export const ObjectStore = Context.GenericTag<ObjectStoreService>(
  "@earendil-works/inkling/ObjectStore",
);

export type JournalEntryKind =
  | "body-update"
  | "metadata-event"
  | "comment-event"
  | "sharing-event"
  | "publication-event";

export interface JournalActor {
  readonly displayName?: string | undefined;
  readonly id?: string | undefined;
  readonly kind: "anonymous" | "api-key" | "capability" | "workspace";
}

export type JournalEntrySource = "collaboration" | "command";

export interface JournalEntryInput {
  readonly actor?: JournalActor | undefined;
  readonly documentId: DocumentId;
  readonly revision: DocumentRevision;
  readonly kind: JournalEntryKind;
  readonly occurredAt?: string | undefined;
  readonly payload: Uint8Array;
  readonly previousSequence: number;
  readonly source?: JournalEntrySource | undefined;
  readonly idempotencyKey?: string | undefined;
}

export interface JournalEntry extends JournalEntryInput {
  readonly sequence: number;
}

/** Append resolves only after the record is durable. */
export interface DurableDocumentJournalService {
  readonly append: (entry: JournalEntryInput) => Effect.Effect<JournalEntry, StorageError>;
  readonly entriesAfter: (
    documentId: DocumentId,
    sequence: number,
  ) => Effect.Effect<readonly JournalEntry[], StorageError>;
  readonly delete: (documentId: DocumentId) => Effect.Effect<void, StorageError>;
  readonly truncateThrough: (
    documentId: DocumentId,
    sequence: number,
  ) => Effect.Effect<void, StorageError>;
}

export const DurableDocumentJournal = Context.GenericTag<DurableDocumentJournalService>(
  "@earendil-works/inkling/DurableDocumentJournal",
);

export interface WorkspaceStateStoreService {
  readonly load: <A>() => Effect.Effect<A | undefined, StorageError>;
  readonly save: <A>(state: A) => Effect.Effect<void, StorageError>;
}

export const WorkspaceStateStore = Context.GenericTag<WorkspaceStateStoreService>(
  "@earendil-works/inkling/WorkspaceStateStore",
);

export interface IdGeneratorService {
  readonly generate: (purpose: IdentifierTag) => Effect.Effect<string>;
}

export const IdGenerator = Context.GenericTag<IdGeneratorService>(
  "@earendil-works/inkling/IdGenerator",
);

export interface DigestService {
  readonly sha256: (bytes: Uint8Array) => Effect.Effect<string, StorageError>;
}

export const Digest = Context.GenericTag<DigestService>("@earendil-works/inkling/Digest");

export interface SecretHasherService {
  readonly hash: (secret: string) => Effect.Effect<string, StorageError>;
  readonly verify: (secret: string, encodedHash: string) => Effect.Effect<boolean, StorageError>;
}

export const SecretHasher = Context.GenericTag<SecretHasherService>(
  "@earendil-works/inkling/SecretHasher",
);

export interface SecureTokenService {
  readonly generate: (byteLength: number) => Effect.Effect<string, StorageError>;
}

export const SecureToken = Context.GenericTag<SecureTokenService>(
  "@earendil-works/inkling/SecureToken",
);

export type SqlValue = string | number | null | Uint8Array;

export type SqlRow = Readonly<Record<string, SqlValue>>;

export interface SqlStatement {
  readonly sql: string;
  readonly params?: readonly SqlValue[] | undefined;
}

/** A local SQLite database with FTS5 and JSON1, owned by one search index. */
export interface SearchDatabaseService {
  readonly query: (
    sql: string,
    params?: readonly SqlValue[],
  ) => Effect.Effect<readonly SqlRow[], StorageError>;
  /** Runs every statement in one transaction. */
  readonly batch: (statements: readonly SqlStatement[]) => Effect.Effect<void, StorageError>;
}

export type EmbeddingPurpose = "document" | "query";

/** Turns text into vectors. Vectors from different models are never compared. */
export interface EmbedderService {
  /** Stable identifier of the model and its configuration. */
  readonly model: string;
  readonly maxBatchSize: number;
  readonly embed: (
    texts: readonly string[],
    purpose: EmbeddingPurpose,
  ) => Effect.Effect<readonly Float32Array[], StorageError>;
}

export interface VectorRecord {
  readonly id: string;
  readonly values: Float32Array;
}

export interface VectorMatch {
  readonly id: string;
  readonly score: number;
}

/** Nearest-neighbour storage keyed by opaque vector identifiers. */
export interface VectorStoreService {
  readonly upsert: (vectors: readonly VectorRecord[]) => Effect.Effect<void, StorageError>;
  readonly delete: (ids: readonly string[]) => Effect.Effect<void, StorageError>;
  readonly query: (
    vector: Float32Array,
    topK: number,
  ) => Effect.Effect<readonly VectorMatch[], StorageError>;
}

export interface SearchDocumentInput {
  readonly documentId: DocumentId;
  readonly variant: SearchVariant;
  readonly revision: DocumentRevision;
  readonly title: string;
  readonly body: string;
}

/** Normalized phrases; `all` requires every phrase in a document, `any` ranks by relevance. */
export interface KeywordQuery {
  readonly phrases: readonly string[];
  readonly match: "all" | "any";
}

export interface PassageSearchRequest {
  readonly variant: SearchVariant;
  readonly keyword?: KeywordQuery | undefined;
  readonly semantic?: string | undefined;
  /** Restricts results to these documents; omitted means every indexed document. */
  readonly documentIds?: readonly DocumentId[] | undefined;
  readonly limit: number;
  readonly perDocumentLimit: number;
}

export type PassageMatchKind = "keyword" | "semantic";

export interface SearchPassage {
  readonly documentId: DocumentId;
  readonly variant: SearchVariant;
  readonly revision: DocumentRevision;
  readonly title: string;
  readonly headingPath: readonly string[];
  readonly startLine: number;
  readonly endLine: number;
  readonly snippet: string;
  readonly score: number;
  readonly matchedBy: readonly PassageMatchKind[];
}

export interface SearchRefreshResult {
  readonly embedded: number;
  readonly pending: number;
}

/**
 * Rebuildable full-text and semantic projection of document bodies. Results
 * are candidates only: callers authorize every document before surfacing it.
 */
export interface SearchIndexService {
  /** False for authorities that never answer queries; callers may skip preparing input. */
  readonly enabled: boolean;
  readonly semantic: boolean;
  /** Replaces a document variant unless a newer revision is already indexed. */
  readonly indexDocument: (input: SearchDocumentInput) => Effect.Effect<void, StorageError>;
  readonly removeDocument: (
    documentId: DocumentId,
    variant?: SearchVariant,
  ) => Effect.Effect<void, StorageError>;
  readonly indexedRevision: (
    documentId: DocumentId,
    variant: SearchVariant,
  ) => Effect.Effect<DocumentRevision | undefined, StorageError>;
  /** Documents whose headings or body match the query. */
  readonly matchDocuments: (
    query: KeywordQuery,
    variant: SearchVariant,
  ) => Effect.Effect<ReadonlySet<DocumentId>, StorageError>;
  /** Best matching body excerpt for each listed document. */
  readonly excerpts: (
    query: KeywordQuery,
    variant: SearchVariant,
    documentIds: readonly DocumentId[],
  ) => Effect.Effect<ReadonlyMap<DocumentId, string>, StorageError>;
  readonly searchPassages: (
    request: PassageSearchRequest,
  ) => Effect.Effect<readonly SearchPassage[], StorageError>;
  /** Embeds passages that have been stable since `quietBefore` and drops unused vectors. */
  readonly refresh: (quietBefore: number) => Effect.Effect<SearchRefreshResult, StorageError>;
  readonly clear: Effect.Effect<void, StorageError>;
}

export const SearchIndex = Context.GenericTag<SearchIndexService>(
  "@earendil-works/inkling/SearchIndex",
);
