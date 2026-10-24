import assert from "node:assert/strict";
import test from "node:test";

import { chunkMarkdown, passageEmbeddingText, reciprocalRankFusion } from "../src/index.ts";

test("chunks follow headings, skip frontmatter, and keep body line numbers", () => {
  const body = [
    "---",
    "state: draft",
    "---",
    "# Durable storage",
    "",
    "Intro paragraph.",
    "",
    "## Motivation",
    "",
    "We need recovery.",
    "",
    "```sh",
    "# not a heading",
    "```",
    "",
    "### Details",
    "Checkpoint details.",
    "## Empty",
    "## Alternatives",
    "Use a database.",
  ].join("\n");

  const chunks = chunkMarkdown(body);

  assert.deepEqual(
    chunks.map((chunk) => ({
      end: chunk.endLine,
      path: chunk.headingPath,
      start: chunk.startLine,
    })),
    [
      { end: 6, path: ["Durable storage"], start: 4 },
      { end: 14, path: ["Durable storage", "Motivation"], start: 8 },
      { end: 17, path: ["Durable storage", "Motivation", "Details"], start: 16 },
      { end: 20, path: ["Durable storage", "Alternatives"], start: 19 },
    ],
  );
  assert.match(chunks[1]?.text ?? "", /# not a heading/u);
  assert.deepEqual(
    chunks.map((chunk) => chunk.ordinal),
    [0, 1, 2, 3],
  );
});

test("long sections split at paragraph boundaries within the size limit", () => {
  const paragraph = "word ".repeat(60).trim();
  const body = ["# Long", "", ...Array.from({ length: 12 }, () => [paragraph, ""]).flat()].join(
    "\n",
  );

  const chunks = chunkMarkdown(body, { maxCharacters: 800, targetCharacters: 600 });

  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= 800);
    assert.deepEqual(chunk.headingPath, ["Long"]);
  }
  for (let index = 1; index < chunks.length; index += 1) {
    assert.ok((chunks[index]?.startLine ?? 0) > (chunks[index - 1]?.endLine ?? 0));
  }
});

test("bodies without headings still produce a passage", () => {
  assert.deepEqual(chunkMarkdown("Just a line.\nAnother line."), [
    { endLine: 2, headingPath: [], ordinal: 0, startLine: 1, text: "Just a line.\nAnother line." },
  ]);
  assert.deepEqual(chunkMarkdown("\n\n"), []);
});

test("passage embedding text carries document and section context", () => {
  assert.equal(
    passageEmbeddingText("Title", { headingPath: ["A", "B"], text: "Body" }),
    "Title\nA › B\n\nBody",
  );
});

test("reciprocal rank fusion rewards agreement between rankings", () => {
  const scores = reciprocalRankFusion([
    ["a", "b", "c"],
    ["c", "a"],
  ]);
  const ranked = [...scores.entries()].toSorted((left, right) => right[1] - left[1]);
  assert.deepEqual(
    ranked.map(([key]) => key),
    ["a", "c", "b"],
  );
});
