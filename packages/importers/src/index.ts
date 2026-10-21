import { Data, Effect, Predicate, Schema } from "effect";
import YAML from "yaml";

import { identifierTag, personId, validatePerson } from "@earendil-works/inkling-core";
import { makeMarkdownRenderer } from "@earendil-works/inkling-renderer";
import type {
  CapabilityAccess,
  CreateMetadataInput,
  PersonReference,
  Visibility,
} from "@earendil-works/inkling-core";

export interface ImportedAttachment {
  readonly sourcePath: string;
  readonly markdownPath: string;
  readonly mediaType?: string | undefined;
}

export interface ImportedCommentMessage {
  readonly legacyId?: string | undefined;
  readonly parentLegacyId?: string | undefined;
  readonly author: string;
  readonly body: string;
  readonly createdAt?: string | undefined;
  readonly updatedAt?: string | undefined;
}

export interface ImportedCommentThread {
  readonly legacyId?: string | undefined;
  readonly quote: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly originalStart?: number | undefined;
  readonly originalEnd?: number | undefined;
  readonly resolved: boolean;
  readonly messages: readonly ImportedCommentMessage[];
}

export interface ImportedMetadataInput extends Omit<CreateMetadataInput, "id"> {
  readonly id?: string | undefined;
  readonly updatedAt?: string | undefined;
}

export interface ImportedDocument {
  readonly metadata: ImportedMetadataInput;
  readonly body: string;
  readonly people: readonly PeopleDirectoryRecord[];
  readonly attachments: readonly ImportedAttachment[];
  readonly comments: readonly ImportedCommentThread[];
  readonly capabilityId?: string | undefined;
  readonly capabilityAccess?: CapabilityAccess | undefined;
  readonly relatedRfcNumbers: readonly number[];
  readonly warnings: readonly string[];
}

export interface PeopleDirectoryRecord {
  readonly displayName: string;
  readonly email: string;
  readonly aliases?: readonly string[] | undefined;
}

export interface ImportContext {
  readonly sourcePath: string;
  readonly people?: readonly PeopleDirectoryRecord[] | undefined;
  readonly attachments?: readonly ImportedAttachment[] | undefined;
  readonly now?: string | undefined;
}

export class ImportError extends Data.TaggedError("ImportError")<{
  readonly code: "invalid_frontmatter" | "invalid_metadata" | "invalid_sidecar";
  readonly message: string;
  readonly sourcePath: string;
  readonly cause?: unknown;
}> {}

const jotSidecarSchema = Schema.Struct({
  comments: Schema.optional(Schema.Array(Schema.Unknown)),
  createdAt: Schema.optional(Schema.String),
  id: Schema.String,
  shareAccess: Schema.optional(Schema.Literal("disabled", "view", "comment", "edit")),
  shareId: Schema.optional(Schema.String),
  title: Schema.String,
  updatedAt: Schema.optional(Schema.String),
});

