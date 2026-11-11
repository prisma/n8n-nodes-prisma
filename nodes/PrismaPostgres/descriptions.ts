import type { INodeProperties } from 'n8n-workflow';

type Show = { resource: string[]; operation: string[] };

function locator(
	displayName: string,
	name: string,
	searchListMethod: string,
	placeholder: string,
	description: string,
	show: Show,
	required = true,
): INodeProperties {
	return {
		displayName,
		name,
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required,
		description,
		displayOptions: { show },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod, searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder,
				validation: [
					{
						type: 'regex',
						properties: {
							regex: '^[A-Za-z0-9_]+$',
							errorMessage: 'Enter an ID that contains only letters, numbers and underscores',
						},
					},
				],
			},
		],
	};
}

function returnAll(show: Show): INodeProperties[] {
	return [
		{
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			default: false,
			description: 'Whether to return all results or only up to a given limit',
			displayOptions: { show },
		},
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			typeOptions: { minValue: 1 },
			default: 50,
			description: 'Max number of results to return',
			displayOptions: { show: { ...show, returnAll: [false] } },
		},
	];
}

const includeConnectionDetails: INodeProperties = {
	displayName: 'Include Connection Details',
	name: 'includeConnectionDetails',
	type: 'boolean',
	default: false,
	description:
		'Whether to output the password and connection strings of the default connection, which then become visible in the execution data of this workflow',
};

const endpointType: INodeProperties = {
	displayName: 'Endpoint Type',
	name: 'endpointType',
	type: 'options',
	options: [
		{
			name: 'Pooled',
			value: 'pooled',
			description:
				'Shares database connections between runs, which suits workflows that run often or in parallel',
		},
		{
			name: 'Direct',
			value: 'direct',
			description:
				'Connects straight to the database, which suits schema changes and long transactions',
		},
	],
	default: 'pooled',
	description:
		'The endpoint that the host, port and connection string fields point to, with both endpoints always included in the output',
};

const waitUntilReady: INodeProperties = {
	displayName: 'Wait Until Ready',
	name: 'waitUntilReady',
	type: 'boolean',
	default: true,
	description: 'Whether to wait until the database has finished provisioning before returning',
};

export const resource: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: [
		{ name: 'Connection', value: 'connection' },
		{ name: 'Database', value: 'database' },
		{ name: 'Project', value: 'project' },
		{ name: 'Workspace', value: 'workspace' },
	],
	default: 'database',
};

export const operations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['workspace'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get a workspace',
				action: 'Get workspace',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get the workspaces the service token can access',
				action: 'Get many workspaces',
			},
		],
		default: 'getAll',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['project'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a project, with a Prisma Postgres database by default',
				action: 'Create project',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a project and all of its databases',
				action: 'Delete project',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a project',
				action: 'Get project',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many projects',
				action: 'Get many projects',
			},
		],
		default: 'getAll',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['database'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a Prisma Postgres database in a project',
				action: 'Create database',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a database and all of its data',
				action: 'Delete database',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a database',
				action: 'Get database',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many databases',
				action: 'Get many databases',
			},
		],
		default: 'create',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['connection'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create database credentials and connection strings',
				action: 'Create connection',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a connection and revoke its credentials',
				action: 'Delete connection',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get connection metadata, without passwords',
				action: 'Get many connections',
			},
		],
		default: 'create',
	},
];

