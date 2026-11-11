# n8n-nodes-prisma

This is an n8n community node. It lets you create and manage [Prisma Postgres](https://www.prisma.io/postgres) databases in your n8n workflows.

Prisma Postgres is a managed PostgreSQL database with built-in connection pooling and support for pgvector. This node covers provisioning: projects, databases, and connection credentials. For queries, vector search, and embeddings, you keep using the nodes n8n already ships, such as Postgres and Postgres PGVector Store.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation) · [Operations](#operations) · [Credentials](#credentials) · [Compatibility](#compatibility) · [Usage](#usage) · [Example workflows](#example-workflows) · [Security](#security) · [Troubleshooting](#troubleshooting) · [Known limitations](#known-limitations) · [Development](#development) · [Resources](#resources) · [Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

On a self-hosted instance, open **Settings > Community Nodes**, select **Install**, and enter `n8n-nodes-prisma`. After the install finishes, search the node panel for **Prisma Postgres**.

n8n Cloud only offers verified community nodes. This package is prepared for verification and has not been submitted yet.

## Operations

| Resource   | Operations                    |
| ---------- | ----------------------------- |
| Workspace  | Get, Get Many                 |
| Project    | Create, Get, Get Many, Delete |
| Database   | Create, Get, Get Many, Delete |
| Connection | Create, Get Many, Delete      |

**Project: Create** also creates the project's first database, unless you turn that off. **Database: Create** adds another database to an existing project. Both wait until the database is ready before they return.

**Connection: Create** generates database credentials. It is the operation that returns a password, and its output uses the field names of n8n's Postgres credential.

**Delete** operations are permanent. Deleting a project removes all of its databases, and deleting a connection revokes its credentials.

Every **Get Many** operation has **Return All** and **Limit** and follows the API's pagination. Projects, databases, and workspaces can be picked from a searchable list or set by ID with an expression. Each input item is processed separately, and every output item is linked to the input item that produced it.

The node can also be used as a tool by an AI Agent. Be careful with that: a service token can delete projects.

## Credentials

The node authenticates with a Prisma workspace service token.

1. Open [Prisma Console](https://console.prisma.io) and select your workspace.
2. Go to **Settings > Service Tokens** and create a token.
3. In n8n, create a **Prisma API** credential and paste the token into **Service Token**.
4. Select **Test**.

The test lists your workspaces and never creates anything.

A service token can manage every project in its workspace. Treat it like a password, and use a separate workspace for experiments.

## Compatibility

Developed and tested with n8n 2.47.4. The package requires Node.js 20.19 or later and has no runtime dependencies.

The tests cover the following:

- 60 unit tests for authentication, request construction, pagination, validation, error handling, retries, multiple items, and secret handling.
- The pgvector schema and every example query, run against a real Prisma Postgres database.
- Loading the packed node in n8n, including the credential test and the dropdowns.
- The database steps of the example workflows, run in n8n against a real Prisma Postgres database.

Two areas are not verified yet:

- **Operations with a valid service token.** They are covered by unit tests against the documented API responses, but the live test in `test/integration/management-api.test.ts` has not been run.
- **Third-party nodes in the examples.** The Gmail, Notion, Gemini, and OpenAI nodes need accounts for those services. Their node types, versions, and parameters were checked against n8n 2.47.4, and the database steps ran with stand-in embeddings and sample input.

## Usage

### Create a database

1. Add a **Prisma Postgres** node and select **Project > Create**. Give the project a name and pick a region.
2. Add a second **Prisma Postgres** node and select **Connection > Create**. Set **Database** to **By ID** and enter the expression `{{ $json.database.id }}`.
3. Run the workflow.

The first node returns the project and its database. The second node returns the connection details:

```json
{
	"id": "con_...",
	"name": "n8n",
	"databaseId": "db_...",
	"endpointType": "pooled",
	"host": "pooled.db.prisma.io",
	"port": 5432,
	"database": "postgres",
	"user": "...",
	"password": "...",
	"ssl": "require",
	"connectionString": "postgres://...",
	"direct": { "host": "db.prisma.io", "port": 5432, "connectionString": "postgres://..." },
	"pooled": { "host": "pooled.db.prisma.io", "port": 5432, "connectionString": "postgres://..." }
}
```

**Endpoint Type** decides which endpoint the top-level `host`, `port`, and `connectionString` point to. Choose **Pooled** for workflows that run often or in parallel, and **Direct** for schema changes and long transactions. The output always includes both.

To add a database to a project you already have, use **Database > Create** and select the project from the list.

### Connect the Postgres node

A community node cannot create or change the credentials of another node, so the connection details have to reach a Postgres credential in one of three ways. All three were tested on n8n 2.47.4.

#### Copy the values once

This is the recommended way for a database you keep using.

Create a **Postgres** credential and copy `host`, `database`, `user`, `password`, and `port` from the **Connection > Create** output into the fields of the same name. Set **SSL** to **Require** and leave **Ignore SSL Issues** off.

Afterwards, delete the execution that shows the password.

#### Let a workflow create the credential

n8n's built-in **n8n** node can create credentials through the n8n API. Add it after **Connection > Create** with these settings:

- **Resource:** Credential
- **Operation:** Create
- **Credential Type:** `postgres`
- **Data:** the expression below

```text
{{ JSON.stringify({
	host: $json.host,
	port: $json.port,
	database: $json.database,
	user: $json.user,
	password: $json.password,
	ssl: "require",
	allowUnauthorizedCerts: false,
	sshTunnel: false,
	maxConnections: 10
}) }}
```

This needs an n8n API key with the `credential:create` scope, and the n8n API is not available on every plan. The complete workflow is in [`examples/4-create-database-and-postgres-credential.json`](examples/4-create-database-and-postgres-credential.json).

#### Read the connection from the previous node

Postgres credential fields accept expressions. Create a Postgres credential with these values:

| Field    | Value                  |
| -------- | ---------------------- |
| Host     | `{{ $json.host }}`     |
| Database | `{{ $json.database }}` |
| User     | `{{ $json.user }}`     |
| Password | `{{ $json.password }}` |
| Port     | `{{ $json.port }}`     |
| SSL      | Require                |

A Postgres node that uses this credential connects to whichever database the incoming item describes. That suits workflows that create a database and use it in the same run, such as one database per customer.

The item that reaches the Postgres node must contain the connection fields, and the password is stored with the execution data.

### Use pgvector

Prisma Postgres includes the `vector` extension. On 2026-11-11, a new database ran PostgreSQL 17.2 and offered pgvector 0.8.1. Enable the extension once per database:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

#### Reference schema

[`sql/schema.sql`](sql/schema.sql) creates a `documents` table for AI context. Run it once with a Postgres node set to **Execute Query**, or with `psql`.

| Column        | Type           | Purpose                                              |
| ------------- | -------------- | ---------------------------------------------------- |
| `id`          | `uuid`         | Primary key of the chunk                             |
| `content`     | `text`         | The text that was embedded                           |
| `metadata`    | `jsonb`        | Anything you want to filter on                       |
| `embedding`   | `vector(1536)` | The embedding                                        |
| `document_id` | `text`         | Source document ID, read from `metadata.document_id` |
| `source`      | `text`         | Origin of the text, read from `metadata.source`      |
| `created_at`  | `timestamptz`  | Set on insert                                        |
| `updated_at`  | `timestamptz`  | Set by a trigger on every update                     |

The `document_id` and `source` columns are generated from `metadata`. This keeps the table compatible with n8n's **Postgres PGVector Store** node, which only writes content, metadata, and the embedding.

To use the table with that node, set **Table Name** to `documents`. Then open **Options > Column Names** and set **Content Column Name** to `content`.

#### Embedding size

The size of the `embedding` column must match the size of the vectors your model returns. An insert with the wrong size fails with a message such as `expected 1536 dimensions, not 3072`.

| Model                                   | Size | Column         |
| --------------------------------------- | ---- | -------------- |
| OpenAI `text-embedding-3-small`         | 1536 | `vector(1536)` |
| OpenAI `text-embedding-3-large`         | 3072 | `vector(3072)` |
| Google `gemini-embedding-001` (default) | 3072 | `vector(3072)` |
| Google `text-embedding-004`             | 768  | `vector(768)`  |

n8n's **Embeddings OpenAI** node has a **Dimensions** option. The **Embeddings Google Gemini** node has no such setting, so `gemini-embedding-001` arrives at 3072.

pgvector cannot build an HNSW index on a `vector` column above 2000 dimensions. For 3072 dimensions, you have two choices:

- **Skip the vector index.** Search is then exact and scans the table, which is fine for thousands of rows. The Gemini example works this way.
- **Index a half-precision cast**, as shown in [`sql/schema-3072.sql`](sql/schema-3072.sql). Queries must use the same cast, so this works with SQL in the Postgres node and not with the PGVector Store node.

#### Queries

[`sql/queries.sql`](sql/queries.sql) contains parameterized statements for the Postgres node: insert a chunk, replace a document, search by similarity, search with a metadata filter, and update a chunk.

A similarity search looks like this:

```sql
SELECT id, document_id, source, content, metadata,
       1 - (embedding <=> $1::vector) AS similarity
FROM documents
ORDER BY embedding <=> $1::vector
LIMIT $2;
```

In the Postgres node, set **Options > Query Parameters** to an expression that returns an array:

```text
{{ [ JSON.stringify($json.embedding), 5 ] }}
```

The array form is safe for values that contain commas.

## Example workflows

The [`examples`](examples) folder contains four workflows. Import one with **Workflows > Import from File**, then select your own credentials on its nodes.

| File                                                                                                        | Description                                               |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [`1-create-database.json`](examples/1-create-database.json)                                                 | Create a project, a database, and a connection            |
| [`2-accounts-inbox-gemini.json`](examples/2-accounts-inbox-gemini.json)                                     | Triage an accounts inbox with Gemini and pgvector         |
| [`3-notion-policy-knowledge-base.json`](examples/3-notion-policy-knowledge-base.json)                       | Sync Notion policies and answer questions with OpenAI     |
| [`4-create-database-and-postgres-credential.json`](examples/4-create-database-and-postgres-credential.json) | Create a database and save a matching Postgres credential |

### Accounts inbox with pgvector and Gemini

This workflow is for an accounts inbox where most emails and bills can be triaged automatically. It has two parts.

The setup part runs once. It creates the `accounts_context` and `inbox_suggestions` tables, embeds a few sample notes with Gemini, and stores them. Replace the samples with your own vendor notes, payment rules, and past decisions.

The inbox part runs for every new email. A Gmail Trigger passes the email and its attachments to an AI Agent that runs on Gemini. The agent first searches `accounts_context` through a PGVector Store tool, then returns a structured analysis with the category, vendor, amount, due date, suggested action, and confidence. It also states whether a person has to review the email.

The analysis is saved to `inbox_suggestions`. Rows that need a person get the status `pending_review` and continue to a placeholder node, which you replace with Slack, email, or a form.

The workflow never pays, replies, or deletes anything. It only writes suggestions.

### Notion policy knowledge base

This workflow keeps company policies searchable and helps draft updates with the right context. It also has two parts.

The sync part runs every night or on demand. It reads every page of a Notion database, collects the page text, removes the previous version of that policy from `policy_documents`, and stores the new chunks with OpenAI embeddings. Running it twice does not duplicate rows.

The ask part is a chat backed by an AI Agent on an OpenAI model. The agent searches `policy_documents` before it answers and names the policy title and link for each statement. When you ask for a policy change, it returns a draft for review. Nothing is written back to Notion.

## Security

**Service token.** The token is stored in n8n's encrypted credential store. It is sent only as an `Authorization` header to `https://api.prisma.io` and never appears in output or error messages.

**Database passwords.** Passwords and connection strings leave the node only from **Connection > Create**. **Project > Create** and **Database > Create** include them only when you turn on **Include Connection Details**. All other operations remove them from the API response.

**Execution data.** n8n stores node output with each execution. After you create a connection, delete that execution or turn off saving of successful executions in the workflow settings.

**Revoking access.** Delete the connection with **Connection > Delete**.

**Read-only helpers.** Dropdowns and the credential test only send read requests. A resource is created, changed, or deleted only when an operation that you selected runs.

**Retries.** Rate-limited requests are retried up to three times and respect the `Retry-After` header. Gateway errors are retried for read requests only, so a retry cannot create a second database.

## Troubleshooting

**Prisma did not accept the service token.** The token is incomplete or revoked. Create a new one under **Settings > Service Tokens** in Prisma Console.

**The service token is not allowed to do this.** The resource belongs to another workspace. Use a token from that workspace.

**Prisma could not find the requested resource.** Check the ID. The resource may already be deleted.

**Prisma rate limit reached.** The node already retried the request. Wait a moment, or process fewer items per run.

**Database is still provisioning after 120 seconds.** The database exists. Check its status with **Database > Get**, or turn off **Wait Until Ready**.

**The Postgres node cannot connect.** Set **SSL** to **Require** in the Postgres credential, then check the host, user, and password.

**`expected N dimensions, not M`.** The `embedding` column does not match your model. See [Embedding size](#embedding-size).

**`column cannot have more than 2000 dimensions for hnsw index`.** See the note on 3072 dimensions in [Embedding size](#embedding-size).

**`type "vector" does not exist`.** Run `CREATE EXTENSION IF NOT EXISTS vector;` first.

**A dropdown is empty.** The workspace has no projects or databases yet. Create one with **Project > Create**.

## Known limitations

- The node covers Prisma Postgres only. Prisma Compute, backups, usage metrics, and credential rotation are not included.
- The node cannot create an n8n Postgres credential by itself. See [Connect the Postgres node](#connect-the-postgres-node).
- Read operations never return passwords. If you lose a password, create a new connection.
- Searching a dropdown by name scans at most 1000 entries, because the API has no name filter.
- Authentication is by service token. OAuth is not supported.

## Development

```bash
npm install
npm run dev     # n8n on http://localhost:5678 with this node and hot reload
npm test        # unit tests
npm run lint
npm run build
```

[CONTRIBUTING.md](CONTRIBUTING.md) explains the integration tests, the release process, and the rules that keep the package eligible for n8n verification.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Prisma Postgres documentation](https://www.prisma.io/docs/postgres)
- [Prisma Management API reference](https://www.prisma.io/docs/rest-api)
- [Connecting to Prisma Postgres](https://www.prisma.io/docs/postgres/database/connecting-to-your-database)

## Version history

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
