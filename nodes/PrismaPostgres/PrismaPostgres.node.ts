import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeListSearchResult,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';

import type { EndpointType } from './connection';
import { redactSecrets, toConnectionDetails } from './connection';
import { fields, operations, resource } from './descriptions';
import { PAGE_SIZE, prismaApiRequest, prismaApiRequestAllItems } from './transport';

const READY_POLL_INTERVAL_MS = 2000;
const READY_TIMEOUT_MS = 120_000;
const SEARCH_MAX_PAGES = 10;

function unwrap(response: IDataObject): IDataObject {
	return (response.data ?? response) as IDataObject;
}

async function searchList(
	context: ILoadOptionsFunctions,
	path: string,
	label: (entry: IDataObject) => string,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const needle = filter?.trim().toLowerCase();
	const results: INodeListSearchResult['results'] = [];
	let cursor = paginationToken;

	// Without a filter, return one page and let n8n ask for the next one.
	// With a filter, scan a bounded number of pages, because the API has no name search.
	for (let page = 0; page < (needle ? SEARCH_MAX_PAGES : 1); page++) {
		const qs: IDataObject = { limit: PAGE_SIZE };
		if (cursor) qs.cursor = cursor;
		const response = await prismaApiRequest.call(context, 'GET', path, undefined, qs);
		const entries = Array.isArray(response.data) ? (response.data as IDataObject[]) : [];
		for (const entry of entries) {
			const name = label(entry);
			if (needle && !name.toLowerCase().includes(needle)) continue;
			results.push({ name, value: String(entry.id) });
		}
		const pagination = (response.pagination ?? {}) as {
			nextCursor?: string | null;
			hasMore?: boolean;
		};
		cursor = pagination.hasMore && pagination.nextCursor ? pagination.nextCursor : undefined;
		if (!cursor) break;
	}

	return { results, paginationToken: cursor };
}

async function loadRegions(context: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const response = await prismaApiRequest.call(context, 'GET', '/regions/postgres');
	const regions = Array.isArray(response.data) ? (response.data as IDataObject[]) : [];
	return regions
		.filter((region) => region.status !== 'unavailable')
		.map((region) => ({ name: `${region.name} (${region.id})`, value: String(region.id) }));
}

async function waitForDatabase(
	context: IExecuteFunctions,
	database: IDataObject,
	itemIndex: number,
): Promise<IDataObject> {
	let status = database.status;
	const deadline = Date.now() + READY_TIMEOUT_MS;

	while (status === 'provisioning' || status === 'recovering') {
		if (Date.now() >= deadline) {
			throw new NodeOperationError(
				context.getNode(),
				`Database ${String(database.id)} is still provisioning after ${READY_TIMEOUT_MS / 1000} seconds`,
				{
					itemIndex,
					description:
						'The database was created and needs more time to become ready, so check its status with the Get operation or turn off Wait Until Ready to continue without waiting.',
				},
			);
		}
		await sleep(READY_POLL_INTERVAL_MS);
		const latest = unwrap(
			await prismaApiRequest.call(
				context,
				'GET',
				`/databases/${encodeURIComponent(String(database.id))}`,
				undefined,
				undefined,
				itemIndex,
			),
		);
		status = latest.status;
	}

	if (status === 'failure') {
		throw new NodeOperationError(
			context.getNode(),
			`Prisma could not provision database ${String(database.id)}`,
			{
				itemIndex,
				description:
					'Delete the database and create it again, and contact Prisma support if the same thing keeps happening.',
			},
		);
	}

	// Keep the create response: it is the only one that carries connection strings.
	return { ...database, status };
}

/**
 * Create responses include the credentials of the default connection. They are removed
 * unless the user turned on Include Connection Details.
 */
function shapeCreatedDatabase(database: IDataObject, options: IDataObject): IDataObject {
	const output = redactSecrets(database);
	if (options.includeConnectionDetails !== true) return output;

	const connections = Array.isArray(database.connections)
		? (database.connections as IDataObject[])
		: [];
	const preferred =
		connections.find((entry) => entry.id === database.defaultConnectionId) ??
		connections.find((entry) => entry.kind === 'postgres') ??
		connections[0];
	if (!preferred) return output;

	const connection: IDataObject = {
		...preferred,
		database: preferred.database ?? { id: database.id, name: database.name },
	};
	output.connection = toConnectionDetails(
		connection,
		(options.endpointType as EndpointType) ?? 'pooled',
	);
	return output;
}

