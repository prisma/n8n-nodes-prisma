import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, sleep } from 'n8n-workflow';

export const BASE_URL = 'https://api.prisma.io/v1';
export const CREDENTIAL_NAME = 'prismaApi';
export const PAGE_SIZE = 100;
export const MAX_ATTEMPTS = 4;
const MAX_RETRY_DELAY_MS = 30_000;

type PrismaContext = IExecuteFunctions | ILoadOptionsFunctions;

interface FullResponse {
	statusCode: number;
	headers?: IDataObject;
	body?: unknown;
}

interface PrismaErrorBody {
	error?: { code?: string; message?: string; hint?: string };
}

const STATUS_GUIDANCE: Record<number, { message: string; description: string }> = {
	401: {
		message: 'Prisma did not accept the service token',
		description:
			'The service token in the Prisma API credential is incomplete or has been revoked, so create a new one in Prisma Console under Settings > Service Tokens and update the credential.',
	},
	403: {
		message: 'The service token is not allowed to do this',
		description:
			'The token belongs to a different workspace or has no access to this resource, so use a service token from the workspace that owns it.',
	},
	404: {
		message: 'Prisma could not find the requested resource',
		description:
			'Check the ID, because the resource may have been deleted or may belong to a workspace that this service token cannot access.',
	},
	409: {
		message: 'This conflicts with an existing Prisma resource',
		description:
			'A resource with the same identifier already exists, or the resource is in a state that does not allow this operation.',
	},
	429: {
		message: 'Prisma rate limit reached',
		description:
			'The request was retried and is still rate limited, so wait a moment before you run the node again or process fewer items per run.',
	},
};

/**
 * Seconds or HTTP-date from a Retry-After header, as milliseconds.
 * Falls back to exponential backoff when the header is missing or invalid.
 */
export function retryDelayMs(headers: IDataObject | undefined, attempt: number): number {
	const fallback = Math.min(MAX_RETRY_DELAY_MS, 500 * 2 ** (attempt - 1));
	const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
	if (raw === undefined || raw === null || raw === '') return fallback;
	const seconds = Number(raw);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return Math.min(MAX_RETRY_DELAY_MS, seconds * 1000);
	}
	const date = Date.parse(String(raw));
	if (!Number.isNaN(date)) {
		return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, date - Date.now()));
	}
	return fallback;
}

/**
 * 429 means the request was rejected before any work happened, so it is safe to retry for
 * every method. Gateway responses (502, 503, 504) are retried for read requests only: a write
 * may already have been applied, and repeating it could create a second database.
 */
export function shouldRetry(method: IHttpRequestMethods, statusCode: number): boolean {
	if (statusCode === 429) return true;
	return method === 'GET' && [502, 503, 504].includes(statusCode);
}

function parseBody(body: unknown): IDataObject {
	if (body === undefined || body === null || body === '') return {};
	if (typeof body === 'string') {
		try {
			return JSON.parse(body) as IDataObject;
		} catch {
			return { message: body };
		}
	}
	return body as IDataObject;
}

function toApiError(
	context: PrismaContext,
	statusCode: number,
	body: IDataObject,
	itemIndex?: number,
): NodeApiError {
	const apiError = (body as PrismaErrorBody).error ?? {};
	const guidance = STATUS_GUIDANCE[statusCode];
	const apiMessage = apiError.message ?? (typeof body.message === 'string' ? body.message : '');
	const message = guidance?.message ?? (apiMessage || `Prisma returned HTTP ${statusCode}`);
	const description = [guidance ? apiMessage : '', apiError.hint ?? '', guidance?.description ?? '']
		.filter((part) => part !== '')
		.join(' ');

	// Only the API's own error payload is attached. Request headers never are.
	const errorResponse: JsonObject = {
		statusCode,
		code: apiError.code ?? null,
		message: apiMessage || message,
	};

	return new NodeApiError(context.getNode(), errorResponse, {
		message,
		description: description || undefined,
		httpCode: String(statusCode),
		itemIndex,
	});
}

export async function prismaApiRequest(
	this: PrismaContext,
	method: IHttpRequestMethods,
	path: string,
	body?: IDataObject,
	qs?: IDataObject,
	itemIndex?: number,
): Promise<IDataObject> {
	const options: IHttpRequestOptions = {
		method,
		url: `${BASE_URL}${path}`,
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		headers: { Accept: 'application/json' },
	};
	if (body !== undefined && Object.keys(body).length > 0) options.body = body;
	if (qs !== undefined && Object.keys(qs).length > 0) options.qs = qs;

	for (let attempt = 1; ; attempt++) {
		const response = (await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIAL_NAME,
			options,
		)) as FullResponse;

		const statusCode = response.statusCode;
		if (statusCode >= 200 && statusCode < 300) {
			return parseBody(response.body);
		}
		if (attempt < MAX_ATTEMPTS && shouldRetry(method, statusCode)) {
			await sleep(retryDelayMs(response.headers, attempt));
			continue;
		}
		throw toApiError(this, statusCode, parseBody(response.body), itemIndex);
	}
}

/**
 * Follows the API's cursor pagination. Stops as soon as `limit` items are collected,
 * so a small limit costs a single request.
 */
export async function prismaApiRequestAllItems(
	this: PrismaContext,
	path: string,
	qs: IDataObject = {},
	limit?: number,
	itemIndex?: number,
): Promise<IDataObject[]> {
	const items: IDataObject[] = [];
	let cursor: string | undefined;

	do {
		const remaining = limit === undefined ? PAGE_SIZE : limit - items.length;
		const pageQs: IDataObject = { ...qs, limit: Math.min(PAGE_SIZE, remaining) };
		if (cursor) pageQs.cursor = cursor;

		const response = await prismaApiRequest.call(this, 'GET', path, undefined, pageQs, itemIndex);
		const page = Array.isArray(response.data) ? (response.data as IDataObject[]) : [];
		items.push(...page);

		const pagination = (response.pagination ?? {}) as {
			nextCursor?: string | null;
			hasMore?: boolean;
		};
		cursor = pagination.hasMore && pagination.nextCursor ? pagination.nextCursor : undefined;
		if (page.length === 0) cursor = undefined;
	} while (cursor && (limit === undefined || items.length < limit));

	return limit === undefined ? items : items.slice(0, limit);
}
