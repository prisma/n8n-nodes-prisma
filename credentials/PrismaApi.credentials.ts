import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

export class PrismaApi implements ICredentialType {
	name = 'prismaApi';

	displayName = 'Prisma API';

	icon: Icon = { light: 'file:prisma.svg', dark: 'file:prisma.dark.svg' };

	documentationUrl = 'https://github.com/prisma/n8n-nodes-prisma#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Service Token',
			name: 'serviceToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'A Prisma workspace service token. Create one in Prisma Console under Workspace Settings > Service Tokens.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.serviceToken}}',
			},
		},
	};

	// Read-only request. Testing a credential never creates a resource.
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.prisma.io/v1',
			url: '/workspaces',
			qs: { limit: 1 },
		},
	};
}