export function importEarendilRfc(
  markdown: string,
  context: ImportContext,
): Effect.Effect<ImportedDocument, ImportError> {
  return Effect.gen(function* () {
    const parsed = yield* parseFrontmatter(markdown, context.sourcePath);
    const frontmatter = parsed.frontmatter;
    const sourceBody = parsed.body.replace(/\r\n?/gu, "\n").trimStart();
    const warnings: string[] = [];
    const number = parsePositiveInteger(
      firstValue(frontmatter, ["rfc", "rfc_number", "number"]) ??
        numberFromPath(context.sourcePath),
    );
    if (number === undefined) {
      warnings.push("RFC number was not found and must be allocated during import.");
    }
    const headingTitle = firstHeading(sourceBody);
    const title =
      normalizedRfcTitle(headingTitle, number) ?? firstString(frontmatter, ["title", "name"]);
    if (title === undefined) {
      return yield* importFailure(
        "invalid_metadata",
        "The RFC has neither a title field nor a top-level heading.",
        context.sourcePath,
      );
    }
    const people = context.people ?? [];
    const authors = yield* normalizePeople(firstValue(frontmatter, ["authors", "author"]), people);
    const reviewers = yield* normalizePeople(
      firstValue(frontmatter, ["reviewers", "reviewer"]),
      people,
    );
    const approvers = yield* normalizePeople(
      firstValue(frontmatter, ["approvers", "approver"]),
      people,
    );
    const rawVisibility = firstString(frontmatter, ["visibility", "access"]);
    const normalizedVisibility = rawVisibility?.toLocaleLowerCase("en");
    const visibility: Visibility =
      parseConfidential(frontmatter) || normalizedVisibility === "confidential"
        ? "confidential"
        : normalizedVisibility === "public"
          ? "public"
          : "private";
    if (
      rawVisibility !== undefined &&
      !["public", "workspace", "internal", "private", "confidential"].includes(
        normalizedVisibility ?? "",
      )
    ) {
      warnings.push(`Unknown visibility ${rawVisibility} was imported as private.`);
    }
    const createdAt = normalizeDate(firstString(frontmatter, ["created", "created_at", "date"]));
    let updatedAt = normalizeDate(
      firstString(frontmatter, ["updated", "updated_at", "last_modified"]),
    );
    if (createdAt !== undefined && updatedAt !== undefined && updatedAt < createdAt) {
      warnings.push("The update date precedes the creation date and was raised to match it.");
      updatedAt = createdAt;
    }
    const lifecycleState = firstString(frontmatter, ["state", "status"]) ?? "draft";
    // Legacy keyword pages grouped keywords case-insensitively.
    const labels = [
      ...new Set(
        stringList(firstValue(frontmatter, ["labels", "keywords", "tags"])).map((label) =>
          label.toLocaleLowerCase("en"),
        ),
      ),
    ];
    const relatedRfcNumbers = stringList(
      firstValue(frontmatter, ["related", "related_rfcs", "related_documents"]),
    ).flatMap((value) => {
      const parsedNumber = parsePositiveInteger(value.replace(/^rfc\s*/iu, ""));
      return parsedNumber === undefined ? [] : [parsedNumber];
    });
    const legacySourceUrl = firstString(frontmatter, ["source", "source_url", "legacy_url"]);
    const targetDecisionDate = normalizeDate(
      firstString(frontmatter, ["target_decision_date", "decision_date"]),
    );
    const rewrittenBody = ensureTitleHeading(
      normalizeRfcTitleHeading(
        rewriteKnownPersonMailtoLabels(
          stripImageDimensionTitles(rewriteLegacyProtectedLinks(rewriteLegacyRfcLinks(sourceBody))),
          people,
        ),
        title,
        number,
      ),
      title,
    );
    const resolvedHeadings = yield* resolveExplicitHeadingIds(rewrittenBody);
    warnings.push(...resolvedHeadings.warnings);
    const body = resolvedHeadings.markdown;
    const metadata: ImportedMetadataInput = {
      approvers,
      authors,
      createdAt: createdAt ?? updatedAt ?? context.now,
      labels,
      legacySourceUrl,
      lifecycleState,
      reviewers,
      rfcNumber: number,
      targetDecisionDate,
      title,
      updatedAt: updatedAt ?? createdAt ?? context.now,
      visibility,
    };
    return {
      attachments: context.attachments ?? [],
      body,
      comments: [],
      metadata,
      people,
      relatedRfcNumbers,
      warnings,
    };
  });
}

export function importExistingJot(
  markdown: string,
  sidecar: unknown,
  context: ImportContext,
): Effect.Effect<ImportedDocument, ImportError> {
  return Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknown(jotSidecarSchema)(sidecar).pipe(
      Effect.mapError(
        (cause) =>
          new ImportError({
            cause,
            code: "invalid_sidecar",
            message: "The legacy Jot metadata sidecar is invalid.",
            sourcePath: context.sourcePath,
          }),
      ),
    );
    const comments = decodeLegacyComments(decoded.comments ?? [], context.sourcePath);
    const body = (yield* parseFrontmatter(markdown, context.sourcePath)).body;
    const title = firstHeading(body) ?? decoded.title;
    return {
      attachments: context.attachments ?? [],
      body: ensureTitleHeading(body, title),
      capabilityAccess: decoded.shareAccess,
      capabilityId: decoded.shareId,
      comments,
      metadata: {
        createdAt: normalizeDate(decoded.createdAt) ?? context.now,
        id: decoded.id,
        title,
        updatedAt: normalizeDate(decoded.updatedAt) ?? context.now,
      },
      people: context.people ?? [],
      relatedRfcNumbers: [],
      warnings: [],
    };
  });
}

