import type { IDataObject } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
	parseConnectionString,
	redactSecrets,
	toConnectionDetails,
} from '../nodes/PrismaPostgres/connection';
import { apiConnection, apiDatabase, SECRET } from './helpers';

describe('redactSecrets', () => {
	it('removes passwords, connection strings and API keys at any depth', () => {
		const database: IDataObject = {
			...apiDatabase(),
			apiKeys: [apiConnection()],
			connectionString: `x:${SECRET}`,
		};
		const redacted = redactSecrets(database);
		expect(JSON.stringify(redacted)).not.toContain(SECRET);
		expect(redacted).not.toHaveProperty('apiKeys');
		expect(redacted.id).toBe('db_1');
		expect((redacted.connections as Array<Record<string, unknown>>)[0].endpoints).toEqual({
			direct: { host: 'db.prisma.io', port: 5432 },
			pooled: { host: 'pooled.db.prisma.io', port: 5432 },
		});
	});

	it('does not change the input', () => {
		const connection = apiConnection();
		redactSecrets(connection);
		expect(connection.pass).toBe(SECRET);
	});
});

describe('parseConnectionString', () => {
	it('decodes special characters', () => {
		expect(
			parseConnectionString('postgres://us%40er:p%2Fw%3A1@h.example:6543/my%20db?sslmode=require'),
		).toEqual({
			host: 'h.example',
			port: 6543,
			database: 'my db',
			user: 'us@er',
			password: 'p/w:1',
		});
	});

	it('defaults the port and database', () => {
		expect(parseConnectionString('postgresql://u:p@h.example')).toMatchObject({
			port: 5432,
			database: 'postgres',
		});
	});

	it('returns undefined for unusable input', () => {
		expect(parseConnectionString(undefined)).toBeUndefined();
		expect(parseConnectionString('')).toBeUndefined();
		expect(parseConnectionString('not a url')).toBeUndefined();
	});
});

describe('toConnectionDetails', () => {
	it('maps to the fields of the n8n Postgres credential, pooled by default', () => {
		expect(toConnectionDetails(apiConnection(), 'pooled')).toEqual({
			id: 'con_1',
			name: 'n8n',
			kind: 'postgres',
			createdAt: '2026-11-11T10:00:00.000Z',
			databaseId: 'db_1',
			databaseName: 'main',
			endpointType: 'pooled',
			host: 'pooled.db.prisma.io',
			port: 5432,
			database: 'postgres',
			user: 'user_a',
			password: SECRET,
			ssl: 'require',
			connectionString: `postgres://user_a:${SECRET}@pooled.db.prisma.io:5432/postgres?sslmode=require`,
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
		});
	});

	it('selects the direct endpoint on request', () => {
		const details = toConnectionDetails(apiConnection(), 'direct');
		expect(details.endpointType).toBe('direct');
		expect(details.host).toBe('db.prisma.io');
	});

	it('falls back to the direct endpoint when there is no pooled one', () => {
		const connection = apiConnection();
		delete (connection.endpoints as Record<string, unknown>).pooled;
		const details = toConnectionDetails(connection, 'pooled');
		expect(details.endpointType).toBe('direct');
		expect(details.pooled).toBeNull();
	});

	it('falls back to directConnection when no connection string is present', () => {
		const connection = redactSecrets(apiConnection());
		connection.directConnection = { host: 'db.prisma.io', user: 'user_a', pass: 'pw' };
		const details = toConnectionDetails(connection, 'direct');
		expect(details).toMatchObject({
			host: 'db.prisma.io',
			user: 'user_a',
			password: 'pw',
			connectionString: null,
		});
	});
});
