# Contributing

Thank you for helping improve the Prisma Postgres node for n8n. This guide explains how to set up the project, how to test your changes, and which rules keep the package eligible for n8n verification.

## Getting started

You need Node.js 20.19 or later. After cloning the repository, install the dependencies and start n8n with the node loaded:

```bash
git clone https://github.com/prisma/n8n-nodes-prisma.git
cd n8n-nodes-prisma
npm install
npm run dev
```

The `dev` command opens n8n on http://localhost:5678 and reloads the node whenever you change its code.

## Commands

| Command                    | What it does                                             |
| -------------------------- | -------------------------------------------------------- |
| `npm run dev`              | Starts n8n with this node and reloads it on every change |
| `npm run build`            | Compiles the package to `dist/`                          |
| `npm run lint`             | Runs the n8n community node linter                       |
| `npm run format`           | Formats the code with Prettier                           |
| `npm run typecheck`        | Type-checks the node and the tests                       |
| `npm test`                 | Runs the unit tests                                      |
| `npm run test:integration` | Runs the tests that need a real database or account      |

Every pull request runs the format check, the linter, the type check, the unit tests, and the build, so it helps to run them locally before you push.

## Tests

The unit tests need neither network access nor credentials, because they replace the Prisma API with prepared responses.

The integration tests talk to real services and are skipped until you provide what they need.

To test the pgvector schema and the example queries, point `DATABASE_URL` at a scratch database. The test drops and recreates the `documents` table, so do not use a database you care about. If you do not have one at hand, `npx create-db` gives you a temporary Prisma Postgres database without an account.

```bash
DATABASE_URL="postgres://..." npm run test:integration
```

To test the node against the Prisma API, provide a service token from a workspace that is meant for testing. The test creates one project with two databases and deletes them again when it finishes.

```bash
PRISMA_SERVICE_TOKEN="..." npm run test:integration
```

Please never commit a token or a connection string.

## Rules for changes

n8n only verifies community nodes that follow a set of rules, and this project adds a few of its own to keep the node safe to use.

- **No runtime dependencies.** n8n does not verify community nodes that have any, so everything the node needs has to come from `n8n-workflow`.
- **No environment variables or files.** Node code receives all of its input through parameters and credentials.
- **Documented endpoints only.** The node calls endpoints from the [Management API reference](https://www.prisma.io/docs/rest-api) and stays away from the ones marked experimental.
- **Read-only helpers.** Dropdowns and the credential test may only read, because a resource should only be created, changed, or deleted when an operation that the user selected runs.
- **Secrets stay inside.** Passwords and connection strings leave the node only from **Connection: Create**, or when a user turns on **Include Connection Details**, and every other output goes through `redactSecrets`.
- **No SQL operations.** n8n's Postgres node already covers queries, so this node sticks to provisioning.

When you change behavior, please add or update a unit test and describe the change in `CHANGELOG.md`.

## Example workflows

The files in `examples/` are generated, so that the SQL they contain always matches `sql/schema.sql`. To change an example, edit `scripts/build-examples.mjs` and regenerate the files:

```bash
node scripts/build-examples.mjs
```

## Releasing

n8n requires verified community nodes to be published by GitHub Actions with an npm provenance statement, which is why releases are not published from a local machine.

A maintainer runs `npm run release`, which lints and builds the package, bumps the version, updates the changelog, and pushes a tag. The tag then triggers `.github/workflows/publish.yml`, which publishes the package to npm. The workflow signs in to npm with Trusted Publishing (OIDC), so the repository holds no npm token, and the workflow file must keep the name `publish.yml` because npm trusts that exact file.
