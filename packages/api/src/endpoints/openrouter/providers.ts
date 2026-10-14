import { fetch as undiciFetch } from 'undici';
import { logger } from '@librechat/data-schemas';
import type {
  TOpenRouterEndpointsResponse,
  TOpenRouterEndpointItem,
} from 'librechat-data-provider';
import { getSafeErrorMetadata } from '~/utils/errors';

const OPENROUTER_MODEL_SLUG_REGEX = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)(?::[A-Za-z0-9._-]+)?$/;
const OPENROUTER_ENDPOINTS_TTL_MS = 600_000;

export interface OpenRouterCacheStore {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown, ttl?: number) => Promise<unknown>;
}

export interface FetchOpenRouterEndpointsParams {
  model: string;
  apiKey?: string;
  cache?: OpenRouterCacheStore;
  fetchImpl?: typeof undiciFetch;
}

export type FetchOpenRouterEndpointsResult =
  | { ok: true; value: TOpenRouterEndpointsResponse }
  | {
      ok: false;
      error: {
        code: 'INVALID_MODEL_SLUG' | 'UPSTREAM_ERROR' | 'NETWORK_ERROR';
        status: number;
        message: string;
      };
    };

export interface OpenRouterProviderRouting {
  order?: string[];
  allow_fallbacks?: boolean;
  sort?: 'price';
}

function roundPricePerMillion(rawPerToken: unknown): number {
  const num = Number(rawPerToken);
  if (!Number.isFinite(num) || num <= 0) {
    return 0;
  }
  return Math.round(num * 1_000_000 * 10_000) / 10_000;
}

/**
 * Formats the OpenRouter `provider` routing block for chat completion payloads.
 * - `'auto'` / `'price'` / `'floor'` -> `{ sort: 'price' }`
 * - Specific provider tag/name -> `{ order: [selectedProvider], allow_fallbacks: true }`
 */
export function buildOpenRouterProviderRouting(
  selectedProvider?: string | null,
): OpenRouterProviderRouting | undefined {
  if (typeof selectedProvider !== 'string') {
    return undefined;
  }
  const trimmed = selectedProvider.trim();
  if (!trimmed) {
    return undefined;
  }
  const lower = trimmed.toLowerCase();
  if (lower === 'auto' || lower === 'price' || lower === 'floor') {
    return { sort: 'price' };
  }
  return {
    order: [trimmed],
    allow_fallbacks: true,
  };
}

interface RawOpenRouterEndpoint {
  name?: string;
  tag?: string;
  provider_name?: string;
  context_length?: number | null;
  max_completion_tokens?: number | null;
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
    input_cache_read?: string | number;
  };
  latency_last_30m?: number | null;
  latency?: number | null;
  throughput_last_30m?: number | null;
  throughput?: number | null;
  status?: number | string | null;
  uptime_last_30m?: number | null;
}

function normalizeEndpointItem(raw: RawOpenRouterEndpoint): TOpenRouterEndpointItem {
  const providerName =
    (typeof raw.provider_name === 'string' && raw.provider_name.trim()) ||
    (typeof raw.name === 'string' && raw.name.trim()) ||
    (typeof raw.tag === 'string' && raw.tag.trim()) ||
    'Unknown';
  const tag =
    (typeof raw.tag === 'string' && raw.tag.trim()) ||
    (typeof raw.provider_name === 'string' && raw.provider_name.trim()) ||
    providerName;
  const name = (typeof raw.name === 'string' && raw.name.trim()) || providerName;

  const cacheReadRaw = raw.pricing?.input_cache_read;
  const cacheReadPerMillion = cacheReadRaw != null ? roundPricePerMillion(cacheReadRaw) : undefined;

  let latencyMs: number | undefined;
  if (typeof raw.latency_last_30m === 'number') {
    latencyMs = Math.round(raw.latency_last_30m);
  } else if (typeof raw.latency === 'number') {
    latencyMs = Math.round(raw.latency);
  }

  return {
    name,
    tag,
    providerName,
    contextLength: typeof raw.context_length === 'number' ? raw.context_length : undefined,
    maxCompletionTokens:
      typeof raw.max_completion_tokens === 'number' ? raw.max_completion_tokens : undefined,
    pricing: {
      promptPerMillion: roundPricePerMillion(raw.pricing?.prompt),
      completionPerMillion: roundPricePerMillion(raw.pricing?.completion),
      prompt: Number(raw.pricing?.prompt) || 0,
      completion: Number(raw.pricing?.completion) || 0,
      ...(cacheReadPerMillion !== undefined ? { cacheReadPerMillion } : {}),
    },
    latencyMs,
    status: raw.status ?? undefined,
    uptimeLast30m:
      typeof raw.uptime_last_30m === 'number'
        ? Math.round(raw.uptime_last_30m * 100) / 100
        : undefined,
  };
}

