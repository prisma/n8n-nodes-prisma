import { describe, expect, it } from 'vitest';

import { PrismaApi } from '../credentials/PrismaApi.credentials';

describe('Prisma API credential', () => {
	const credential = new PrismaApi();

	it('stores the service token as a password field', () => {
		const token = credential.properties.find((property) => property.name === 'serviceToken');
		expect(token?.typeOptions?.password).toBe(true);
		expect(token?.default).toBe('');
	});

	it('sends the token as a bearer header', () => {
		expect(credential.authenticate).toEqual({
			type: 'generic',
			properties: { headers: { Authorization: '=Bearer {{$credentials.serviceToken}}' } },
		});
	});

	it('tests with a read-only request', () => {
		expect(credential.test.request.method ?? 'GET').toBe('GET');
		expect(`${credential.test.request.baseURL}${credential.test.request.url}`).toBe(
			'https://api.prisma.io/v1/workspaces',
		);
	});
});
