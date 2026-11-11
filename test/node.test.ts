import type { IDataObject, ILoadOptionsFunctions } from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('n8n-workflow', async (importOriginal) => ({
	...(await importOriginal<typeof import('n8n-workflow')>()),
	sleep: vi.fn(async () => {}),
}));

import { PrismaPostgres } from '../nodes/PrismaPostgres/PrismaPostgres.node';
import type { MockResponse } from './helpers';
import { apiConnection, apiDatabase, createContext, rl, SECRET } from './helpers';

const node = new PrismaPostgres();
const run = async (params: IDataObject[], responses: MockResponse[], settings = {}) => {
	const mock = createContext(params, responses, settings);
	const [output] = await node.execute.call(mock.context);
	return { output, ...mock };
};
const ok = (data: unknown, statusCode = 200): MockResponse => ({ statusCode, body: { data } });
const list = (data: unknown[], nextCursor: string | null = null): MockResponse => ({
	statusCode: 200,
	body: { data, pagination: { nextCursor, hasMore: nextCursor !== null } },
});

beforeEach(() => vi.mocked(sleep).mockClear());

describe('node description', () => {
	it('exposes every resource and operation', () => {
		const operations = node.description.properties
			.filter((property) => property.name === 'operation')
			.flatMap((property) =>
				(property.options as Array<{ value: string }>).map(
					(option) => `${property.displayOptions?.show?.resource?.[0]}:${option.value}`,
				),
			);
		expect(operations.sort()).toEqual(
			[
				'workspace:get',
				'workspace:getAll',
				'project:create',
				'project:delete',
				'project:get',
				'project:getAll',
				'database:create',
				'database:delete',
				'database:get',
				'database:getAll',
				'connection:create',
				'connection:delete',
				'connection:getAll',
			].sort(),
		);
	});

	it('requires the Prisma credential', () => {
		expect(node.description.credentials).toEqual([{ name: 'prismaApi', required: true }]);
	});
});

describe('workspace and project reads', () => {
	it('gets many workspaces with a limit', async () => {
		const { output, requests } = await run(
			[{ resource: 'workspace', operation: 'getAll', returnAll: false, limit: 2 }],
			[list([{ id: 'wksp_1' }, { id: 'wksp_2' }], 'next')],
		);
		expect(output.map((item) => item.json.id)).toEqual(['wksp_1', 'wksp_2']);
		expect(requests()).toEqual([
			{
				method: 'GET',
				url: 'https://api.prisma.io/v1/workspaces',
				body: undefined,
				qs: { limit: 2 },
			},
		]);
	});

	it('gets a project by ID from a resource locator', async () => {
		const { output, requests } = await run(
			[{ resource: 'project', operation: 'get', projectId: rl('proj_1') }],
			[ok({ id: 'proj_1', name: 'inbox' })],
		);
		expect(output[0].json).toEqual({ id: 'proj_1', name: 'inbox' });
		expect(requests()[0].url).toBe('https://api.prisma.io/v1/projects/proj_1');
	});

	it('returns all projects across pages', async () => {
		const { output } = await run(
			[{ resource: 'project', operation: 'getAll', returnAll: true }],
			[list([{ id: 'a' }], 'c1'), list([{ id: 'b' }])],
		);
		expect(output.map((item) => item.json.id)).toEqual(['a', 'b']);
	});

	it('rejects an empty locator before calling the API', async () => {
		const mock = createContext(
			[{ resource: 'project', operation: 'get', projectId: rl('  ') }],
			[],
		);
		await expect(node.execute.call(mock.context)).rejects.toThrow('No project was provided');
		expect(mock.http).not.toHaveBeenCalled();
	});
});

