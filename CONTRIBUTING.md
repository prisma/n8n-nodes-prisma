# Contributing

Thanks for helping improve the Prisma Postgres node for n8n.

## Setup

You need Node.js 20.19 or later.

```bash
git clone https://github.com/prisma/n8n-nodes-prisma.git
cd n8n-nodes-prisma
npm install
```

## Everyday commands

| Command                    | What it does                                                      |
| -------------------------- | ----------------------------------------------------------------- |
| `npm run dev`              | Starts n8n on http://localhost:5678 with this node and hot reload |
| `npm run build`            | Compiles to `dist/`                                               |
| `npm run lint`             | Runs the n8n community node linter                                |
| `npm run format`           | Formats the code with Prettier                                    |
| `npm run typecheck`        | Type-checks the node and the tests                                |
| `npm test`                 | Runs the unit tests. No network access and no credentials needed. |
| `npm run test:integration` | Runs the live tests. See below.                                   |

CI runs format check, lint, type check, unit tests and build on every pull request.

## Integration tests

The integration tests are skipped unless you provide credentials.

```bash
# pgvector schema and example queries. Use a scratch database: the documents table is dropped.
# `npx create-db` gives you a temporary Prisma Postgres database without an account.
DATABASE_URL="postgres://..." npm run test:integration

# Management API. Creates one project with two databases, then deletes them.
PRISMA_SERVICE_TOKEN="..." npm run test:integration
```

Use a service token from a workspace that is meant for testing. Never commit a token or a
connection string.

## Rules for changes

- The package must keep zero runtime dependencies. n8n does not verify community nodes that have any.
- Node code must not read environment variables or touch the file system.
- Only call endpoints that are documented in the
  [Management API reference](https://www.prisma.io/docs/rest-api). Skip the ones marked experimental.
- Dropdowns and the credential test must stay read-only. Only an explicit operation may create,
  change or delete a resource.
- Secrets leave the node only from Connection: Create, or when a user turns on Include Connection
  Details. Every other output goes through `redactSecrets`.
- Do not add SQL operations. n8n's Postgres node covers them.
- Add or update unit tests for every behavior change, and update `CHANGELOG.md`.

## Releasing

Releases are published by GitHub Actions with npm provenance, which n8n requires for verified
community nodes. Maintainers run `npm run release` locally. It lints, builds, bumps the version,
updates the changelog, and pushes a tag. The tag triggers `.github/workflows/publish.yml`.
