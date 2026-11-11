# @prisma/n8n-nodes-prisma

Create and manage [Prisma Postgres](https://www.prisma.io/postgres) databases from your [n8n](https://n8n.io) workflows.

Many n8n workflows need somewhere to keep data, whether that is the context an AI agent looks up, the documents behind a knowledge base, or the records of a new customer. This community node lets a workflow create that database on its own, so you never have to leave n8n to set one up.

Once the database exists, you work with it through the nodes n8n already has: the Postgres node runs your SQL, and the Postgres PGVector Store node stores and searches embeddings.

## What you can build

**Give an AI workflow a memory.** You can store notes, rules, and past decisions as embeddings in Prisma Postgres, so that when a new email or ticket arrives, your workflow finds the most relevant context and hands it to the model. The [accounts inbox example](#accounts-inbox-with-gemini) works this way.

**Turn your documents into a knowledge base.** A workflow can sync pages from Notion or another source into Prisma Postgres and then let people ask questions in a chat, with answers that come from your own content. The [policy knowledge base example](#notion-policy-knowledge-base) shows how.

**Create a database for every customer or environment.** When someone signs up or a new project starts, a workflow can create a fresh database and pass its connection details on to the next step.

**Spin up a database for a test and remove it afterwards.** A workflow can create a database when it starts, use it for the run, and delete it again at the end.

## How it fits together

Prisma Postgres organizes things in three levels, and the node has one resource for each of them:

- A **project** groups the databases that belong to one app or use case.
- A **database** is a PostgreSQL database inside a project, and because it supports pgvector, it can also store embeddings.
- A **connection** is a set of credentials for one database, made up of a host, a user, and a password.

A typical setup starts with this node creating a project and its database, followed by a connection for that database. You then give the connection details to n8n's Postgres node, and from that point on your workflows read and write data through the Postgres node.

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

On a self-hosted instance, open **Settings > Community Nodes**, select **Install**, and enter `@prisma/n8n-nodes-prisma`. When the install finishes, you can find the node by searching the node panel for **Prisma Postgres**.

n8n Cloud only offers verified community nodes, and this package has not been submitted for verification yet.

## Credentials

The node connects to your Prisma account with a service token, which you create in Prisma Console and store in an n8n credential.

1. Open [Prisma Console](https://console.prisma.io) and select your workspace.
2. Go to **Settings > Service Tokens** and create a token.
3. In n8n, create a **Prisma API** credential and paste the token into **Service Token**.
4. Select **Test** to check that it works.

Because a service token can manage every project in its workspace, you should treat it like a password, and it is a good idea to create a separate workspace if you only want to experiment.

## Quick start

This walkthrough creates a database and connects n8n's Postgres node to it, which takes about five minutes.

### 1. Create a project and a database

Add a **Prisma Postgres** node to a workflow, select the **Project** resource with the **Create** operation, and then enter a name and choose a region close to you. Creating a project also creates its first database, so this one node gives you both.

### 2. Create a connection

Add a second **Prisma Postgres** node after the first, and select the **Connection** resource with the **Create** operation. In the **Database** field, switch to **By ID** and enter the expression below, which picks up the database that the previous node created:

```js
{{ $json.database.id }}
```

### 3. Run the workflow

When you select **Execute workflow**, the second node returns everything a Postgres client needs:

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

The output has a few more fields, such as full connection strings, but the ones above are the ones you need for the next step.

### 4. Connect the Postgres node

In n8n, create a new **Postgres** credential, copy `host`, `database`, `user`, `password`, and `port` from the output into the fields of the same name, and set **SSL** to **Require**. Once you add a **Postgres** node that uses this credential and run a query, your workflow is connected to Prisma Postgres.

Keep in mind that the output of step 3 contains a password and that n8n keeps node output in the execution history, so it is worth deleting that execution once you have saved the credential.

If you would rather start from a ready-made workflow, you can import these steps from the [create a database example](examples/1-create-database.json).

## Operations

| Resource   | Operations                    |
| ---------- | ----------------------------- |
| Workspace  | Get, Get Many                 |
| Project    | Create, Get, Get Many, Delete |
| Database   | Create, Get, Get Many, Delete |
| Connection | Create, Get Many, Delete      |

Both **Project: Create** and **Database: Create** wait until the database is ready, so the next node in your workflow can use it right away. Wherever an operation asks for a project or a database, you can either pick it from a searchable list or set it with an expression.

**Connection: Create** is the only operation that returns a password, and every other operation leaves passwords out of its output.

**Delete** is permanent, so use it with care: deleting a project removes all of its databases, and deleting a connection revokes its credentials.

### Pooled and direct connections

Every connection comes with two endpoints, and the **Endpoint Type** setting decides which one the `host` field points to.

**Pooled** is the default and the right choice for most workflows, because it shares a small number of database connections between many workflow runs and keeps busy workflows from exhausting the database. **Direct** connects straight to the database, which is what you want for long transactions and for changes to the database structure.

## Store and search embeddings

AI workflows often need to find text that is related to a question. The usual way to do that is to convert each piece of text into a list of numbers, called an embedding, and store it next to the text. Since texts with similar meaning have similar embeddings, the database can then find the closest matches for any question.

Prisma Postgres supports this through the pgvector extension, and n8n's **Postgres PGVector Store** node works with it out of the box.

### Set up a table

This repository includes a ready-made table definition in [`sql/schema.sql`](sql/schema.sql), which you can paste into a **Postgres** node with the **Execute Query** operation and run once. It creates a table named `documents` with these columns:

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

The table fills `document_id` and `source` from the `metadata` column, so you only need to write them in one place.

### Use it with the PGVector Store node

To use the table from a workflow, add a **Postgres PGVector Store** node, select your Postgres credential, and set **Table Name** to `documents`. Then open **Options > Column Names** and set **Content Column Name** to `content`, so the node writes to the right column.

After you connect an embeddings node, such as **Embeddings OpenAI** or **Embeddings Google Gemini**, the node is ready to insert and retrieve documents.

### Match the table to your embedding model

Each embedding model produces lists of a fixed length, and the `embedding` column has to be set to that same length. If the two do not match, inserts fail with a message such as `expected 1536 dimensions, not 3072`.

The table definition uses 1536, which fits OpenAI's `text-embedding-3-small`, so if you use a different model you need to change `vector(1536)` in the file before you run it.

| Model                                   | Length |
| --------------------------------------- | ------ |
| OpenAI `text-embedding-3-small`         | 1536   |
| OpenAI `text-embedding-3-large`         | 3072   |
| Google `gemini-embedding-001` (default) | 3072   |
| Google `text-embedding-004`             | 768    |

There is one limit to know about here. The table definition adds an index that keeps search fast as the table grows, and pgvector can only build that index for lengths up to 2000.

If your model produces 3072, remove the `documents_embedding_idx` statement from the file before you run it. Search still works without the index and stays quick for thousands of rows, and for larger tables [`sql/schema-3072.sql`](sql/schema-3072.sql) shows an alternative index.

### Write your own queries

If you prefer SQL over the PGVector Store node, [`sql/queries.sql`](sql/queries.sql) has statements for inserting text, replacing a document, and searching, all of which you can paste into a Postgres node.

The following query, for example, returns the rows that are closest in meaning to a question:

```sql
SELECT
  id,
  document_id,
  source,
  content,
  metadata,
  1 - (embedding <=> $1::vector) AS similarity
FROM documents
ORDER BY embedding <=> $1::vector
LIMIT $2;
```

The `$1` and `$2` placeholders are filled from **Options > Query Parameters** in the Postgres node, where you enter an expression that returns a list with the embedding of the question first and the number of results second:

```js
{{ [JSON.stringify($json.embedding), 5] }}
```

## Example workflows

The [`examples`](examples) folder has four workflows you can import. In n8n, open **Workflows > Import from File**, choose a file, and then select your own credentials on the nodes.

| Workflow                                                                            | What it does                                              |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [Create a database](examples/1-create-database.json)                                | Creates a project, a database, and a connection           |
| [Accounts inbox](examples/2-accounts-inbox-gemini.json)                             | Triages an accounts inbox with Gemini                     |
| [Policy knowledge base](examples/3-notion-policy-knowledge-base.json)               | Answers questions about policies stored in Notion         |
| [Database with credential](examples/4-create-database-and-postgres-credential.json) | Creates a database and saves a Postgres credential for it |

The accounts inbox and the policy knowledge base use Gmail, Notion, Google Gemini, and OpenAI, so you need accounts for those services. Their database steps were tested against Prisma Postgres, but the steps that call those services were not, so please check them with your own accounts before you rely on them.

### Accounts inbox with Gemini

A shared accounts inbox receives invoices, payment reminders, and vendor questions, and most of them follow patterns that a model can recognize as long as it knows your vendors and your rules.

This workflow keeps that knowledge in Prisma Postgres. You run the setup part once to create the tables and store a few sample notes, which you then replace with your own vendor notes, payment rules, and past decisions.

From then on, every new email goes to an AI agent running on Gemini. The agent looks up the related notes in the database, reads the email together with its attachments, and writes down what it found, including the type of email, the vendor, the amount, the due date, and a suggested next step.

The workflow saves each suggestion to a table and marks the ones that need a person, for example when money would move or bank details would change. It never pays, replies, or deletes anything by itself.

### Notion policy knowledge base

Company policies often live in Notion, where they are easy to write but hard to search by meaning. This workflow copies them into Prisma Postgres so that a chat can answer questions about them.

The sync part runs every night, or whenever you start it, and reads each policy page from a Notion database before storing its text with OpenAI embeddings. A policy that has changed replaces its previous version, so the database always matches what is in Notion.

The chat part answers questions with an AI agent on an OpenAI model, which searches the stored policies first and names the policy and its link in the answer. You can also ask it to draft a policy change, which it returns for you to review, and nothing is ever written back to Notion.

## Other ways to connect the Postgres node

The quick start copies the connection details into a Postgres credential by hand, which is the simplest way for a database you keep using. Although n8n does not let a community node create credentials for other nodes, there are two ways to automate that step.

### Let a workflow save the credential

n8n has a built-in node, also called **n8n**, that can create credentials. When you place it after **Connection > Create**, it saves a Postgres credential for the new database.

To configure it, set **Resource** to **Credential**, **Operation** to **Create**, and **Credential Type** to `postgres`, and then enter the following in **Data**:

```js
{{
  JSON.stringify({
    host: $json.host,
    port: $json.port,
    database: $json.database,
    user: $json.user,
    password: $json.password,
    ssl: "require",
    allowUnauthorizedCerts: false,
    sshTunnel: false,
    maxConnections: 10,
  })
}}
```

The **n8n** node needs an n8n API key with the `credential:create` scope, and the n8n API is not included in every n8n plan. You can import the whole workflow from the [database with credential example](examples/4-create-database-and-postgres-credential.json).

### Use the connection in the same run

Sometimes a workflow creates a database and needs to use it straight away, for example when it sets up one database per customer. For that case, a Postgres credential can read its values from the data that flows through the workflow, which you set up by entering expressions instead of fixed values:

| Field    | Value                  |
| -------- | ---------------------- |
| Host     | `{{ $json.host }}`     |
| Database | `{{ $json.database }}` |
| User     | `{{ $json.user }}`     |
| Password | `{{ $json.password }}` |
| Port     | `{{ $json.port }}`     |
| SSL      | Require                |

A Postgres node with this credential connects to whichever database the incoming item describes, so place it directly after **Connection > Create**, where the item still carries those fields.

## Keeping secrets safe

Your service token is stored in n8n's encrypted credential store, and the node sends it only to `https://api.prisma.io` and never includes it in output or error messages.

Database passwords appear in the output of **Connection > Create**, because you need them to connect. Since n8n keeps that output in the execution history, where anyone with access to the workflow can read it, you should delete the execution after you have saved the credential or turn off saving of successful executions in the workflow settings.

If a password is ever exposed, delete its connection with **Connection > Delete** and create a new one, at which point the old credentials stop working.

The node only creates, changes, or deletes something when an operation that you selected runs, which means that loading a dropdown or testing a credential never does.

## Troubleshooting

The table below lists the messages you are most likely to run into, along with what causes each one and how to resolve it.

| What you see                                     | What to do                                                                                                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma did not accept the service token          | The token is incomplete or has been revoked, so create a new one under **Settings > Service Tokens** in Prisma Console and update the credential.                                                       |
| The service token is not allowed to do this      | The project or database belongs to another workspace, which means you need a token from that workspace to manage it.                                                                                    |
| Prisma could not find the requested resource     | Check the ID you entered, because the project, database, or connection may already have been deleted.                                                                                                   |
| Prisma rate limit reached                        | The node sent too many requests in a short time and has already retried, so wait a moment before you run it again.                                                                                      |
| Database is still provisioning after 120 seconds | The database was created and needs more time to become ready, so you can either check its status with **Database > Get** or turn off **Wait Until Ready** to let the workflow continue without waiting. |
| The Postgres node cannot connect                 | Make sure **SSL** is set to **Require** in the Postgres credential, and then check the host, user, and password.                                                                                        |
| `expected N dimensions, not M`                   | The `embedding` column does not fit your embedding model, so adjust it as described in [Match the table to your embedding model](#match-the-table-to-your-embedding-model).                             |
| `type "vector" does not exist`                   | The pgvector extension is not enabled in this database yet, which you can fix by running `CREATE EXTENSION IF NOT EXISTS vector;` in a Postgres node.                                                   |
| A dropdown is empty                              | The workspace has no projects or databases yet, so create one with **Project > Create** first.                                                                                                          |

## Limitations

- The node covers Prisma Postgres, so other Prisma products such as Prisma Compute are not included.
- A password cannot be read again after its connection is created, which means that if you lose it you need to create a new connection.
- The node signs in with a service token, and signing in with OAuth is not supported.
- Operations that need a valid service token are covered by automated tests against the documented API, but they have not been run against a live account yet.

## Compatibility

The node was tested with n8n 2.47.4, and the package has no runtime dependencies.

## Contributing

Issues and pull requests are welcome. To work on the node locally, install the dependencies and start n8n with the node loaded:

```bash
# Install dependencies
npm install

# Start n8n on http://localhost:5678 with this node loaded
npm run dev

# Run the unit tests
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