describe('project create', () => {
	const project = () => ({
		id: 'proj_1',
		name: 'inbox',
		database: { ...apiDatabase(), apiKeys: [apiConnection()] },
	});

	it('sends name, region and workspace, and hides secrets by default', async () => {
		const { output, requests } = await run(
			[
				{
					resource: 'project',
					operation: 'create',
					name: ' inbox ',
					region: 'eu-central-1',
					options: { workspaceId: 'wksp_1' },
				},
			],
			[ok(project(), 201)],
		);
		expect(requests()[0]).toMatchObject({
			method: 'POST',
			url: 'https://api.prisma.io/v1/projects',
			body: { name: 'inbox', region: 'eu-central-1', workspaceId: 'wksp_1', createDatabase: true },
		});
		expect(JSON.stringify(output)).not.toContain(SECRET);
		expect((output[0].json.database as IDataObject).connection).toBeUndefined();
	});

	it('adds flat connection details when asked', async () => {
		const { output } = await run(
			[
				{
					resource: 'project',
					operation: 'create',
					name: 'inbox',
					region: 'us-east-1',
					options: { includeConnectionDetails: true, endpointType: 'direct' },
				},
			],
			[ok(project(), 201)],
		);
		const database = output[0].json.database as IDataObject;
		expect(database.connection).toMatchObject({
			host: 'db.prisma.io',
			port: 5432,
			database: 'postgres',
			user: 'user_a',
			password: SECRET,
			ssl: 'require',
			databaseId: 'db_1',
		});
		// The raw API copies stay redacted. Secrets appear only in the `connection` object.
		expect(JSON.stringify({ ...database, connection: undefined })).not.toContain(SECRET);
	});

	it('skips the database when createDatabase is off', async () => {
		const { output, requests } = await run(
			[
				{
					resource: 'project',
					operation: 'create',
					name: 'empty',
					region: '',
					options: { createDatabase: false },
				},
			],
			[ok({ id: 'proj_2', name: 'empty', database: null }, 201)],
		);
		expect(requests()[0].body).toEqual({ name: 'empty', createDatabase: false });
		expect(output[0].json).toEqual({ id: 'proj_2', name: 'empty', database: null });
	});

	it('requires a name', async () => {
		const mock = createContext(
			[{ resource: 'project', operation: 'create', name: '  ', region: '' }],
			[],
		);
		await expect(node.execute.call(mock.context)).rejects.toThrow('The project needs a name');
	});
});

describe('database create', () => {
	const params = (options: IDataObject = {}) => ({
		resource: 'database',
		operation: 'create',
		projectId: rl('proj_1'),
		name: 'kb',
		region: 'inherit',
		options,
	});

	it('creates in the selected project and hides secrets by default', async () => {
		const { output, requests } = await run([params()], [ok(apiDatabase(), 201)]);
		expect(requests()).toEqual([
			{
				method: 'POST',
				url: 'https://api.prisma.io/v1/databases',
				body: { projectId: 'proj_1', name: 'kb', region: 'inherit' },
				qs: undefined,
			},
		]);
		expect(output[0].json.id).toBe('db_1');
		expect(JSON.stringify(output)).not.toContain(SECRET);
	});

	it('polls until the database is ready and keeps the connection details from the create response', async () => {
		const { output, requests } = await run(
			[params({ includeConnectionDetails: true })],
			[
				ok(apiDatabase('provisioning'), 201),
				ok({ id: 'db_1', status: 'provisioning' }),
				ok({ id: 'db_1', status: 'ready' }),
			],
		);
		expect(requests().map((request) => `${request.method} ${request.url}`)).toEqual([
			'POST https://api.prisma.io/v1/databases',
			'GET https://api.prisma.io/v1/databases/db_1',
			'GET https://api.prisma.io/v1/databases/db_1',
		]);
		expect(sleep).toHaveBeenCalledTimes(2);
		expect(output[0].json.status).toBe('ready');
		expect((output[0].json.connection as IDataObject).password).toBe(SECRET);
		expect((output[0].json.connection as IDataObject).endpointType).toBe('pooled');
	});

	it('does not poll when Wait Until Ready is off', async () => {
		const { output, http } = await run(
			[params({ waitUntilReady: false })],
			[ok(apiDatabase('provisioning'), 201)],
		);
		expect(http).toHaveBeenCalledTimes(1);
		expect(output[0].json.status).toBe('provisioning');
	});

	it('reports a provisioning failure', async () => {
		const mock = createContext(
			[params()],
			[ok(apiDatabase('provisioning'), 201), ok({ id: 'db_1', status: 'failure' })],
		);
		await expect(node.execute.call(mock.context)).rejects.toThrow(
			'Prisma could not provision database db_1',
		);
	});

	it('sets isDefault only when requested', async () => {
		const { requests } = await run([params({ isDefault: true })], [ok(apiDatabase(), 201)]);
		expect(requests()[0].body).toMatchObject({ isDefault: true });
	});
});

