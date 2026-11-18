# Changelog

## 0.1.3

- The package author is now the maintainer who submits the node to n8n for verification, so that n8n can confirm ownership of the package. The node itself is unchanged.

## 0.1.2

- The package author email is now an address that receives mail, which n8n needs to confirm ownership of the package. The node itself is unchanged.

## 0.1.1

- **Project: Create** and **Database: Create** now return only when the new database accepts direct connections. Before this fix, a query sent over a direct connection right after creating a database could fail with "Failed to connect to upstream database". Both operations now take at least 5 seconds while **Wait Until Ready** is on.

## 0.1.0

The package is published as `@prisma/n8n-nodes-prisma`.

This is the first release of the Prisma Postgres node for n8n.

- The **Prisma Postgres** node can list workspaces, and it can create, read, list, and delete projects, databases, and connections.
- The **Prisma API** credential signs in with a workspace service token.
- The repository includes a table definition for pgvector, example queries, and four example workflows that you can import into n8n.
