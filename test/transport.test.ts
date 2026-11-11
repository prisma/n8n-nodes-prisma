import { NodeApiError, sleep } from 'n8n-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('n8n-workflow', async (importOriginal) => ({
	...(await importOriginal<typeof import('n8n-workflow')>()),
	sleep: vi.fn(async () => {}),
}));

import {
	MAX_ATTEMPTS,
	prismaApiRequest,
	prismaApiRequestAllItems,
	retryDelayMs,
	shouldRetry,
} from '../nodes/PrismaPostgres/transport';
import { createContext } from './helpers';

beforeEach(() => vi.mocked(sleep).mockClear());

describe('request construction', () => {
	it('calls the v1 API through the Prisma credential and never sets the token itself', async () => {
		const { context, http } = createContext(
			[{}],
			[{ statusCode: 200, body: { data: { id: 'proj_1' } } }],
		);
		const result = await prismaApiRequest.call(context, 'GET', '/projects/proj_1');

		expect(result).toEqual({ data: { id: 'proj_1' } });
		const [credentialName, options] = http.mock.calls[0] as unknown as [
			string,
			Record<string, unknown>,
		];
		expect(credentialName).toBe('prismaApi');
		expect(options.url).toBe('https://api.prisma.io/v1/projects/proj_1');
		expect(options.method).toBe('GET');
		expect(JSON.stringify(options)).not.toMatch(/authorization|bearer/i);
		expect(options.body).toBeUndefined();
		expect(options.qs).toBeUndefined();
	});

	it('returns an empty object for 204 responses', async () => {
		const { context } = createContext([{}], [{ statusCode: 204 }]);
		expect(await prismaApiRequest.call(context, 'DELETE', '/databases/db_1')).toEqual({});
	});
});

describe('errors', () => {
	it.each([
		[401, 'Prisma did not accept the service token'],
		[403, 'The service token is not allowed to do this'],
		[404, 'Prisma could not find the requested resource'],
		[409, 'This conflicts with an existing Prisma resource'],
	])('maps HTTP %i to a clear message', async (statusCode, message) => {
		const { context } = createContext(
			[{}],
			[
				{
					statusCode,
					body: { error: { code: 'some_code', message: 'api says no', hint: 'try this' } },
				},
			],
		);
		const error = await prismaApiRequest
			.call(context, 'POST', '/databases', { projectId: 'p' })
			.catch((e) => e);

		expect(error).toBeInstanceOf(NodeApiError);
		expect(error.message).toBe(message);
		expect(error.description).toContain('api says no');
		expect(error.description).toContain('try this');
		expect(error.httpCode).toBe(String(statusCode));
	});

	it('uses the API message for statuses without specific guidance', async () => {
		const { context } = createContext(
			[{}],
			[{ statusCode: 400, body: { error: { message: 'name is too short' } } }],
		);
		const error = await prismaApiRequest
			.call(context, 'POST', '/connections', { name: 'x' })
			.catch((e) => e);
		expect(error.message).toBe('name is too short');
		expect(error.context.itemIndex).toBeUndefined();
	});

	it('attaches the item index', async () => {
		const { context } = createContext([{}], [{ statusCode: 404, body: {} }]);
		const error = await prismaApiRequest
			.call(context, 'GET', '/databases/x', undefined, undefined, 3)
			.catch((e) => e);
		expect(error.context.itemIndex).toBe(3);
	});

	it('handles non-JSON error bodies', async () => {
		const { context } = createContext(
			[{}],
			[{ statusCode: 500, body: '<html>bad gateway</html>' }],
		);
		const error = await prismaApiRequest
			.call(context, 'POST', '/projects', { name: 'a' })
			.catch((e) => e);
		expect(error).toBeInstanceOf(NodeApiError);
		expect(error.httpCode).toBe('500');
	});
});