describe('database reads and delete', () => {
	it('never returns secrets from Get', async () => {
		const { output } = await run(
			[{ resource: 'database', operation: 'get', databaseId: rl('db_1') }],
			[ok(apiDatabase())],
		);
		expect(output[0].json.id).toBe('db_1');
		expect(JSON.stringify(output)).not.toContain(SECRET);
	});

	it('filters Get Many by project', async () => {
		const { requests } = await run(
			[
				{
					resource: 'database',
					operation: 'getAll',
					returnAll: false,
					limit: 50,
					filters: { projectId: 'proj_1' },
				},
			],
			[list([apiDatabase()])],
		);
		expect(requests()[0].qs).toEqual({ projectId: 'proj_1', limit: 50 });
	});

	it('deletes and returns { deleted: true }', async () => {
		const { output, requests } = await run(
			[{ resource: 'database', operation: 'delete', databaseId: rl('db_1') }],
			[{ statusCode: 204 }],
		);
		expect(requests()[0]).toMatchObject({
			method: 'DELETE',
			url: 'https://api.prisma.io/v1/databases/db_1',
		});
		expect(output[0].json).toEqual({ deleted: true });
	});
});

describe('connection', () => {
	it('creates a connection and returns Postgres credential fields', async () => {
		const { output, requests } = await run(
			[
				{
					resource: 'connection',
					operation: 'create',
					databaseId: rl('db_1'),
					name: 'n8n',
					endpointType: 'pooled',
				},
			],
			[ok(apiConnection(), 201)],
		);
		expect(requests()[0]).toMatchObject({
			method: 'POST',
			url: 'https://api.prisma.io/v1/connections',
			body: { databaseId: 'db_1', name: 'n8n' },
		});
		expect(output[0].json).toMatchObject({
			id: 'con_1',
			host: 'pooled.db.prisma.io',
			port: 5432,
			database: 'postgres',
			user: 'user_a',
			password: SECRET,
			ssl: 'require',
		});
	});

	it.each(['ab', 'x'.repeat(66)])('validates the name length (%s)', async (name) => {
		const mock = createContext(
			[
				{
					resource: 'connection',
					operation: 'create',
					databaseId: rl('db_1'),
					name,
					endpointType: 'pooled',
				},
			],
			[],
		);
		await expect(node.execute.call(mock.context)).rejects.toThrow(NodeOperationError);
		expect(mock.http).not.toHaveBeenCalled();
	});

	it('lists connection metadata without secrets', async () => {
		const { output, requests } = await run(
			[
				{
					resource: 'connection',
					operation: 'getAll',
					returnAll: true,
					filters: { databaseId: 'db_1' },
				},
			],
			[list([apiConnection('con_1'), apiConnection('con_2')])],
		);
		expect(requests()[0].qs).toEqual({ databaseId: 'db_1', limit: 100 });
		expect(output.map((item) => item.json.id)).toEqual(['con_1', 'con_2']);
		expect(JSON.stringify(output)).not.toContain(SECRET);
	});

	it('deletes a connection', async () => {
		const { output, requests } = await run(
			[{ resource: 'connection', operation: 'delete', connectionId: 'con_1' }],
			[{ statusCode: 204 }],
		);
		expect(requests()[0].url).toBe('https://api.prisma.io/v1/connections/con_1');
		expect(output[0].json).toEqual({ deleted: true });
	});
});