export const fields: INodeProperties[] = [
	// ----------------------------------------
	//               workspace
	// ----------------------------------------
	locator(
		'Workspace',
		'workspaceId',
		'searchWorkspaces',
		'e.g. wksp_cmb1x2y3z0000abcd1234efgh',
		'The workspace to get',
		{ resource: ['workspace'], operation: ['get'] },
	),
	...returnAll({ resource: ['workspace'], operation: ['getAll'] }),

	// ----------------------------------------
	//                project
	// ----------------------------------------
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. accounts-inbox',
		description: 'The name of the project',
		displayOptions: { show: { resource: ['project'], operation: ['create'] } },
	},
	{
		displayName: 'Region Name or ID',
		name: 'region',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getRegions' },
		default: 'us-east-1',
		description:
			'The region that hosts the project and its default database. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: { show: { resource: ['project'], operation: ['create'] } },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: { show: { resource: ['project'], operation: ['create'] } },
		options: [
			{
				displayName: 'Create Default Database',
				name: 'createDatabase',
				type: 'boolean',
				default: true,
				description: 'Whether to create a Prisma Postgres database together with the project',
			},
			endpointType,
			includeConnectionDetails,
			waitUntilReady,
			{
				displayName: 'Workspace Name or ID',
				name: 'workspaceId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getWorkspaces' },
				default: '',
				description:
					'The workspace to create the project in, which defaults to the workspace of the service token. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
		],
	},
	locator(
		'Project',
		'projectId',
		'searchProjects',
		'e.g. proj_cmb1x2y3z0000abcd1234efgh',
		'The project to use',
		{ resource: ['project'], operation: ['get', 'delete'] },
	),
	...returnAll({ resource: ['project'], operation: ['getAll'] }),

	// ----------------------------------------
	//                database
	// ----------------------------------------
	locator(
		'Project',
		'projectId',
		'searchProjects',
		'e.g. proj_cmb1x2y3z0000abcd1234efgh',
		'The project to create the database in',
		{ resource: ['database'], operation: ['create'] },
	),
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. policy-knowledge-base',
		description: 'The display name of the database',
		displayOptions: { show: { resource: ['database'], operation: ['create'] } },
	},
	{
		displayName: 'Region Name or ID',
		name: 'region',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getDatabaseRegions' },
		default: 'inherit',
		description:
			'The region that hosts the database, which defaults to the region of the project. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: { show: { resource: ['database'], operation: ['create'] } },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: { show: { resource: ['database'], operation: ['create'] } },
		options: [
			endpointType,
			includeConnectionDetails,
			{
				displayName: 'Set as Default',
				name: 'isDefault',
				type: 'boolean',
				default: false,
				description: 'Whether to make this the default database of the project',
			},
			waitUntilReady,
		],
	},
	locator(
		'Database',
		'databaseId',
		'searchDatabases',
		'e.g. db_cmb1x2y3z0000abcd1234efgh',
		'The database to use',
		{ resource: ['database'], operation: ['get', 'delete'] },
	),
	...returnAll({ resource: ['database'], operation: ['getAll'] }),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add filter',
		default: {},
		displayOptions: { show: { resource: ['database'], operation: ['getAll'] } },
		options: [
			{
				displayName: 'Project ID',
				name: 'projectId',
				type: 'string',
				default: '',
				placeholder: 'e.g. proj_cmb1x2y3z0000abcd1234efgh',
				description: 'Only return databases that belong to this project',
			},
		],
	},

	// ----------------------------------------
	//               connection
	// ----------------------------------------
	locator(
		'Database',
		'databaseId',
		'searchDatabases',
		'e.g. db_cmb1x2y3z0000abcd1234efgh',
		'The database to create credentials for',
		{ resource: ['connection'], operation: ['create'] },
	),
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: 'n8n',
		placeholder: 'e.g. n8n-accounts-inbox',
		description: 'A label for the connection, between 3 and 65 characters',
		displayOptions: { show: { resource: ['connection'], operation: ['create'] } },
	},
	{
		...endpointType,
		displayOptions: { show: { resource: ['connection'], operation: ['create'] } },
	},
	{
		displayName:
			'The output contains the database password, which anyone who can view executions of this workflow can read. After you copy the values into a Postgres credential, delete the execution or turn off saving of execution data.',
		name: 'secretNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: ['connection'], operation: ['create'] } },
	},
	{
		displayName: 'Connection ID',
		name: 'connectionId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. con_cmb1x2y3z0000abcd1234efgh',
		description:
			'The ID of the connection to delete, which you can find with the Get Many operation',
		displayOptions: { show: { resource: ['connection'], operation: ['delete'] } },
	},
	...returnAll({ resource: ['connection'], operation: ['getAll'] }),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add filter',
		default: {},
		displayOptions: { show: { resource: ['connection'], operation: ['getAll'] } },
		options: [
			{
				displayName: 'Database ID',
				name: 'databaseId',
				type: 'string',
				default: '',
				placeholder: 'e.g. db_cmb1x2y3z0000abcd1234efgh',
				description: 'Only return connections that belong to this database',
			},
		],
	},
];
