import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { vi } from 'vitest';

export interface MockResponse {
	statusCode: number;
	body?: unknown;
	headers?: IDataObject;
}

export interface MockContext {
	context: IExecuteFunctions;
	http: ReturnType<typeof vi.fn>;
	/** Every request the node sent, in order. */
	requests: () => Array<{ method: string; url: string; body?: IDataObject; qs?: IDataObject }>;
}

/**
 * A minimal stand-in for n8n's execute context. `params` holds one parameter set per input item.
 * `responses` are returned by the HTTP helper in order.
 */
export function createContext(
	params: IDataObject[],
	responses: MockResponse[],
	settings: { continueOnFail?: boolean } = {},
): MockContext {
	const queue = [...responses];
	const http = vi.fn(async () => {
		const next = queue.shift();
		if (!next) throw new Error('Unexpected request: no mock response left');
		return next;
	});

	const context = {
		getNode: () => ({
			id: 'node-1',
			name: 'Prisma Postgres',
			type: 'n8n-nodes-prisma.prismaPostgres',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
		getInputData: () => params.map(() => ({ json: {} })) as INodeExecutionData[],
		getNodeParameter: (
			name: string,
			itemIndex: number,
			fallback?: unknown,
			options?: { extractValue?: boolean },
		) => {
			const value = params[itemIndex]?.[name];
			if (value === undefined) {
				if (fallback !== undefined) return fallback;
				throw new Error(`Parameter "${name}" is not set for item ${itemIndex}`);
			}
			if (
				options?.extractValue &&
				value !== null &&
				typeof value === 'object' &&
				'value' in value
			) {
				return (value as IDataObject).value;
			}
			return value;
		},
		continueOnFail: () => settings.continueOnFail === true,
		helpers: {
			httpRequestWithAuthentication: http,
			returnJsonArray: (data: IDataObject | IDataObject[]) =>
				(Array.isArray(data) ? data : [data]).map((json) => ({ json })),
			constructExecutionMetaData: (
				items: INodeExecutionData[],
				meta: { itemData: { item: number } },
			) => items.map((item) => ({ ...item, pairedItem: meta.itemData })),
		},
	} as unknown as IExecuteFunctions;

	return {
		context,
		http,
		requests: () =>
			http.mock.calls.map((call) => {
				const options = (call as unknown[])[1] as IDataObject;
				return {
					method: options.method as string,
					url: options.url as string,
					body: options.body as IDataObject | undefined,
					qs: options.qs as IDataObject | undefined,
				};
			}),
	};
}

export const rl = (value: string) => ({ __rl: true, mode: 'id', value });

export const SECRET = 'sup3r-s3cret-pw';

export function apiConnection(id = 'con_1'): IDataObject {
	return {
		id,
		type: 'connection',
		url: `https://api.prisma.io/v1/connections/${id}`,
		name: 'n8n',
		createdAt: '2026-11-11T10:00:00.000Z',
		kind: 'postgres',
		endpoints: {
			direct: {
				host: 'db.prisma.io',
				port: 5432,
				connectionString: `postgres://user_a:${SECRET}@db.prisma.io:5432/postgres?sslmode=require`,
			},
			pooled: {
				host: 'pooled.db.prisma.io',
				port: 5432,
				connectionString: `postgres://user_a:${SECRET}@pooled.db.prisma.io:5432/postgres?sslmode=require`,
			},
		},
		connectionString: `postgres://user_a:${SECRET}@db.prisma.io:5432/postgres?sslmode=require`,
		directConnection: { host: 'db.prisma.io', user: 'user_a', pass: SECRET },
		database: { id: 'db_1', url: 'https://api.prisma.io/v1/databases/db_1', name: 'main' },
		host: 'db.prisma.io',
		user: 'user_a',
		pass: SECRET,
	};
}

export function apiDatabase(status = 'ready'): IDataObject {
	return {
		id: 'db_1',
		type: 'database',
		name: 'main',
		status,
		createdAt: '2026-11-11T10:00:00.000Z',
		isDefault: false,
		defaultConnectionId: 'con_1',
		connections: [apiConnection()],
		project: { id: 'proj_1', name: 'inbox' },
		region: { id: 'eu-central-1', name: 'Frankfurt' },
	};
}
