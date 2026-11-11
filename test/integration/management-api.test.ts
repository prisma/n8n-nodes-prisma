/* eslint-disable @n8n/community-nodes/no-restricted-globals, no-console --
   Development-only test. It is not part of the published package and needs Node.js APIs. */
/**
 * End-to-end test against the real Prisma Management API. It drives the node's own execute
 * method, so it covers request construction, auth, response mapping and cleanup.
 *
 *   PRISMA_SERVICE_TOKEN="..." npm run test:integration
 *
 * It creates one project with two databases and deletes them again. Use a service token
 * from a workspace that is meant for testing. Without the variable the suite is skipped.
 */
import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { PrismaPostgres } from '../../nodes/PrismaPostgres/PrismaPostgres.node';

const token = process.env.PRISMA_SERVICE_TOKEN;
const node = new PrismaPostgres();
const stamp = new Date()
	.toISOString()
	.replace(/[-:.TZ]/g, '')
	.slice(0, 14);

async function execute(parameters: IDataObject): Promise<IDataObject[]> {
	const context = {
		getNode: () => ({
			id: '1',
			name: 'Prisma Postgres',
			type: 'prismaPostgres',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
		getInputData: () => [{ json: {} }],
		getNodeParameter: (
			name: string,
			_i: number,
			fallback?: unknown,
			options?: { extractValue?: boolean },
		) => {
			const value = parameters[name];
			if (value === undefined) {
				if (fallback !== undefined) return fallback;
				throw new Error(`Parameter "${name}" is not set`);
			}
			if (options?.extractValue && value !== null && typeof value === 'object')
				return (value as IDataObject).value;
			return value;
		},
		continueOnFail: () => false,
		helpers: {
			// Mirrors what n8n does with the credential's `authenticate` block.
			httpRequestWithAuthentication: async (_credential: string, options: IDataObject) => {
				const url = new URL(options.url as string);
				for (const [key, value] of Object.entries((options.qs ?? {}) as IDataObject)) {
					url.searchParams.set(key, String(value));
				}
				const response = await fetch(url, {
					method: options.method as string,
					headers: {
						Authorization: `Bearer ${token}`,
						Accept: 'application/json',
						...(options.body ? { 'Content-Type': 'application/json' } : {}),
					},
					body: options.body ? JSON.stringify(options.body) : undefined,
				});
				const text = await response.text();
				let body: unknown = text;
				try {
					body = text ? JSON.parse(text) : undefined;
				} catch {
					// keep the raw text
				}
				return {
					statusCode: response.status,
					headers: { 'retry-after': response.headers.get('retry-after') ?? undefined },
					body,
				};
			},
			returnJsonArray: (data: IDataObject | IDataObject[]) =>
				(Array.isArray(data) ? data : [data]).map((json) => ({ json })),
			constructExecutionMetaData: (items: INodeExecutionData[]) => items,
		},
	} as unknown as IExecuteFunctions;

	const [output] = await node.execute.call(context);
	return output.map((item) => item.json);
}

const rl = (value: string) => ({ __rl: true, mode: 'id', value });

async function query(connection: IDataObject, sql: string): Promise<IDataObject[]> {
	const client = new Client({
		host: connection.host as string,
		port: connection.port as number,
		database: connection.database as string,
		user: connection.user as string,
		password: connection.password as string,
		ssl: true,
	});
	await client.connect();
	try {
		return (await client.query(sql)).rows;
	} finally {
		await client.end();
	}
}

describe.skipIf(!token)('Prisma Management API, live', () => {
	let projectId: string | undefined;
	let databaseId: string | undefined;
	let connection: IDataObject | undefined;

	afterAll(async () => {
		// Deleting the project removes its databases and connections as well.
		if (projectId) {
			await execute({ resource: 'project', operation: 'delete', projectId: rl(projectId) }).catch(
				(error) => {
					console.error(
						`Cleanup did not complete. Delete project ${projectId} manually: ${(error as Error).message}`,
					);
				},
			);
		}
	});

	it('authenticates and lists workspaces', async () => {
		const workspaces = await execute({
			resource: 'workspace',
			operation: 'getAll',
			returnAll: true,
		});
		expect(workspaces.length).toBeGreaterThan(0);
		expect(workspaces[0]).toHaveProperty('id');
	});

	it('creates a project with a default database and no secrets in the output', async () => {
		const [project] = await execute({
			resource: 'project',
			operation: 'create',
			name: `n8n-nodes-prisma-test-${stamp}`,
			region: 'us-east-1',
			options: {},
		});
		projectId = project.id as string;
		expect(projectId).toBeTruthy();
		expect(JSON.stringify(project)).not.toMatch(/postgres(ql)?:\/\//);
		expect((project.database as IDataObject).status).toBe('ready');
	});

	it('gets and lists the project', async () => {
		const [project] = await execute({
			resource: 'project',
			operation: 'get',
			projectId: rl(projectId!),
		});
		expect(project.id).toBe(projectId);
		const projects = await execute({ resource: 'project', operation: 'getAll', returnAll: true });
		expect(projects.map((entry) => entry.id)).toContain(projectId);
	});

	it('creates a second database and waits until it is ready', async () => {
		const [database] = await execute({
			resource: 'database',
			operation: 'create',
			projectId: rl(projectId!),
			name: 'kb',
			region: 'inherit',
			options: {},
		});
		databaseId = database.id as string;
		expect(database.status).toBe('ready');
		expect(JSON.stringify(database)).not.toMatch(/postgres(ql)?:\/\//);
	});

	it('gets the database and lists the databases of the project', async () => {
		const [database] = await execute({
			resource: 'database',
			operation: 'get',
			databaseId: rl(databaseId!),
		});
		expect(database.id).toBe(databaseId);
		const databases = await execute({
			resource: 'database',
			operation: 'getAll',
			returnAll: true,
			filters: { projectId },
		});
		expect(databases).toHaveLength(2);
	});

	it('creates a connection whose fields work with a Postgres client, pooled and direct', async () => {
		[connection] = await execute({
			resource: 'connection',
			operation: 'create',
			databaseId: rl(databaseId!),
			name: 'n8n-integration-test',
			endpointType: 'pooled',
		});
		expect(connection.password).toBeTruthy();
		expect(await query(connection, 'SELECT 1 AS ok')).toEqual([{ ok: 1 }]);

		const direct = connection.direct as IDataObject;
		expect(
			await query({ ...connection, host: direct.host, port: direct.port }, 'SELECT 1 AS ok'),
		).toEqual([{ ok: 1 }]);
	});

	it('supports pgvector on the new database', async () => {
		const direct = { ...connection!, ...(connection!.direct as IDataObject) };
		await query(direct, 'CREATE EXTENSION IF NOT EXISTS vector');
		const rows = await query(direct, "SELECT '[1,0,0]'::vector <=> '[0,1,0]'::vector AS distance");
		expect(Number(rows[0].distance)).toBe(1);
	});

	it('lists connection metadata without secrets', async () => {
		const connections = await execute({
			resource: 'connection',
			operation: 'getAll',
			returnAll: true,
			filters: { databaseId },
		});
		expect(connections.map((entry) => entry.id)).toContain(connection!.id);
		expect(JSON.stringify(connections)).not.toContain(connection!.password as string);
	});

	it('deletes the connection and the database', async () => {
		expect(
			await execute({ resource: 'connection', operation: 'delete', connectionId: connection!.id }),
		).toEqual([{ deleted: true }]);
		expect(
			await execute({ resource: 'database', operation: 'delete', databaseId: rl(databaseId!) }),
		).toEqual([{ deleted: true }]);
	});
});
