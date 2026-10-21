# Inkling

Inkling is a collaborative Markdown based RFC and note editor built to replace a
Google Docs-based RFC process at Earendil. In many ways the RFC system at Earendil
is inspired by Oxide Computer and other companies that use it internally.

The idea behind Inkling however is that it's not limited to formal RFCs. It
does use numbered RFCs for proposals that are true RFCs but it also supports
unnumbered notes for meeting notes, design sketches, investigations, and other
discussions that do not warrant an RFC.

It is also agent-native: people and coding agents can work with the same
documents, comments, metadata, and publication workflows through the web app,
MCP, CLI, and API.

It's built to easily deploy to Cloudflare but can also be run locally.

## What you can do

- Draft Markdown together in real time with others.
- Leave comments inline and discuss documents.
- Create numbered RFCs as well as lightweight, unnumbered notes.
- Keep a live working draft while publishing explicit, immutable revisions.
- Share documents publicly and privately.
- Let agents create, read, search, edit, comment on, organize, and publish documents with the same authorization rules as people.

## Authoring

RFCs and notes use markdown as syntax. RFC numbers are allocated monotonically
and have canonical routes such as `/rfc/0042`. Notes are more informal and
always have their own internal document IDs as URL. They are for meeting notes
and other throwaway documents that do not need to live forever.

The first top-level Markdown heading is the document title. Publication
metadata lives in YAML frontmatter at the beginning of the collaborative source:

```yaml
---
authors:
  - author@example.com
state: discussion
visibility: private
labels:
  - architecture
  - platform
---
```

Frontmatter does not itself change authorization or publish a working draft. An
authorized user must explicitly publish it, which validates the frontmatter and
creates an immutable published revision.

The public landing page lists public, published RFCs and notes without requiring
sign-in. Anonymous readers see only those published revisions.

External destinations that should only be revealed to signed-in workspace members
can carry Inkling's reserved `__require_auth=1` query parameter:

```markdown
[Recording](https://videos.example/recording?id=123&__require_auth=1)
```

Inkling removes the reserved parameter from the destination and sends anonymous
readers through Google sign-in before redirecting. The parameter must occur exactly
once with the value `1`; ordinary parameters such as `require_auth=1` are passed
through unchanged.

## Finding documents

Press `/` or <kbd>Cmd/Ctrl</kbd>+<kbd>K</kbd> from the workspace to focus
search. Plain terms search titles, complete working-draft bodies, RFC numbers,
labels, states, and people. Terms are combined with AND. Quote a phrase to
keep it together and prefix a term or filter with `-` to exclude it.

Search supports Gmail-style filters:

| Filter          | Example                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| Label           | `label:platform` or `tag:"machine learning"`                                |
| Lifecycle state | `state:discussion`                                                          |
| Visibility      | `visibility:public`, `visibility:private`, or `visibility:confidential`     |
| People          | `author:name@example.com`, `reviewer:alex`, `approver:sam`, or `person:lee` |
| RFC number      | `rfc:42`                                                                    |
| Document kind   | `is:rfc`, `is:note`, `is:published`, or `is:unpublished`                    |
| Presence        | `has:rfc` or `has:publication`                                              |

## Working With Agents

Every Inkling instance is an MCP server at `/mcp` (Streamable HTTP). Agents
search, read, create, edit, comment on, publish, and trash documents through it
with the same authorization rules as people, and their edits appear live for
anyone editing in the browser. Agents that support MCP OAuth only need the URL;
the user signs in through the browser and approves access:

```sh
claude mcp add --transport http inkling https://rfcs.example.com/mcp
```

Approved agents are listed under **API keys** in the account menu, where they
can be revoked. Agents without OAuth support can send a personal API key from
the same dialog as a bearer token instead.

Each instance also serves an origin-aware
[`/AGENTS.md`](http://localhost:8787/AGENTS.md) with setup steps for common
agents and safe editing guidance; point an agent at it when it encounters an
Inkling URL. The served instructions never contain credentials.

The `inkling` command-line client remains for administration that does not fit
a tool call, such as imports, backups, restores, and attachment uploads:

```sh
inkling workspace add https://rfcs.example.com API_KEY
inkling import-rfc rfcs.example.com rfc-0057.md
inkling backup rfcs.example.com backup.json
```

Run the CLI directly from a checkout with `node packages/cli/src/main.ts --help`.
Set `INKLING_CONFIG` to override the CLI configuration path and `INKLING_AUTHOR`
to set the guest comment name.

## Deployment

Inkling can run as a self-contained Node.js service backed by the filesystem or
on Cloudflare using Durable Objects and R2. See [`DEPLOYMENT.md`](DEPLOYMENT.md)
for local setup, Google OAuth configuration, Docker, and production deployment
instructions. Maintainers can find the npm package process in
[`RELEASING.md`](RELEASING.md).