/**
 * Fetches live provider endpoints and pricing for an OpenRouter model slug,
 * caching the normalized list in Redis / Keyv for 10 minutes (`EX 600` / 600,000 ms).
 */
export async function fetchOpenRouterModelEndpoints(
  params: FetchOpenRouterEndpointsParams,
): Promise<FetchOpenRouterEndpointsResult> {
  const rawModel = typeof params.model === 'string' ? params.model.trim() : '';
  const match = OPENROUTER_MODEL_SLUG_REGEX.exec(rawModel);
  if (!match) {
    return {
      ok: false,
      error: {
        code: 'INVALID_MODEL_SLUG',
        status: 400,
        message: 'Invalid OpenRouter model slug. Expected format: author/slug.',
      },
    };
  }

  const author = match[1];
  const slug = match[2];
  const normalizedSlug = `${author}/${slug}`;

  if (params.cache) {
    try {
      const cached = await params.cache.get(normalizedSlug);
      if (Array.isArray(cached)) {
        return {
          ok: true,
          value: {
            model: normalizedSlug,
            endpoints: cached as TOpenRouterEndpointItem[],
            cached: true,
          },
        };
      }
    } catch (err) {
      logger.warn('[fetchOpenRouterModelEndpoints] Cache read failed', getSafeErrorMetadata(err));
    }
  }

  const url = `https://openrouter.ai/api/v1/models/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/endpoints`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'HTTP-Referer': 'https://librechat.ai',
    'X-Title': 'LibreChat',
  };
  if (typeof params.apiKey === 'string' && params.apiKey.trim().length > 0) {
    headers.Authorization = `Bearer ${params.apiKey.trim()}`;
  }

  const doFetch = params.fetchImpl ?? undiciFetch;
  try {
    const response = await doFetch(url, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      return {
        ok: false,
        error: {
          code: 'UPSTREAM_ERROR',
          status: response.status === 404 ? 404 : 502,
          message:
            response.status === 404
              ? `OpenRouter model endpoints not found for ${normalizedSlug}.`
              : `OpenRouter upstream returned status ${response.status}.`,
        },
      };
    }

    const payload = (await response.json()) as {
      data?: { endpoints?: RawOpenRouterEndpoint[] } | RawOpenRouterEndpoint[];
      endpoints?: RawOpenRouterEndpoint[];
    };

    let rawEndpoints: RawOpenRouterEndpoint[] = [];
    if (Array.isArray(payload?.data)) {
      rawEndpoints = payload.data;
    } else if (Array.isArray(payload?.data?.endpoints)) {
      rawEndpoints = payload.data.endpoints;
    } else if (Array.isArray(payload?.endpoints)) {
      rawEndpoints = payload.endpoints;
    }

    const endpoints = rawEndpoints.map(normalizeEndpointItem);

    if (params.cache) {
      try {
        await params.cache.set(normalizedSlug, endpoints, OPENROUTER_ENDPOINTS_TTL_MS);
      } catch (err) {
        logger.warn(
          '[fetchOpenRouterModelEndpoints] Cache write failed',
          getSafeErrorMetadata(err),
        );
      }
    }

    return {
      ok: true,
      value: {
        model: normalizedSlug,
        endpoints,
        cached: false,
      },
    };
  } catch (err) {
    logger.error(
      '[fetchOpenRouterModelEndpoints] Failed to fetch OpenRouter endpoints',
      getSafeErrorMetadata(err),
    );
    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        status: 502,
        message: 'Failed to reach OpenRouter endpoints API.',
      },
    };
  }
}

export async function handleOpenRouterEndpointsRequest(
  req: { query?: { model?: unknown } },
  res: { status: (code: number) => { json: (body: unknown) => unknown } },
  deps: { cache?: OpenRouterCacheStore; apiKey?: string } = {},
): Promise<void> {
  const model = typeof req.query?.model === 'string' ? req.query.model : '';
  const apiKey = deps.apiKey ?? process.env.OPENROUTER_KEY ?? process.env.OPENROUTER_API_KEY;
  const result = await fetchOpenRouterModelEndpoints({
    model,
    apiKey,
    cache: deps.cache,
  });
  if (!result.ok) {
    res.status(result.error.status).json({
      error: result.error.message,
      code: result.error.code,
    });
    return;
  }
  res.status(200).json(result.value);
}