function requireId(
	context: IExecuteFunctions,
	value: unknown,
	label: string,
	itemIndex: number,
): string {
	const id = typeof value === 'string' ? value.trim() : '';
	if (id === '') {
		throw new NodeOperationError(context.getNode(), `No ${label} was provided`, {
			itemIndex,
			description: `Select a ${label} from the list, or switch to By ID and enter its ID.`,
		});
	}
	return encodeURIComponent(id);
}

export class PrismaPostgres implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Prisma Postgres',
		name: 'prismaPostgres',
		icon: { light: 'file:prisma.svg', dark: 'file:prisma.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Create and manage Prisma Postgres databases and their connections',
		defaults: {
			name: 'Prisma Postgres',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'prismaApi',
				required: true,
			},
		],
		properties: [resource, ...operations, ...fields],
	};

	methods = {
		listSearch: {
			async searchWorkspaces(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			): Promise<INodeListSearchResult> {
				return await searchList(
					this,
					'/workspaces',
					(entry) => String(entry.name),
					filter,
					paginationToken,
				);
			},
			async searchProjects(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			): Promise<INodeListSearchResult> {
				return await searchList(
					this,
					'/projects',
					(entry) => String(entry.name),
					filter,
					paginationToken,
				);
			},
			async searchDatabases(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			): Promise<INodeListSearchResult> {
				return await searchList(
					this,
					'/databases',
					(entry) => {
						const project = (entry.project ?? {}) as IDataObject;
						return project.name
							? `${String(project.name)} / ${String(entry.name)}`
							: String(entry.name);
					},
					filter,
					paginationToken,
				);
			},
		},
		loadOptions: {
			async getRegions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return await loadRegions(this);
			},
			async getDatabaseRegions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return [{ name: 'Same as Project', value: 'inherit' }, ...(await loadRegions(this))];
			},
			async getWorkspaces(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const workspaces = await prismaApiRequestAllItems.call(this, '/workspaces');
				return workspaces.map((workspace) => ({
					name: String(workspace.name),
					value: String(workspace.id),
				}));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resourceName = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				let result: IDataObject | IDataObject[];

				const locatorId = (name: string, label: string) =>
					requireId(this, this.getNodeParameter(name, i, '', { extractValue: true }), label, i);
				const listLimit = () =>
					this.getNodeParameter('returnAll', i, false)
						? undefined
						: (this.getNodeParameter('limit', i, 50) as number);

				if (resourceName === 'workspace' && operation === 'get') {
					const id = locatorId('workspaceId', 'workspace');
					result = unwrap(
						await prismaApiRequest.call(this, 'GET', `/workspaces/${id}`, undefined, undefined, i),
					);
				} else if (resourceName === 'workspace' && operation === 'getAll') {
					result = await prismaApiRequestAllItems.call(this, '/workspaces', {}, listLimit(), i);
				} else if (resourceName === 'project' && operation === 'create') {
					const options = this.getNodeParameter('options', i, {}) as IDataObject;
					const name = (this.getNodeParameter('name', i) as string).trim();
					if (name === '') {
						throw new NodeOperationError(this.getNode(), 'The project needs a name', {
							itemIndex: i,
						});
					}
					const body: IDataObject = { name, createDatabase: options.createDatabase !== false };
					const region = this.getNodeParameter('region', i, '') as string;
					if (region) body.region = region;
					if (options.workspaceId) body.workspaceId = options.workspaceId;

					const project = unwrap(
						await prismaApiRequest.call(this, 'POST', '/projects', body, undefined, i),
					);
					if (project.database && typeof project.database === 'object') {
						let database = project.database as IDataObject;
						if (options.waitUntilReady !== false)
							database = await waitForDatabase(this, database, i);
						result = {
							...redactSecrets(project),
							database: shapeCreatedDatabase(database, options),
						};
					} else {
						result = redactSecrets(project);
					}
				} else if (resourceName === 'project' && operation === 'get') {
					const id = locatorId('projectId', 'project');
					result = redactSecrets(
						unwrap(
							await prismaApiRequest.call(this, 'GET', `/projects/${id}`, undefined, undefined, i),
						),
					);
				} else if (resourceName === 'project' && operation === 'getAll') {
					result = redactSecrets(
						await prismaApiRequestAllItems.call(this, '/projects', {}, listLimit(), i),
					);
				} else if (resourceName === 'project' && operation === 'delete') {
					const id = locatorId('projectId', 'project');
					await prismaApiRequest.call(this, 'DELETE', `/projects/${id}`, undefined, undefined, i);
					result = { deleted: true };
				} else if (resourceName === 'database' && operation === 'create') {
					const options = this.getNodeParameter('options', i, {}) as IDataObject;
					const name = (this.getNodeParameter('name', i) as string).trim();
					if (name === '') {
						throw new NodeOperationError(this.getNode(), 'The database needs a name', {
							itemIndex: i,
						});
					}
					const body: IDataObject = {
						projectId: decodeURIComponent(locatorId('projectId', 'project')),
						name,
						region: (this.getNodeParameter('region', i, 'inherit') as string) || 'inherit',
					};
					if (options.isDefault === true) body.isDefault = true;

					let database = unwrap(
						await prismaApiRequest.call(this, 'POST', '/databases', body, undefined, i),
					);
					if (options.waitUntilReady !== false) database = await waitForDatabase(this, database, i);
					result = shapeCreatedDatabase(database, options);
				} else if (resourceName === 'database' && operation === 'get') {
					const id = locatorId('databaseId', 'database');
					result = redactSecrets(
						unwrap(
							await prismaApiRequest.call(this, 'GET', `/databases/${id}`, undefined, undefined, i),
						),
					);
				} else if (resourceName === 'database' && operation === 'getAll') {
					const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
					const qs: IDataObject = {};
					if (filters.projectId) qs.projectId = filters.projectId;
					result = redactSecrets(
						await prismaApiRequestAllItems.call(this, '/databases', qs, listLimit(), i),
					);
				} else if (resourceName === 'database' && operation === 'delete') {
					const id = locatorId('databaseId', 'database');
					await prismaApiRequest.call(this, 'DELETE', `/databases/${id}`, undefined, undefined, i);
					result = { deleted: true };
				} else if (resourceName === 'connection' && operation === 'create') {
					const name = (this.getNodeParameter('name', i) as string).trim();
					if (name.length < 3 || name.length > 65) {
						throw new NodeOperationError(
							this.getNode(),
							'The connection name must have 3 to 65 characters',
							{
								itemIndex: i,
							},
						);
					}
					const body: IDataObject = {
						databaseId: decodeURIComponent(locatorId('databaseId', 'database')),
						name,
					};
					const connection = unwrap(
						await prismaApiRequest.call(this, 'POST', '/connections', body, undefined, i),
					);
					result = toConnectionDetails(
						connection,
						this.getNodeParameter('endpointType', i, 'pooled') as EndpointType,
					);
				} else if (resourceName === 'connection' && operation === 'getAll') {
					const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
					const qs: IDataObject = {};
					if (filters.databaseId) qs.databaseId = filters.databaseId;
					result = redactSecrets(
						await prismaApiRequestAllItems.call(this, '/connections', qs, listLimit(), i),
					);
				} else if (resourceName === 'connection' && operation === 'delete') {
					const id = requireId(this, this.getNodeParameter('connectionId', i), 'connection ID', i);
					await prismaApiRequest.call(
						this,
						'DELETE',
						`/connections/${id}`,
						undefined,
						undefined,
						i,
					);
					result = { deleted: true };
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`The operation "${operation}" is not supported for the resource "${resourceName}"`,
						{ itemIndex: i },
					);
				}

				returnData.push(
					...this.helpers.constructExecutionMetaData(this.helpers.returnJsonArray(result), {
						itemData: { item: i },
					}),
				);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				// Errors raised by this node already carry the item index and a helpful description.
				const nodeError =
					error instanceof NodeApiError || error instanceof NodeOperationError
						? error
						: new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
				throw nodeError;
			}
		}

		return [returnData];
	}
}
