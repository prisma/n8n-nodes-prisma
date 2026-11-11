import type { IDataObject } from 'n8n-workflow';

export type EndpointType = 'pooled' | 'direct';

const SECRET_KEYS = new Set(['connectionString', 'pass', 'password', 'apiKeys']);

/**
 * Returns a deep copy without connection strings, passwords or API keys.
 * Read operations use this so secrets only leave the node when a user asks for them.
 */
export function redactSecrets<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.map((entry) => redactSecrets(entry)) as unknown as T;
	}
	if (value !== null && typeof value === 'object') {
		const result: IDataObject = {};
		for (const [key, entry] of Object.entries(value as IDataObject)) {
			if (SECRET_KEYS.has(key)) continue;
			result[key] = redactSecrets(entry) as IDataObject;
		}
		return result as unknown as T;
	}
	return value;
}

interface ParsedConnectionString {
	host: string;
	port: number;
	database: string;
	user: string;
	password: string;
}

export function parseConnectionString(
	connectionString: unknown,
): ParsedConnectionString | undefined {
	if (typeof connectionString !== 'string' || connectionString === '') return undefined;
	try {
		const url = new URL(connectionString);
		if (!url.hostname) return undefined;
		return {
			host: url.hostname,
			port: url.port ? Number(url.port) : 5432,
			database: decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres',
			user: decodeURIComponent(url.username),
			password: decodeURIComponent(url.password),
		};
	} catch {
		return undefined;
	}
}

/**
 * Flattens a connection from the Management API into the fields that n8n's Postgres
 * credential asks for (host, port, database, user, password, SSL), plus both connection strings.
 */
export function toConnectionDetails(
	connection: IDataObject,
	endpointType: EndpointType,
): IDataObject {
	const endpoints = (connection.endpoints ?? {}) as Record<string, IDataObject | undefined>;
	const directConnection = (connection.directConnection ?? {}) as IDataObject;
	const database = (connection.database ?? {}) as IDataObject;

	const describe = (type: EndpointType): IDataObject | undefined => {
		const endpoint = endpoints[type];
		if (!endpoint) return undefined;
		const parsed = parseConnectionString(endpoint.connectionString);
		return {
			host: parsed?.host ?? endpoint.host ?? null,
			port: parsed?.port ?? endpoint.port ?? 5432,
			connectionString: endpoint.connectionString ?? null,
		};
	};

	const direct = describe('direct');
	const pooled = describe('pooled');
	const selected = (endpointType === 'pooled' ? (pooled ?? direct) : (direct ?? pooled)) ?? {};
	const parsed =
		parseConnectionString(selected.connectionString) ??
		parseConnectionString(direct?.connectionString) ??
		parseConnectionString(connection.connectionString);

	return {
		id: connection.id ?? null,
		name: connection.name ?? null,
		kind: connection.kind ?? null,
		createdAt: connection.createdAt ?? null,
		databaseId: database.id ?? null,
		databaseName: database.name ?? null,
		endpointType: selected === pooled ? 'pooled' : 'direct',
		host: selected.host ?? directConnection.host ?? connection.host ?? null,
		port: selected.port ?? 5432,
		database: parsed?.database ?? 'postgres',
		user: parsed?.user ?? directConnection.user ?? connection.user ?? null,
		password: parsed?.password ?? directConnection.pass ?? connection.pass ?? null,
		ssl: 'require',
		connectionString: selected.connectionString ?? null,
		direct: direct ?? null,
		pooled: pooled ?? null,
	};
}
