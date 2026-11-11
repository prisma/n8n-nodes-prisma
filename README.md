# n8n-nodes-prisma

An [n8n](https://n8n.io) community node for [Prisma Postgres](https://www.prisma.io/postgres). Create and manage Prisma Postgres projects, databases and connections from a workflow, then use the database with n8n's own Postgres and AI nodes.

The node handles provisioning. Queries, pgvector search and embeddings stay with the nodes n8n already ships: **Postgres**, **Postgres PGVector Store**, and the embeddings nodes for Gemini and OpenAI.

- [Installation](#installation)
- [Credentials](#credentials)
- [Operations](#operations)
- [Walkthrough: from nothing to a queryable database](#walkthrough-from-nothing-to-a-queryable-database)
- [Connect n8n's Postgres node](#connect-n8ns-postgres-node)
- [pgvector](#pgvector)
- [Example workflows](#example-workflows)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)
- [What was tested](#what-was-tested)
- [Development](#development)

## Installation

Self-hosted n8n: open **Settings > Community Nodes**, select **Install**, and enter `n8n-nodes-prisma`. The [n8n community nodes guide](https://docs.n8n.io/integrations/community-nodes/installation/) covers the other install methods.

n8n Cloud only offers verified community nodes. This package is prepared for verification and has not been submitted yet.

After installing, search the node panel for **Prisma Postgres**.

## Credentials

The node uses a Prisma workspace **service token**.

1. Open [Prisma Console](https://console.prisma.io) and select your workspace.
2. Go to **Settings > Service Tokens** and create a token.
3. In n8n, create a **Prisma API** credential and paste the token into **Service Token**.
4. Select **Test**. The test lists your workspaces. It never creates anything.

A service token can manage every project in its workspace, including deleting them. Treat it like a password and use a separate workspace for experiments.

## Operations

| Resource   | Operation | What it does                                                           |
| ---------- | --------- | ---------------------------------------------------------------------- |
| Workspace  | Get       | Returns one workspace                                                  |
| Workspace  | Get Many  | Lists the workspaces the token can access                              |
| Project    | Create    | Creates a project, with a Prisma Postgres database by default          |
| Project    | Get       | Returns one project                                                    |
| Project    | Get Many  | Lists projects                                                         |
| Project    | Delete    | Deletes a project and all of its databases                             |
| Database   | Create    | Creates a database in a project and waits until it is ready            |
| Database   | Get       | Returns one database with its status and region                        |
| Database   | Get Many  | Lists databases, optionally for one project                            |
| Database   | Delete    | Deletes a database and its data                                        |
| Connection | Create    | Creates database credentials and returns host, user, password and URLs |
| Connection | Get Many  | Lists connection metadata, without passwords                           |
| Connection | Delete    | Deletes a connection and revokes its credentials                       |

Good to know:

- Projects, workspaces and databases are picked from searchable lists, or by ID with an expression.
- **Get Many** has **Return All** and **Limit** and follows the API's cursor pagination.
- Each input item is processed separately and every output item is linked to the input item that produced it.
- Rate-limited requests (HTTP 429) are retried up to three times and honor `Retry-After`. Gateway errors are retried for reads only, so a retry can never create a second database.
- The node can be used as a tool by an AI Agent. Think twice before giving an agent a token that can delete projects.

### Connection: Create output

The output uses the same field names as n8n's Postgres credential:

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

**Endpoint Type** selects which endpoint the top-level `host`, `port` and `connectionString` point to. **Pooled** suits workflows that run often or in parallel. **Direct** suits schema changes and long transactions. Both are always included.

## Walkthrough: from nothing to a queryable database

1. Add a **Prisma API** credential ([Credentials](#credentials)).
2. Add a **Prisma Postgres** node with **Project > Create**. Give it a name and a region. This creates the project and its first database, and waits until the database is ready.
3. Add a second **Prisma Postgres** node with **Connection > Create**. Set **Database** to **By ID** with the expression `{{ $json.database.id }}`.
4. Run the workflow. The second node returns host, port, database, user and password.
5. Create a **Postgres** credential from those values ([next section](#connect-n8ns-postgres-node)).
6. Use the credential in a **Postgres** node to create tables and query data.

To add a database to an existing project, use **Database > Create** and select the project from the list.

[`examples/1-create-database.json`](examples/1-create-database.json) contains steps 2 to 4.

## Connect n8n's Postgres node

A community node cannot create or change credentials of other nodes. n8n does not expose that to nodes. There are three supported ways to get the connection details into a Postgres credential. All three were tested on n8n 2.47.4.

### Option 1: copy the values once (recommended)

Create a **Postgres** credential and copy these fields from the **Connection > Create** output:

| Postgres credential field | Value       |
| ------------------------- | ----------- |
| Host                      | `host`      |
| Database                  | `database`  |
| User                      | `user`      |
| Password                  | `password`  |
| Port                      | `port`      |
| SSL                       | **Require** |

Leave **Ignore SSL Issues** off. Then delete the execution that shows the password.

### Option 2: let a workflow create the credential

n8n's built-in **n8n** node can create credentials through the n8n API. Chain it after **Connection > Create**:

- **Resource**: Credential, **Operation**: Create
- **Credential Type**: `postgres`
- **Data**: `{{ JSON.stringify({ host: $json.host, port: $json.port, database: $json.database, user: $json.user, password: $json.password, ssl: "require", allowUnauthorizedCerts: false, sshTunnel: false, maxConnections: 10 }) }}`

This needs an n8n API key with the `credential:create` scope. The n8n API is not available on every plan. [`examples/4-create-database-and-postgres-credential.json`](examples/4-create-database-and-postgres-credential.json) is the complete workflow.

### Option 3: a credential that reads from the previous node

Postgres credential fields accept expressions. A credential with **Host** `{{ $json.host }}`, **Database** `{{ $json.database }}`, **User** `{{ $json.user }}`, **Password** `{{ $json.password }}`, **Port** `{{ $json.port }}` and **SSL** Require connects to whatever database the incoming item describes.

Use this for workflows that provision a database and use it in the same run, such as one database per customer. The item that reaches the Postgres node must contain the connection fields, and the password is stored with the execution data.

## pgvector

Prisma Postgres ships the `vector` extension. On 2026-11-11 a new database ran PostgreSQL 17.2 and offered pgvector 0.8.1. Enable it once per database:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### Reference schema

[`sql/schema.sql`](sql/schema.sql) creates a `documents` table for AI context. Run it once with a Postgres node (**Execute Query**) or with `psql`.

| Column        | Type           | Purpose                                              |
| ------------- | -------------- | ---------------------------------------------------- |
| `id`          | `uuid`         | Primary key of the chunk                             |
| `content`     | `text`         | The text that was embedded                           |
| `metadata`    | `jsonb`        | Anything you want to filter on                       |
| `embedding`   | `vector(1536)` | The embedding                                        |
| `document_id` | `text`         | Source document ID, read from `metadata.document_id` |
| `source`      | `text`         | Where it came from, read from `metadata.source`      |
| `created_at`  | `timestamptz`  | Set on insert                                        |
| `updated_at`  | `timestamptz`  | Set by a trigger on every update                     |

`document_id` and `source` are generated from `metadata`. That keeps the table compatible with n8n's **Postgres PGVector Store** node, which only writes content, metadata and embedding. In that node, set **Table Name** to `documents` and, under **Options > Column Names**, set **Content Column Name** to `content`.

### Match the embedding size to your model

The column size must equal the size of the vectors your model returns. An insert with the wrong size fails with `expected 1536 dimensions, not 3072`.

| Model                                   | Size | Column         |
| --------------------------------------- | ---- | -------------- |
| OpenAI `text-embedding-3-small`         | 1536 | `vector(1536)` |
| OpenAI `text-embedding-3-large`         | 3072 | `vector(3072)` |
| Google `gemini-embedding-001` (default) | 3072 | `vector(3072)` |
| Google `text-embedding-004`             | 768  | `vector(768)`  |

n8n's **Embeddings Google Gemini** node has no setting for the output size, so `gemini-embedding-001` arrives at 3072. n8n's **Embeddings OpenAI** node has a **Dimensions** option.

pgvector cannot build an HNSW index on a `vector` column above 2000 dimensions. For 3072 you have two choices:

- Skip the vector index. Search is then exact and scans the table, which is fine for thousands of rows. The Gemini example does this.
- Index a half-precision cast, as in [`sql/schema-3072.sql`](sql/schema-3072.sql). Queries must use the same cast, so this works with SQL in the Postgres node and not with the PGVector Store node.

### Example queries

[`sql/queries.sql`](sql/queries.sql) has parameterized statements for the Postgres node: insert, replace a document, similarity search, filtered search and update. A similarity search looks like this:

```sql
SELECT id, document_id, source, content, metadata,
       1 - (embedding <=> $1::vector) AS similarity
FROM documents
ORDER BY embedding <=> $1::vector
LIMIT $2;
```

In the Postgres node, set **Options > Query Parameters** to an expression that returns an array, for example `{{ [ JSON.stringify($json.embedding), 5 ] }}`. The array form is safe for values that contain commas.

## Example workflows

Import a file with **Workflows > Import from File**, then select your own credentials on the nodes.

| File                                                                                                        | What it shows                                                        |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [`1-create-database.json`](examples/1-create-database.json)                                                 | Manual Trigger > create project and database > create connection     |
| [`2-accounts-inbox-gemini.json`](examples/2-accounts-inbox-gemini.json)                                     | Email > Gemini embeddings > context from Prisma Postgres > AI review |
| [`3-notion-policy-knowledge-base.json`](examples/3-notion-policy-knowledge-base.json)                       | Notion > OpenAI embeddings > Prisma Postgres > chat with retrieval   |
| [`4-create-database-and-postgres-credential.json`](examples/4-create-database-and-postgres-credential.json) | Provision a database and save a Postgres credential automatically    |

### Accounts inbox with pgvector and Gemini

For an accounts@ inbox where most emails and bills can be triaged automatically.

- **Setup row**, run once: creates `accounts_context` and `inbox_suggestions`, then embeds a few sample context notes with Gemini and stores them. Replace the samples with your vendor notes, payment rules and past decisions.
- **Inbox row**, for every new email: the Gmail Trigger passes the email and its attachments to an AI Agent that runs on Gemini. The agent must search `accounts_context` first, through a PGVector Store tool with Gemini embeddings. It returns a structured analysis: category, vendor, amount, due date, suggested action, confidence, and whether a person has to review it.
- The analysis is saved to `inbox_suggestions`. Rows that need a person get the status `pending_review` and go to a placeholder node that you replace with Slack, email or a form.

The workflow never pays, replies or deletes. It only writes suggestions.

### Notion policy knowledge base

For keeping company policies searchable and for drafting updates with their context.

- **Sync row**, nightly or on demand: reads every page of a Notion database, collects the page text, removes the previous version of that policy from `policy_documents`, and stores the new chunks with OpenAI embeddings. Running it twice does not duplicate rows.
- **Ask row**: a chat backed by an AI Agent on an OpenAI model. The agent must search `policy_documents` first and answers with the policy title and link. Asked for a policy change, it returns a draft for review. Nothing is written back to Notion.

### Verification status of the examples

| Part                                                                                  | Status                                                                                             |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| All four files import, and every node type, version and parameter exists              | Verified on n8n 2.47.4                                                                             |
| Schema creation, PGVector Store insert and retrieval, SQL nodes, branching, sync loop | Executed in n8n against a real Prisma Postgres database, with stand-in embeddings and sample input |
| Creating a Postgres credential with the n8n node (example 4, last node)               | Executed in n8n                                                                                    |
| Prisma Postgres nodes in examples 1 and 4 with a valid token                          | **Unverified.** Needs a service token.                                                             |
| Gmail Trigger, Notion nodes, Gemini and OpenAI models and embeddings                  | **Unverified.** Need accounts for those services. Field names follow the n8n node source.          |

## Security

- The service token is stored in n8n's encrypted credential store, sent only as an `Authorization` header to `https://api.prisma.io`, and never written to output or error messages.
- Passwords and connection strings leave the node only from **Connection > Create**, or from **Project > Create** and **Database > Create** when you turn on **Include Connection Details**. All other operations remove them from the API response.
- n8n stores node output with the execution. After creating a connection, delete the execution, or set **Save successful production executions** to **Do not save** in the workflow settings.
- Dropdowns and the credential test only send read requests.
- **Delete** operations are permanent. Do not connect them to untrusted input.
- To revoke database access, delete the connection with **Connection > Delete**.
- The package has no runtime dependencies and does not read environment variables or files.

## Troubleshooting

| Message                                                       | What to do                                                                                                      |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Prisma did not accept the service token                       | The token is incomplete or revoked. Create a new one under **Settings > Service Tokens**.                       |
| The service token is not allowed to do this                   | The resource belongs to another workspace. Use a token from that workspace.                                     |
| Prisma could not find the requested resource                  | Check the ID. The resource may already be deleted.                                                              |
| Prisma rate limit reached                                     | The node already retried. Wait, or process fewer items per run.                                                 |
| Database is still provisioning after 120 seconds              | The database exists. Check it with **Database > Get**, or turn off **Wait Until Ready**.                        |
| Postgres node cannot connect                                  | Set **SSL** to **Require** in the Postgres credential and check host, user and password.                        |
| `expected N dimensions, not M`                                | The embedding column does not match your model. See [embedding sizes](#match-the-embedding-size-to-your-model). |
| `column cannot have more than 2000 dimensions for hnsw index` | See the note on 3072 dimensions above.                                                                          |
| `type "vector" does not exist`                                | Run `CREATE EXTENSION IF NOT EXISTS vector;` first.                                                             |
| The dropdown is empty                                         | The token has no projects yet. Create one with **Project > Create**.                                            |

## Known limitations

- The node covers Prisma Postgres only. Prisma Compute, backups, usage metrics and connection rotation are not included.
- It cannot create an n8n Postgres credential by itself. See [Connect n8n's Postgres node](#connect-n8ns-postgres-node).
- Read operations never return passwords. If you lose one, create a new connection.
- Searching a dropdown by name scans at most 1000 entries, because the API has no name filter.
- OAuth is not supported. Authentication is by service token.
- Operations against the Management API with a valid token have unit tests against the documented response shapes, and no live test run yet. See [What was tested](#what-was-tested).

## What was tested

| Check                                                                                                             | Result                                    |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Unit tests: auth, request construction, mapping, pagination, validation, errors, retries, multiple items, secrets | 60 passing                                |
| `n8n-node lint` (strict, n8n Cloud rules), Prettier, type check, build                                            | Passing                                   |
| pgvector schema and every statement in `sql/queries.sql` on real Prisma Postgres                                  | 9 passing                                 |
| Node loads in n8n 2.47.4 from the packed tarball, with icon, credential and AI tool variant                       | Verified                                  |
| Credential test and dropdowns in n8n with an invalid token                                                        | Verified, clean message from the real API |
| n8n Postgres credential against Prisma Postgres, pooled endpoint, SSL Require                                     | Verified                                  |
| Live Management API test (`test/integration/management-api.test.ts`)                                              | **Not run.** Needs a service token.       |

## Development

```bash
npm install
npm run dev     # n8n on http://localhost:5678 with this node and hot reload
npm test        # unit tests
npm run lint
npm run build
```

[CONTRIBUTING.md](CONTRIBUTING.md) explains the integration tests and the rules that keep the package eligible for n8n verification.

## Resources

- [Prisma Postgres documentation](https://www.prisma.io/docs/postgres)
- [Prisma Management API](https://www.prisma.io/docs/rest-api)
- [Connecting to Prisma Postgres](https://www.prisma.io/docs/postgres/database/connecting-to-your-database)
- [n8n community nodes](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](LICENSE)
