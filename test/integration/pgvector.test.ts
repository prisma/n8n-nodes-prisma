/* eslint-disable @n8n/community-nodes/no-restricted-globals, @n8n/community-nodes/no-restricted-imports --
   Development-only test. It is not part of the published package and needs Node.js APIs. */
/**
 * Runs sql/schema.sql and every statement of sql/queries.sql against a real database.
 *
 *   DATABASE_URL="postgres://..." npm run test:integration
 *
 * Use a scratch database: the test drops and recreates the documents table.
 * `npx create-db` gives you a temporary Prisma Postgres database without an account.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
const sqlDir = join(__dirname, '..', '..', 'sql');
const DIMENSIONS = 1536;

/** A unit vector that points mostly along one axis, so nearest neighbours are predictable. */
function embedding(axis: number, noiseAxis = 0, noise = 0): string {
	const values = new Array<number>(DIMENSIONS).fill(0);
	values[axis] = 1;
	values[noiseAxis] += noise;
	return JSON.stringify(values);
}

function statements(file: string): string[] {
	return readFileSync(join(sqlDir, file), 'utf8')
		.split('\n')
		.filter((line) => !line.trim().startsWith('--'))
		.join('\n')
		.split(/;\s*\n/)
		.map((statement) => statement.trim())
		.filter((statement) => statement !== '');
}

describe.skipIf(!databaseUrl)('pgvector reference schema on a real database', () => {
	let client: Client;
	const [insert, deleteByDocument, search, filteredSearch, update] = statements('queries.sql');

	beforeAll(async () => {
		client = new Client({ connectionString: databaseUrl });
		await client.connect();
		await client.query('DROP TABLE IF EXISTS documents');
		await client.query(readFileSync(join(sqlDir, 'schema.sql'), 'utf8'));
	});

	afterAll(async () => {
		await client?.query('DROP TABLE IF EXISTS documents');
		await client?.end();
	});

	it('has pgvector installed', async () => {
		const { rows } = await client.query(
			"SELECT extversion FROM pg_extension WHERE extname = 'vector'",
		);
		expect(rows).toHaveLength(1);
	});

	it('is safe to apply twice', async () => {
		await client.query(readFileSync(join(sqlDir, 'schema.sql'), 'utf8'));
	});

	it('inserts chunks and fills document_id and source from metadata', async () => {
		const rows = [
			[
				'Acme invoices are due in 30 days.',
				{ document_id: 'vendor-acme', source: 'email', vendor: 'Acme' },
				embedding(0),
			],
			[
				'Acme changed bank details in March.',
				{ document_id: 'vendor-acme', source: 'email', vendor: 'Acme' },
				embedding(0, 1, 0.3),
			],
			[
				'Travel expenses need a receipt.',
				{ document_id: 'policy-travel', source: 'notion', vendor: null },
				embedding(5),
			],
		] as const;
		for (const [content, metadata, vector] of rows) {
			const result = await client.query(insert, [content, JSON.stringify(metadata), vector]);
			expect(result.rows[0].document_id).toBe(metadata.document_id);
			expect(result.rows[0].source).toBe(metadata.source);
		}
	});

	it('returns the nearest chunks first with a similarity score', async () => {
		const { rows } = await client.query(search, [embedding(0), 2]);
		expect(rows.map((row) => row.content)).toEqual([
			'Acme invoices are due in 30 days.',
			'Acme changed bank details in March.',
		]);
		expect(Number(rows[0].similarity)).toBeCloseTo(1, 5);
		expect(Number(rows[1].similarity)).toBeLessThan(1);
	});

	it('filters by metadata and minimum similarity', async () => {
		const { rows } = await client.query(filteredSearch, [
			embedding(5),
			JSON.stringify({ source: 'notion' }),
			0.5,
			10,
		]);
		expect(rows.map((row) => row.document_id)).toEqual(['policy-travel']);

		const none = await client.query(filteredSearch, [
			embedding(0),
			JSON.stringify({ source: 'notion' }),
			0.5,
			10,
		]);
		expect(none.rows).toHaveLength(0);
	});

	it('rejects an embedding of the wrong size', async () => {
		await expect(
			client.query(insert, ['short', '{}', JSON.stringify([0.1, 0.2, 0.3])]),
		).rejects.toThrow(/expected 1536 dimensions/);
	});

	it('updates a chunk and moves updated_at forward', async () => {
		const before = await client.query(
			'SELECT id, updated_at FROM documents WHERE document_id = $1',
			['policy-travel'],
		);
		const { rows } = await client.query(update, [
			before.rows[0].id,
			'Travel expenses need a receipt over 20 EUR.',
			embedding(5),
		]);
		expect(new Date(rows[0].updated_at).getTime()).toBeGreaterThan(
			new Date(before.rows[0].updated_at).getTime(),
		);
	});

	it('deletes every chunk of one source document', async () => {
		const result = await client.query(deleteByDocument, ['vendor-acme']);
		expect(result.rowCount).toBe(2);
	});

	it('uses the HNSW index for similarity search', async () => {
		await client.query('SET enable_seqscan = off');
		const { rows } = await client.query(
			`EXPLAIN SELECT id FROM documents ORDER BY embedding <=> '${embedding(0)}'::vector LIMIT 5`,
		);
		await client.query('RESET enable_seqscan');
		expect(rows.map((row) => row['QUERY PLAN']).join('\n')).toContain('documents_embedding_idx');
	});
});
