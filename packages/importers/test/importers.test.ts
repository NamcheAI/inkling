import assert from "node:assert/strict";
import test from "node:test";

import { Effect } from "effect";

import {
  importEarendilRfc,
  importExistingJot,
  rewriteKnownRfcSourceLinks,
  rewriteLegacyProtectedLinks,
  rewriteLegacyRfcLinks,
} from "../src/index.ts";

test("Earendil RFC import preserves structured metadata and unknown states", async () => {
  const imported = await Effect.runPromise(
    importEarendilRfc(
      `---
rfc: 42
title: Durable collaboration
authors: [Armin, alice@example.com]
reviewers: Bob
state: needs-council
visibility: public
confidential: false
keywords: [architecture, collaboration]
created: 2024-01-02
updated: 2024-03-04
target_decision_date: 2024-04-01
related_rfcs: [RFC 12, 13]
source_url: https://legacy.example/rfc/42
---
# RFC 0042 Durable collaboration

See [the prior decision](../rfcs/0012-prior.md#outcome).
`,
      {
        people: [
          {
            aliases: ["Armin"],
            displayName: "Armin Ronacher",
            email: "armin@ronacher.eu",
          },
          {
            aliases: ["Bob"],
            displayName: "Robert Reviewer",
            email: "bob@example.com",
          },
        ],
        sourcePath: "rfcs/0042-durable.md",
      },
    ),
  );

  assert.equal(imported.metadata.rfcNumber, 42);
  assert.equal(imported.metadata.lifecycleState, "needs-council");
  assert.equal(imported.metadata.visibility, "public");
  assert.deepEqual(imported.metadata.labels, ["architecture", "collaboration"]);
  assert.equal(imported.metadata.authors?.[0]?.displayName, "Armin Ronacher");
  assert.equal(imported.metadata.reviewers?.[0]?.displayName, "Robert Reviewer");
  assert.deepEqual(imported.relatedRfcNumbers, [12, 13]);
  assert.equal(imported.metadata.title, "Durable collaboration");
  assert.equal(imported.body.startsWith("# Durable collaboration"), true);
  assert.match(imported.body, /\/rfc\/0012#outcome/u);
});

test("legacy confidentiality imports as confidential visibility", async () => {
  const imported = await Effect.runPromise(
    importEarendilRfc(
      "---\nrfc: 43\nvisibility: public\nconfidential: true\n---\n# Restricted decision",
      { sourcePath: "rfcs/0043-restricted.md" },
    ),
  );

  assert.equal(imported.metadata.visibility, "confidential");
  assert.equal("sensitivity" in imported.metadata, false);
});

test("legacy Jot import keeps share and comment migration data", async () => {
  const imported = await Effect.runPromise(
    importExistingJot(
      "---\nignored: frontmatter\n---\nBody text",
      {
        comments: [
          {
            end: 4,
            id: "old-thread",
            messages: [{ author: "Armin", body: "Comment", id: "old-message" }],
            quote: "Body",
            resolved: true,
            start: 0,
          },
        ],
        id: "document_legacy123",
        shareAccess: "comment",
        shareId: "legacy-share",
        title: "Imported note",
      },
      { sourcePath: "notes/imported.md" },
    ),
  );
  assert.equal(imported.body, "# Imported note\n\nBody text");
  assert.equal(imported.capabilityAccess, "comment");
  assert.equal(imported.comments[0]?.messages[0]?.legacyId, "old-message");
  assert.equal(imported.comments[0]?.resolved, true);
});

test("Earendil people entries use canonical emails and names", async () => {
  const imported = await Effect.runPromise(
    importEarendilRfc(
      `---
number: 9
authors:
  - Armin <alias@example.com>
  - unknown@example.com
---
# RFC 0009 People
`,
      {
        people: [
          {
            aliases: ["alias@example.com"],
            displayName: "Armin Ronacher",
            email: "armin@example.com",
          },
        ],
        sourcePath: "rfcs/0009.md",
      },
    ),
  );

  assert.deepEqual(
    imported.metadata.authors?.map(({ displayName, email }) => ({ displayName, email })),
    [
      { displayName: "Armin Ronacher", email: "armin@example.com" },
      { displayName: "unknown@example.com", email: "unknown@example.com" },
    ],
  );
});

test("legacy protected links migrate to the reserved generic marker", () => {
  assert.equal(
    rewriteLegacyProtectedLinks(
      "[recording](https://example.com/watch?v=1&require_earendil_auth=1#chapter)",
    ),
    "[recording](https://example.com/watch?v=1&__require_auth=1#chapter)",
  );
  assert.equal(
    rewriteLegacyProtectedLinks("[ordinary](https://example.com/?require_auth=1)"),
    "[ordinary](https://example.com/?require_auth=1)",
  );
});

test("legacy RFC link rewriting leaves external links unchanged", () => {
  assert.equal(
    rewriteLegacyRfcLinks(
      "[relative](rfc-7-title.md) [old site](http://rfcs/0012.md) [external](https://example.com/7.md)",
    ),
    "[relative](/rfc/0007) [old site](/rfc/0012) [external](https://example.com/7.md)",
  );
});

test("known legacy source links become canonical RFC links", () => {
  const source = "https://docs.google.com/document/d/legacy-id/edit";
  assert.equal(
    rewriteKnownRfcSourceLinks(
      `[prior](${source}?tab=t.0#heading=h.old) [external](https://example.com/)`,
      [{ legacySourceUrl: source, rfcNumber: 7 }],
    ),
    "[prior](/rfc/0007) [external](https://example.com/)",
  );
});

test("Google Docs heading IDs are removed and in-document links follow rendered anchors", async () => {
  const imported = await Effect.runPromise(
    importEarendilRfc(
      `---
number: 40
---

# RFC 0040 Sync {#title-id}

See [storage](#storage) and [caching](#cache-section).

## Overview

### Storage {#storage}

\`\`\`md
## Kept {#kept}
\`\`\`

### Caching Layer {#cache-section}
`,
      { sourcePath: "rfcs/0040.md" },
    ),
  );

  assert.equal(imported.metadata.title, "Sync");
  assert.equal(imported.body.startsWith("# Sync\n\nSee "), true);
  assert.match(imported.body, /\[storage\]\(#storage\) and \[caching\]\(#caching-layer\)/u);
  assert.match(imported.body, /^### Storage$/mu);
  assert.match(imported.body, /^### Caching Layer$/mu);
  assert.match(imported.body, /^## Kept \{#kept\}$/mu);
});

test("Google Docs image size titles and person chips are normalized", async () => {
  const imported = await Effect.runPromise(
    importEarendilRfc(
      `---
number: 5
authors:
  - "Carlotta@example.com <carlotta@example.com>"
keywords: [Radius, radius, Design]
created: "2024-04-17"
updated: "2024-03-07"
---
# RFC 0005 Images

![][image1]  
![inline](_img/b.png "=10x20")
Ask [armin@example.com](mailto:armin@example.com) or [Armin](mailto:armin@example.com).

[image1]: <_img/a.png> "=624x272"
`,
      {
        people: [{ displayName: "Armin Ronacher", email: "armin@example.com" }],
        sourcePath: "rfcs/0005.md",
      },
    ),
  );

  assert.match(imported.body, /^\[image1\]: <_img\/a\.png>$/mu);
  assert.match(imported.body, /!\[inline\]\(_img\/b\.png\)/u);
  assert.match(imported.body, /Ask \[Armin Ronacher\]\(mailto:armin@example\.com\) or \[Armin\]/u);
  assert.deepEqual(imported.metadata.authors?.[0]?.displayName, "carlotta@example.com");
  assert.deepEqual(imported.metadata.labels, ["radius", "design"]);
  assert.equal(imported.metadata.updatedAt, imported.metadata.createdAt);
  assert.equal(imported.warnings.length, 1);
});

test("default Google Docs RFC link labels become RFC numbers", () => {
  const source = "https://docs.google.com/document/d/legacy-id/edit";
  assert.equal(
    rewriteKnownRfcSourceLinks(
      [
        `[0007 \\- Prior Work](${source}?tab=t.0)`,
        `[RFC 7 prior](${source})`,
        `[${source}](${source})`,
        `[custom words](${source})`,
        `[0008 - Other](${source})`,
      ].join(" "),
      [{ legacySourceUrl: source, rfcNumber: 7 }],
    ),
    "[RFC 0007](/rfc/0007) [RFC 0007](/rfc/0007) [RFC 0007](/rfc/0007) [custom words](/rfc/0007) [0008 - Other](/rfc/0007)",
  );
});