export function rewriteLegacyProtectedLinks(markdown: string): string {
  return markdown.replace(
    /([?&])require_earendil_auth=1(?=(&|#[^\s)>]*|[\s)>]|$))/gu,
    "$1__require_auth=1",
  );
}

export function rewriteLegacyRfcLinks(markdown: string): string {
  return markdown.replace(
    /\((?:https?:\/\/rfcs\/|(?:\.\.\/|\.\/)?(?:rfcs?\/)?)(?:rfc[-_ ]?)?(\d+)(?:-[^)#]*)?\.md(#[^)]+)?\)/giu,
    (_match, rfcDigits: string, fragment: string | undefined) =>
      `(/rfc/${String(Number(rfcDigits)).padStart(4, "0")}${fragment ?? ""})`,
  );
}

/**
 * Rewrites links to known legacy source documents to canonical Inkling RFC routes.
 *
 * Link labels that Google Docs generated for the linked document (its URL or its
 * "0007 - Title" chip text) become "RFC 0007", matching the legacy RFC site.
 */
export function rewriteKnownRfcSourceLinks(
  markdown: string,
  rfcs: readonly {
    readonly legacySourceUrl?: string | undefined;
    readonly rfcNumber?: number | undefined;
  }[],
): string {
  const numbers = new Map<string, number>();
  for (const rfc of rfcs) {
    if (rfc.legacySourceUrl === undefined || rfc.rfcNumber === undefined) continue;
    const key = legacySourceKey(rfc.legacySourceUrl);
    if (key !== undefined) numbers.set(key, rfc.rfcNumber);
  }
  return markdown.replace(
    /(?<!!)\[((?:\\.|[^\\\]\n])*)\](\(\s*<?)(https?:\/\/[^\s)>]+)(>?[^)]*\))/giu,
    (match, label: string, prefix: string, target: string, suffix: string) => {
      const key = legacySourceKey(target);
      const number = numbers.get(key ?? "");
      if (key === undefined || number === undefined) return match;
      const route = `/rfc/${formatRfcNumber(number)}`;
      const rewrittenLabel = isDefaultRfcLinkLabel(label, target, key, number)
        ? `RFC ${formatRfcNumber(number)}`
        : label;
      return `[${rewrittenLabel}]${prefix}${route}${suffix}`;
    },
  );
}

/** Replaces Google Docs person-chip labels such as `[a@b.c](mailto:a@b.c)` with known names. */
export function rewriteKnownPersonMailtoLabels(
  markdown: string,
  directory: readonly PeopleDirectoryRecord[],
): string {
  return markdown.replace(
    /\[([^\]\n]+)\]\(\s*<?mailto:([^\s)>?]+)(\?[^\s)>]*)?(>?\s*\))/giu,
    (match, label: string, address: string, query: string | undefined, suffix: string) => {
      const email = safeDecodeUriComponent(address).trim().toLocaleLowerCase("en");
      if (label.replace(/\\(.)/gu, "$1").trim().toLocaleLowerCase("en") !== email) return match;
      const known = findDirectoryPerson(directory, [email]);
      if (known === undefined || known.displayName.trim() === "") return match;
      return `[${escapeMarkdownLabel(known.displayName)}](mailto:${address}${query ?? ""}${suffix}`;
    },
  );
}