describe('retries and rate limits', () => {
	it('waits for Retry-After on 429, then succeeds', async () => {
		const { context, http } = createContext(
			[{}],
			[
				{
					statusCode: 429,
					headers: { 'retry-after': '2' },
					body: { error: { message: 'slow down' } },
				},
				{ statusCode: 201, body: { data: { id: 'db_1' } } },
			],
		);
		const result = await prismaApiRequest.call(context, 'POST', '/databases', { projectId: 'p' });
		expect(result).toEqual({ data: { id: 'db_1' } });
		expect(http).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenCalledWith(2000);
	});

	it('gives up after the maximum number of attempts', async () => {
		const { context, http } = createContext(
			[{}],
			Array.from({ length: MAX_ATTEMPTS }, () => ({ statusCode: 429, body: {} })),
		);
		const error = await prismaApiRequest.call(context, 'GET', '/projects').catch((e) => e);
		expect(error.message).toBe('Prisma rate limit reached');
		expect(http).toHaveBeenCalledTimes(MAX_ATTEMPTS);
	});

	it('retries gateway responses for reads but never for writes', async () => {
		const read = createContext(
			[{}],
			[
				{ statusCode: 503, body: {} },
				{ statusCode: 200, body: { data: [] } },
			],
		);
		await prismaApiRequest.call(read.context, 'GET', '/projects');
		expect(read.http).toHaveBeenCalledTimes(2);

		const write = createContext([{}], [{ statusCode: 503, body: {} }]);
		await expect(
			prismaApiRequest.call(write.context, 'POST', '/databases', { projectId: 'p' }),
		).rejects.toThrow();
		expect(write.http).toHaveBeenCalledTimes(1);
	});

	it('computes delays', () => {
		expect(shouldRetry('DELETE', 429)).toBe(true);
		expect(shouldRetry('POST', 502)).toBe(false);
		expect(shouldRetry('GET', 404)).toBe(false);
		expect(retryDelayMs({ 'retry-after': '1' }, 1)).toBe(1000);
		expect(retryDelayMs({ 'retry-after': '9999' }, 1)).toBe(30_000);
		expect(retryDelayMs(undefined, 1)).toBe(500);
		expect(retryDelayMs({}, 3)).toBe(2000);
		expect(retryDelayMs({ 'retry-after': 'nonsense' }, 2)).toBe(1000);
	});
});

describe('pagination', () => {
	const page = (ids: string[], nextCursor: string | null) => ({
		statusCode: 200,
		body: {
			data: ids.map((id) => ({ id })),
			pagination: { nextCursor, hasMore: nextCursor !== null },
		},
	});

	it('follows cursors until the last page', async () => {
		const { context, requests } = createContext(
			[{}],
			[page(['a', 'b'], 'c1'), page(['c'], 'c2'), page(['d'], null)],
		);
		const items = await prismaApiRequestAllItems.call(context, '/projects');
		expect(items.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
		expect(requests().map((request) => request.qs)).toEqual([
			{ limit: 100 },
			{ limit: 100, cursor: 'c1' },
			{ limit: 100, cursor: 'c2' },
		]);
	});

	it('stops at the limit and asks only for what it needs', async () => {
		const { context, requests } = createContext(
			[{}],
			[page(['a', 'b'], 'c1'), page(['c', 'd'], 'c2')],
		);
		const items = await prismaApiRequestAllItems.call(
			context,
			'/databases',
			{ projectId: 'proj_1' },
			3,
		);
		expect(items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
		expect(requests().map((request) => request.qs)).toEqual([
			{ projectId: 'proj_1', limit: 3 },
			{ projectId: 'proj_1', limit: 1, cursor: 'c1' },
		]);
	});

	it('does not loop when a page is empty', async () => {
		const { context, http } = createContext([{}], [page([], 'c1')]);
		expect(await prismaApiRequestAllItems.call(context, '/projects')).toEqual([]);
		expect(http).toHaveBeenCalledTimes(1);
	});
});
