# n8n-nodes-prisma

Create and manage [Prisma Postgres](https://www.prisma.io/postgres) databases from your [n8n](https://n8n.io) workflows.

Many n8n workflows need somewhere to keep data: the context an AI agent looks up, the documents behind a knowledge base, or the records of a new customer. This community node lets a workflow create that database on its own, so you never have to leave n8n to set one up.

Once the database exists, you work with it through the nodes n8n already has. The Postgres node runs your SQL, and the Postgres PGVector Store node stores and searches embeddings.

## What you can build

**Give an AI workflow a memory.** Store notes, rules, and past decisions as embeddings in Prisma Postgres. When a new email or ticket arrives, your workflow finds the most relevant context and hands it to the model. The [accounts inbox example](#accounts-inbox-with-gemini) works this way.

**Turn your documents into a knowledge base.** Sync pages from Notion or another source into Prisma Postgres, then let people ask questions in a chat. The answers come from your own content. See the [policy knowledge base example](#notion-policy-knowledge-base).

**Create a database for every customer or environment.** When someone signs up or a new project starts, a workflow can create a fresh database and pass its connection details to the next step.

**Spin up a database for a test and remove it afterwards.** Create a database at the start of a workflow, use it, and delete it at the end.

## How it fits together

Prisma Postgres organizes things in three levels, and the node has one resource for each:

- A **project** groups the databases that belong to one app or use case.
- A **database** is a PostgreSQL database inside a project. It supports pgvector, so it can store embeddings.
- A **connection** is a set of credentials for one database: a host, a user, and a password.

A typical setup has three steps. You create a project and its database with this node, then create a connection, and finally give those connection details to n8n's Postgres node. From then on, your workflows read and write data through the Postgres node.

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

On a self-hosted instance, open **Settings > Community Nodes**, select **Install**, and enter `n8n-nodes-prisma`. When the install finishes, search the node panel for **Prisma Postgres**.

n8n Cloud only offers verified community nodes. This package has not been submitted for verification yet.

## Credentials

The node connects to your Prisma account with a service token.

1. Open [Prisma Console](https://console.prisma.io) and select your workspace.
2. Go to **Settings > Service Tokens** and create a token.
3. In n8n, create a **Prisma API** credential and paste the token into **Service Token**.
4. Select **Test** to check that it works.

A service token can manage every project in its workspace, so treat it like a password. If you only want to experiment, create a separate workspace first.

## Quick start

This walkthrough creates a database and connects n8n's Postgres node to it. It takes about five minutes.

### 1. Create a project and a database

Add a **Prisma Postgres** node to a workflow. Select the **Project** resource and the **Create** operation, then enter a name and choose a region close to you.

Creating a project also creates its first database, so one node gives you both.

### 2. Create a connection

Add a second **Prisma Postgres** node after the first. Select the **Connection** resource and the **Create** operation.

In the **Database** field, switch to **By ID** and enter this expression. It picks up the database that the previous node created:

```text
{{ $json.database.id }}
```

### 3. Run the workflow

Select **Execute workflow**. The second node returns everything a Postgres client needs:

```json
{
	"host": "pooled.db.prisma.io",
	"port": 5432,
	"database": "postgres",
	"user": "...",
	"password": "...",
	"ssl": "require"
}
```

The output has a few more fields, such as full connection strings. The ones above are the ones you need next.

### 4. Connect the Postgres node

In n8n, create a new **Postgres** credential. Copy `host`, `database`, `user`, `password`, and `port` from the output into the fields of the same name, and set **SSL** to **Require**.

Add a **Postgres** node, select the new credential, and run a query. Your workflow is now connected to Prisma Postgres.

The output of step 3 contains a password, and n8n keeps node output in the execution history. Delete that execution once you have saved the credential.

You can import these steps as a ready-made workflow from [`examples/1-create-database.json`](examples/1-create-database.json).

## Operations

| Resource   | Operations                    |
| ---------- | ----------------------------- |
| Workspace  | Get, Get Many                 |
| Project    | Create, Get, Get Many, Delete |
| Database   | Create, Get, Get Many, Delete |
| Connection | Create, Get Many, Delete      |

A few things are worth knowing before you use them:

- **Project: Create** and **Database: Create** wait until the database is ready, so the next node can use it right away.
- **Connection: Create** is the operation that returns a password. Other operations leave passwords out of their output.
- **Delete** is permanent. Deleting a project removes all of its databases, and deleting a connection revokes its credentials.
- You can pick projects and databases from a searchable list, or set them with an expression.

### Pooled and direct connections

Every connection comes with two endpoints, and **Endpoint Type** decides which one the `host` field points to.

**Pooled** is the default and the right choice for most workflows. It shares a small number of database connections between many workflow runs, so busy workflows do not exhaust the database.

**Direct** connects straight to the database. Use it for long transactions and for changes to the database structure.

## Store and search embeddings

AI workflows often need to find text that is related to a question. The usual way to do that is to convert text into a list of numbers, called an embedding, and store it next to the text. Texts with similar meaning have similar embeddings, so the database can find the closest matches.

Prisma Postgres supports this through the pgvector extension, and n8n's **Postgres PGVector Store** node works with it out of the box.

### Set up a table

This repository includes a ready-made table definition in [`sql/schema.sql`](sql/schema.sql). Paste it into a **Postgres** node with the **Execute Query** operation and run it once.

It creates a table named `documents` with these columns:

| Column        | What it holds                                           |
| ------------- | ------------------------------------------------------- |
| `id`          | A unique ID for each piece of text                      |
| `content`     | The text                                                |
| `embedding`   | The embedding of that text                              |
| `metadata`    | Extra details as JSON, such as a title, a link, or tags |
| `document_id` | The document the text came from                         |
| `source`      | Where the document came from, such as `notion`          |
| `created_at`  | When the row was added                                  |
| `updated_at`  | When the row last changed                               |

The table fills `document_id` and `source` from the `metadata` column, so you only write them in one place.

### Use it with the PGVector Store node

Add a **Postgres PGVector Store** node and select your Postgres credential. Set **Table Name** to `documents`. Then open **Options > Column Names** and set **Content Column Name** to `content`.

Connect an embeddings node, such as **Embeddings OpenAI** or **Embeddings Google Gemini**, and the node is ready to insert and retrieve documents.

### Match the table to your embedding model

Each embedding model produces lists of a fixed length. The `embedding` column must be set to the same length, or inserts fail with a message such as `expected 1536 dimensions, not 3072`.

The table definition uses 1536, which fits OpenAI's `text-embedding-3-small`. If you use a different model, change `vector(1536)` in the file before you run it.

| Model                                   | Length |
| --------------------------------------- | ------ |
| OpenAI `text-embedding-3-small`         | 1536   |
| OpenAI `text-embedding-3-large`         | 3072   |
| Google `gemini-embedding-001` (default) | 3072   |
| Google `text-embedding-004`             | 768    |

There is one limit to know about. The table definition adds an index that keeps search fast as the table grows, and pgvector can only build that index for lengths up to 2000.

If your model produces 3072, remove the `documents_embedding_idx` statement from the file. Search still works and stays quick for thousands of rows. For larger tables, [`sql/schema-3072.sql`](sql/schema-3072.sql) shows an alternative index.

### Write your own queries

If you prefer SQL over the PGVector Store node, [`sql/queries.sql`](sql/queries.sql) has statements you can paste into a Postgres node. They cover inserting text, replacing a document, and searching.

This query returns the rows that are closest in meaning to a question:

```sql
SELECT id, document_id, source, content, metadata,
       1 - (embedding <=> $1::vector) AS similarity
FROM documents
ORDER BY embedding <=> $1::vector
LIMIT $2;
```

The `$1` and `$2` placeholders are filled from **Options > Query Parameters** in the Postgres node. Enter an expression that returns a list, with the embedding of the question first and the number of results second:

```text
{{ [ JSON.stringify($json.embedding), 5 ] }}
```

## Example workflows

The [`examples`](examples) folder has four workflows you can import. In n8n, open **Workflows > Import from File**, choose a file, and select your own credentials on the nodes.

| File                                                                                                        | What it does                                              |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [`1-create-database.json`](examples/1-create-database.json)                                                 | Creates a project, a database, and a connection           |
| [`2-accounts-inbox-gemini.json`](examples/2-accounts-inbox-gemini.json)                                     | Triages an accounts inbox with Gemini                     |
| [`3-notion-policy-knowledge-base.json`](examples/3-notion-policy-knowledge-base.json)                       | Answers questions about policies stored in Notion         |
| [`4-create-database-and-postgres-credential.json`](examples/4-create-database-and-postgres-credential.json) | Creates a database and saves a Postgres credential for it |

Examples 2 and 3 use Gmail, Notion, Google Gemini, and OpenAI, so you need accounts for those services. Their database steps were tested against Prisma Postgres. The steps that call those services were not, so check them with your own accounts before you rely on them.

### Accounts inbox with Gemini

A shared accounts inbox receives invoices, payment reminders, and vendor questions. Most of them follow patterns that a model can recognize, as long as it knows your vendors and your rules.

This workflow keeps that knowledge in Prisma Postgres. You run the setup part once to create the tables and store a few sample notes, which you then replace with your own vendor notes, payment rules, and past decisions.

After that, every new email goes to an AI agent running on Gemini. The agent looks up the related notes in the database, reads the email and its attachments, and writes down what it found: the type of email, the vendor, the amount, the due date, and a suggested next step.

The workflow saves each suggestion to a table and marks the ones that need a person, for example when money would move or bank details change. It never pays, replies, or deletes anything by itself.

### Notion policy knowledge base

Company policies often live in Notion, where they are easy to write and hard to search by meaning. This workflow copies them into Prisma Postgres so a chat can answer questions about them.

The sync part runs every night or whenever you start it. It reads each policy page from a Notion database and stores the text with OpenAI embeddings. Policies that changed replace their previous version, so the database always matches Notion.

The chat part answers questions with an AI agent on an OpenAI model. The agent searches the stored policies first and names the policy and its link in the answer. You can also ask it to draft a policy change, which it returns for you to review. Nothing is written back to Notion.

## Other ways to connect the Postgres node

The quick start copies the connection details into a Postgres credential by hand. That is the simplest way for a database you keep using. n8n does not let a community node create credentials for other nodes, but there are two ways to automate the step.

### Let a workflow save the credential

n8n has a built-in node, also called **n8n**, that can create credentials. Place it after **Connection > Create** and it saves a Postgres credential for the new database.

Set **Resource** to **Credential**, **Operation** to **Create**, and **Credential Type** to `postgres`. In **Data**, enter:

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

The **n8n** node needs an n8n API key with the `credential:create` scope. The n8n API is not included in every n8n plan.

[`examples/4-create-database-and-postgres-credential.json`](examples/4-create-database-and-postgres-credential.json) contains the whole workflow.

### Use the connection in the same run

Sometimes a workflow creates a database and needs to use it straight away, for example when it sets up one database per customer. For that case, a Postgres credential can read its values from the data that flows through the workflow.

Create a Postgres credential and enter expressions instead of fixed values:

| Field    | Value                  |
| -------- | ---------------------- |
| Host     | `{{ $json.host }}`     |
| Database | `{{ $json.database }}` |
| User     | `{{ $json.user }}`     |
| Password | `{{ $json.password }}` |
| Port     | `{{ $json.port }}`     |
| SSL      | Require                |

A Postgres node with this credential connects to whichever database the incoming item describes. Place it directly after **Connection > Create**, so the item still carries those fields.

## Keeping secrets safe

Your service token is stored in n8n's encrypted credential store. The node sends it only to `https://api.prisma.io` and never includes it in output or error messages.

Database passwords appear in the output of **Connection > Create**, because you need them to connect. n8n keeps that output in the execution history, where anyone with access to the workflow can read it. Delete the execution after you have saved the credential, or turn off saving of successful executions in the workflow settings.

If a password is exposed, delete its connection with **Connection > Delete** and create a new one. The old credentials stop working.

The node only creates, changes, or deletes something when an operation that you selected runs. Loading a dropdown or testing a credential never does.

## Troubleshooting

**Prisma did not accept the service token.** The token is incomplete or has been revoked. Create a new one under **Settings > Service Tokens** in Prisma Console.

**The service token is not allowed to do this.** The project or database belongs to another workspace. Use a token from that workspace.

**Prisma could not find the requested resource.** Check the ID. The project, database, or connection may already be deleted.

**Prisma rate limit reached.** The node sent too many requests in a short time and already retried. Wait a moment and run it again.

**Database is still provisioning after 120 seconds.** The database was created and needs more time. Check it with **Database > Get**.

**The Postgres node cannot connect.** Make sure **SSL** is set to **Require** in the Postgres credential, then check the host, user, and password.

**`expected N dimensions, not M`.** The `embedding` column does not fit your embedding model. See [Match the table to your embedding model](#match-the-table-to-your-embedding-model).

**`type "vector" does not exist`.** The pgvector extension is not enabled in this database. Run `CREATE EXTENSION IF NOT EXISTS vector;` in a Postgres node.

**A dropdown is empty.** The workspace has no projects or databases yet. Create one with **Project > Create**.

## Limitations

- The node covers Prisma Postgres. Other Prisma products, such as Prisma Compute, are not included.
- You cannot read a password again after a connection is created. If you lose it, create a new connection.
- The node signs in with a service token. Signing in with OAuth is not supported.
- Operations that need a valid service token are covered by automated tests against the documented API. They have not been run against a live account yet.

## Compatibility

Tested with n8n 2.47.4. The package has no runtime dependencies.

## Contributing

Issues and pull requests are welcome. To work on the node locally:

```bash
npm install
npm run dev     # starts n8n on http://localhost:5678 with this node
npm test
```

[CONTRIBUTING.md](CONTRIBUTING.md) describes the tests, the release process, and the rules that keep the package eligible for n8n verification.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Prisma Postgres documentation](https://www.prisma.io/docs/postgres)
- [Prisma Management API reference](https://www.prisma.io/docs/rest-api)
- [Connecting to Prisma Postgres](https://www.prisma.io/docs/postgres/database/connecting-to-your-database)

Changes between versions are listed in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