/** Removes Google Docs `"=WIDTHxHEIGHT"` image size titles that would render as tooltips. */
export function stripImageDimensionTitles(markdown: string): string {
  return markdown
    .replace(
      /^( {0,3}\[[^\]\n]+\]:[ \t]*(?:<[^>\n]*>|\S+))[ \t]+(?:"=\d{1,6}x\d{1,6}"|'=\d{1,6}x\d{1,6}')[ \t]*$/gmu,
      "$1",
    )
    .replace(
      /(!\[[^\]\n]*\]\(\s*(?:<[^>\n]*>|[^\s)]+))[ \t]+(?:"=\d{1,6}x\d{1,6}"|'=\d{1,6}x\d{1,6}')(\s*\))/gu,
      "$1$2",
    );
}

/**
 * Removes Pandoc-style `{#id}` heading attributes emitted by Google Docs and points
 * in-document links at the anchors the Inkling renderer generates instead.
 */
export function resolveExplicitHeadingIds(
  markdown: string,
): Effect.Effect<{ readonly markdown: string; readonly warnings: readonly string[] }> {
  const stripped = stripExplicitHeadingIds(markdown);
  if (stripped.headings.length === 0) {
    return Effect.succeed({ markdown, warnings: [] });
  }
  return makeMarkdownRenderer()
    .render(stripped.markdown, { sourcePositions: true })
    .pipe(
      Effect.map(({ html }) => {
        const generated = new Map<number, string>();
        for (const match of html.matchAll(
          /<h[1-6] id="([^"]*)"[^>]*?\sdata-inkling-source-start="(\d+)"/gu,
        )) {
          if (match[1] !== undefined && match[2] !== undefined) {
            generated.set(Number(match[2]), match[1]);
          }
        }
        const anchors = new Map<string, string>();
        for (const heading of stripped.headings) {
          const id = generated.get(heading.offset);
          if (id !== undefined && id !== heading.id && !anchors.has(heading.id)) {
            anchors.set(heading.id, id);
          }
        }
        return {
          markdown:
            anchors.size === 0
              ? stripped.markdown
              : stripped.markdown.replace(
                  /(\]\(\s*<?#)([^\s)>]+)/gu,
                  (match, prefix: string, anchor: string) => {
                    const replacement = anchors.get(anchor);
                    return replacement === undefined ? match : `${prefix}${replacement}`;
                  },
                ),
          warnings: [],
        };
      }),
      Effect.orElseSucceed(() => ({
        markdown: stripped.markdown,
        warnings: [
          "Heading anchors could not be verified because the Markdown did not render; in-document links may need review.",
        ],
      })),
    );
}

function parseFrontmatter(
  markdown: string,
  sourcePath: string,
): Effect.Effect<
  { readonly body: string; readonly frontmatter: Readonly<Record<string, unknown>> },
  ImportError