describe('multiple items and item linking', () => {
	const params = [
		{ resource: 'database', operation: 'get', databaseId: rl('db_1') },
		{ resource: 'database', operation: 'get', databaseId: rl('db_missing') },
		{ resource: 'database', operation: 'get', databaseId: rl('db_3') },
	];
	const notFound: MockResponse = {
		statusCode: 404,
		body: { error: { code: 'not_found', message: 'no such database' } },
	};

	it('processes each item with its own parameters and links outputs to inputs', async () => {
		const { output, requests } = await run(params, [
			ok({ id: 'db_1' }),
			ok({ id: 'db_missing' }),
			ok({ id: 'db_3' }),
		]);
		expect(requests().map((request) => request.url.split('/').pop())).toEqual([
			'db_1',
			'db_missing',
			'db_3',
		]);
		expect(output.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 1 }, { item: 2 }]);
	});

	it('links every row of a Get Many to the input item that produced it', async () => {
		const many = { resource: 'project', operation: 'getAll', returnAll: true };
		const { output } = await run(
			[many, many],
			[list([{ id: 'a' }, { id: 'b' }]), list([{ id: 'c' }])],
		);
		expect(output.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 0 }, { item: 1 }]);
	});

	it('stops at the failing item by default, with its index', async () => {
		const mock = createContext(params, [ok({ id: 'db_1' }), notFound]);
		const error = await node.execute.call(mock.context).catch((e) => e);
		expect(error).toBeInstanceOf(NodeApiError);
		expect(error.context.itemIndex).toBe(1);
		expect(mock.http).toHaveBeenCalledTimes(2);
	});

	it('continues past a failing item when Continue On Fail is on', async () => {
		const { output } = await run(params, [ok({ id: 'db_1' }), notFound, ok({ id: 'db_3' })], {
			continueOnFail: true,
		});
		expect(output).toEqual([
			{ json: { id: 'db_1' }, pairedItem: { item: 0 } },
			{ json: { error: 'Prisma could not find the requested resource' }, pairedItem: { item: 1 } },
			{ json: { id: 'db_3' }, pairedItem: { item: 2 } },
		]);
	});
});

describe('secret handling', () => {
	it('keeps secrets out of error messages when a create is followed by a failure', async () => {
		const mock = createContext(
			[
				{
					resource: 'database',
					operation: 'create',
					projectId: rl('proj_1'),
					name: 'kb',
					region: 'inherit',
					options: { includeConnectionDetails: true },
				},
			],
			[ok(apiDatabase('provisioning'), 201), ok({ id: 'db_1', status: 'failure' })],
		);
		const error = await node.execute.call(mock.context).catch((e) => e);
		expect(
			JSON.stringify({
				message: error.message,
				description: error.description,
				context: error.context,
			}),
		).not.toContain(SECRET);
	});
});

describe('dropdowns', () => {
	const loadContext = (responses: MockResponse[]) => {
		const mock = createContext([{}], responses);
		return { ...mock, context: mock.context as unknown as ILoadOptionsFunctions };
	};

	it('searches projects by name with read-only requests', async () => {
		const { context, requests } = loadContext([
			list(
				[
					{ id: 'proj_1', name: 'Accounts Inbox' },
					{ id: 'proj_2', name: 'Policies' },
				],
				'c1',
			),
			list([{ id: 'proj_3', name: 'inbox archive' }]),
		]);
		const result = await node.methods.listSearch.searchProjects.call(context, 'INBOX');
		expect(result.results).toEqual([
			{ name: 'Accounts Inbox', value: 'proj_1' },
			{ name: 'inbox archive', value: 'proj_3' },
		]);
		expect(requests().every((request) => request.method === 'GET')).toBe(true);
	});

	it('returns one page and a pagination token when there is no filter', async () => {
		const { context, http } = loadContext([list([{ id: 'proj_1', name: 'A' }], 'c1')]);
		const result = await node.methods.listSearch.searchProjects.call(context);
		expect(result).toEqual({ results: [{ name: 'A', value: 'proj_1' }], paginationToken: 'c1' });
		expect(http).toHaveBeenCalledTimes(1);
	});

	it('labels databases with their project', async () => {
		const { context } = loadContext([list([apiDatabase()])]);
		const result = await node.methods.listSearch.searchDatabases.call(context);
		expect(result.results).toEqual([{ name: 'inbox / main', value: 'db_1' }]);
	});

	it('lists available regions, with a project default for databases', async () => {
		const regions = {
			statusCode: 200,
			body: {
				data: [
					{ id: 'us-east-1', name: 'US East', status: 'available' },
					{ id: 'ap-south-9', name: 'Closed', status: 'unavailable' },
				],
			},
		};
		expect(await node.methods.loadOptions.getRegions.call(loadContext([regions]).context)).toEqual([
			{ name: 'US East (us-east-1)', value: 'us-east-1' },
		]);
		expect(
			(await node.methods.loadOptions.getDatabaseRegions.call(loadContext([regions]).context))[0],
		).toEqual({
			name: 'Same as Project',
			value: 'inherit',
		});
	});
});