> {
  if (!markdown.startsWith("---\n") && !markdown.startsWith("---\r\n")) {
    return Effect.succeed({ body: markdown, frontmatter: {} });
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(markdown);
  if (match?.[1] === undefined) {
    return importFailure(
      "invalid_frontmatter",
      "The Markdown frontmatter is not terminated.",
      sourcePath,
    );
  }
  const yamlSource = match[1];
  return Effect.try({
    catch: (cause) =>
      new ImportError({
        cause,
        code: "invalid_frontmatter",
        message: "The Markdown frontmatter is not valid YAML.",
        sourcePath,
      }),
    try: () => YAML.parse(yamlSource) as unknown,
  }).pipe(
    Effect.flatMap((value) =>
      Predicate.isReadonlyRecord(value)
        ? Effect.succeed({ body: markdown.slice(match[0].length), frontmatter: value })
        : importFailure(
            "invalid_frontmatter",
            "The Markdown frontmatter must be a YAML mapping.",
            sourcePath,
          ),
    ),
  );
}

function stripExplicitHeadingIds(markdown: string): {
  readonly markdown: string;
  readonly headings: readonly { readonly id: string; readonly offset: number }[];
} {
  const headings: { readonly id: string; readonly offset: number }[] = [];
  const output: string[] = [];
  let offset = 0;
  let fence: { readonly marker: string; readonly length: number } | undefined;
  for (const line of markdown.split("\n")) {
    let result = line;
    const boundary = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (boundary !== undefined) {
      if (fence === undefined) fence = { length: boundary.length, marker: boundary[0] ?? "" };
      else if (boundary[0] === fence.marker && boundary.length >= fence.length) fence = undefined;
    } else if (fence === undefined) {
      const heading = /^( {0,3}#{1,6}[ \t]+.*?)[ \t]+\{#([^\s}]+)(?:[ \t]+[^{}]*)?\}[ \t]*$/u.exec(
        line,
      );
      if (heading?.[1] !== undefined && heading[2] !== undefined) {
        result = heading[1].replace(/[ \t]+#+[ \t]*$/u, "");
        headings.push({ id: heading[2], offset });
      }
    }
    output.push(result);
    offset += result.length + 1;
  }
  return { headings, markdown: output.join("\n") };
}

function isDefaultRfcLinkLabel(
  rawLabel: string,
  target: string,
  targetKey: string,
  number: number,
): boolean {
  const label = rawLabel.replace(/\\(.)/gu, "$1").replace(/\s+/gu, " ").trim();
  if (label === "") return false;
  if (/^https?:\/\//iu.test(label)) {
    return (
      legacySourceKey(label) === targetKey ||
      label.replace(/\/$/u, "") === target.replace(/\/$/u, "")
    );
  }
  const referenced =
    /^rfc\s+0*(\d+)\b/iu.exec(label)?.[1] ?? /^0*(\d+)\s*[-:–—]\s*\S/u.exec(label)?.[1];
  return referenced !== undefined && Number(referenced) === number;
}

function findDirectoryPerson(
  directory: readonly PeopleDirectoryRecord[],
  identities: readonly string[],
): PeopleDirectoryRecord | undefined {
  const normalized = identities.map((value) => value.toLocaleLowerCase("en").trim());
  return directory.find((person) => {
    const aliases = new Set(
      [person.displayName, person.email, ...(person.aliases ?? [])].map((value) =>
        value.toLocaleLowerCase("en").trim(),
      ),
    );
    return normalized.some((identity) => aliases.has(identity));
  });
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/([\\[\]])/gu, "\\$1");
}

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function formatRfcNumber(number: number): string {
  return String(number).padStart(4, "0");
}

function normalizePeople(
  input: unknown,
  directory: readonly PeopleDirectoryRecord[],
): Effect.Effect<readonly PersonReference[], ImportError> {
  return Effect.forEach(stringList(input), (raw) =>
    Effect.gen(function* () {
      const parsed = parseImportedPerson(raw);
      const known = findDirectoryPerson(
        directory,
        [parsed.displayName, parsed.email].filter((value): value is string => value !== undefined),
      );
      const email = (
        known?.email ??
        parsed.email ??
        `${slug(parsed.displayName ?? raw)}@import.invalid`
      ).toLocaleLowerCase("en");
      const reference: PersonReference = {
        displayName: known?.displayName ?? parsed.displayName ?? email,
        email,
        id: yield* personId(email),
      };
      yield* validatePerson(reference);
      return reference;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ImportError({
            cause,
            code: "invalid_metadata",
            message: `Imported person ${raw} has no stable identity.`,
            sourcePath: "people-directory",
          }),
      ),
    ),
  );
}

function decodeLegacyComments(
  values: readonly unknown[],
  sourcePath: string,
): readonly ImportedCommentThread[] {
  return values.flatMap((value) => {
    if (!Predicate.isReadonlyRecord(value) || typeof value["quote"] !== "string") {
      return [];
    }
    const messages = Array.isArray(value["messages"])
      ? value["messages"].flatMap((message): ImportedCommentMessage[] => {
          if (!Predicate.isReadonlyRecord(message) || typeof message["body"] !== "string")
            return [];
          return [
            {
              author: typeof message["author"] === "string" ? message["author"] : "Imported user",
              body: message["body"],
              createdAt: stringValue(message["createdAt"]),
              legacyId: stringValue(message["id"]),
              parentLegacyId: stringValue(message["parentId"]),
              updatedAt: stringValue(message["updatedAt"]),
            },
          ];
        })
      : [];
    if (messages.length === 0) {
      void sourcePath;
    }
    return [
      {
        legacyId: stringValue(value["id"]),
        messages,
        originalEnd: numberValue(value["end"]),
        originalStart: numberValue(value["start"]),
        prefix: stringValue(value["prefix"]) ?? "",
        quote: value["quote"],
        resolved: value["resolved"] === true,
        suffix: stringValue(value["suffix"]) ?? "",
      },
    ];
  });
}

function firstHeading(markdown: string): string | undefined {
  return /^#\s+(.+)$/mu
    .exec(markdown)?.[1]
    ?.replace(/[ \t]+\{#[^\s}]+(?:[ \t]+[^{}]*)?\}[ \t]*$/u, "")
    .trim();
}

function normalizedRfcTitle(
  title: string | undefined,
  number: number | undefined,
): string | undefined {
  if (title === undefined || number === undefined) return title;
  const match = /^RFC\s+0*(\d+)\s*(?:[-:—]\s*)?(.+)$/iu.exec(title);
  return match?.[1] !== undefined && Number(match[1]) === number ? match[2]?.trim() : title;
}

function normalizeRfcTitleHeading(
  markdown: string,
  title: string,
  number: number | undefined,
): string {
  const heading = firstHeading(markdown);
  if (heading === undefined || normalizedRfcTitle(heading, number) === heading) return markdown;
  return markdown.replace(/^#\s+.+$/mu, `# ${title}`);
}

function ensureTitleHeading(markdown: string, title: string): string {
  if (firstHeading(markdown) !== undefined) return markdown;
  const body = markdown.trimStart();
  return body === "" ? `# ${title}\n` : `# ${title}\n\n${body}`;
}

function numberFromPath(sourcePath: string): number | undefined {
  return parsePositiveInteger(/(?:^|\D)(\d{1,8})(?:\D|$)/u.exec(sourcePath)?.[1]);
}

function firstString(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | undefined {
  return stringValue(firstValue(record, keys));
}

function firstValue(record: Readonly<Record<string, unknown>>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function stringList(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.flatMap((item) => stringList(item));
  if (typeof value !== "string" && typeof value !== "number") return [];
  return String(value)
    .split(/[,;]\s*/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parsePositiveInteger(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(stringValue(value));
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function normalizeDate(value: string | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function parseImportedPerson(value: string): {
  readonly displayName?: string | undefined;
  readonly email?: string | undefined;
} {
  const normalized = value.replace(/\s+/gu, " ").trim();
  const bracketed = /^(.*?)\s*<([^>]+)>$/u.exec(normalized);
  if (bracketed !== null) {
    const displayName = bracketed[1]?.trim();
    const email = bracketed[2]?.trim();
    // Google Docs exports unnamed people as `email <email>`.
    const placeholder =
      displayName !== undefined &&
      email !== undefined &&
      displayName.toLocaleLowerCase("en") === email.toLocaleLowerCase("en");
    return {
      displayName: displayName === "" || placeholder ? undefined : displayName,
      email: email === "" ? undefined : email,
    };
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)
    ? { email: normalized }
    : { displayName: normalized };
}

function legacySourceKey(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.hostname.toLocaleLowerCase("en") === "docs.google.com") {
      const documentId = /^\/document\/(?:u\/\d+\/)?d\/([^/]+)/u.exec(url.pathname)?.[1];
      if (documentId !== undefined) return `${identifierTag.googleDocument}:${documentId}`;
    }
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/u, "")}`;
  } catch {
    return undefined;
  }
}

function parseConfidential(frontmatter: Readonly<Record<string, unknown>>): boolean {
  const value = firstValue(frontmatter, ["confidential", "sensitivity"]);
  return (
    value === true ||
    (typeof value === "string" && value.toLocaleLowerCase("en") === "confidential")
  );
}

function slug(value: string): string {
  return (
    value
      .normalize("NFKD")
      .toLocaleLowerCase("en")
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "") || "unknown"
  );
}

function importFailure(
  code: ImportError["code"],
  message: string,
  sourcePath: string,
): Effect.Effect<never, ImportError> {
  return Effect.fail(new ImportError({ code, message, sourcePath }));
}
