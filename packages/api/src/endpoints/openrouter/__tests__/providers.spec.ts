import type { fetch as undiciFetch } from 'undici';
import { buildOpenRouterProviderRouting, fetchOpenRouterModelEndpoints } from '../providers';

describe('OpenRouter Provider Routing & Endpoint Proxy (Feature 2)', () => {
  it('formats price floor routing for auto or price selection', () => {
    expect(buildOpenRouterProviderRouting('auto')).toEqual({ sort: 'price' });
    expect(buildOpenRouterProviderRouting('price')).toEqual({ sort: 'price' });
    expect(buildOpenRouterProviderRouting('')).toBeUndefined();
    expect(buildOpenRouterProviderRouting(undefined)).toBeUndefined();
  });

  it('formats explicit provider order with fallback enabled', () => {
    expect(buildOpenRouterProviderRouting('Morph')).toEqual({
      order: ['Morph'],
      allow_fallbacks: true,
    });
    expect(buildOpenRouterProviderRouting('Google Vertex')).toEqual({
      order: ['Google Vertex'],
      allow_fallbacks: true,
    });
  });

  it('caches upstream OpenRouter endpoints for 10 minutes (600_000 ms)', async () => {
    const store = new Map<string, unknown>();
    const cache = {
      get: jest.fn(async (key: string) => store.get(key)),
      set: jest.fn(async (key: string, val: unknown) => {
        store.set(key, val);
        return true;
      }),
    };

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          id: 'anthropic/claude-3.7-sonnet',
          endpoints: [
            {
              name: 'Anthropic',
              tag: 'anthropic',
              context_length: 200000,
              pricing: { prompt: '0.000003', completion: '0.000015' },
              latency_last_30m: 420,
            },
          ],
        },
      }),
    }) as unknown as typeof undiciFetch;

    const first = await fetchOpenRouterModelEndpoints({
      model: 'anthropic/claude-3.7-sonnet',
      cache,
      fetchImpl: mockFetch,
    });

    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.cached).toBe(false);
      expect(first.value.endpoints).toHaveLength(1);
      expect(first.value.endpoints[0].name).toBe('Anthropic');
      expect(first.value.endpoints[0].pricing.promptPerMillion).toBeCloseTo(3, 4);
      expect(first.value.endpoints[0].pricing.prompt).toBeCloseTo(0.000003, 8);
    }
    expect(cache.set).toHaveBeenCalledWith(
      'anthropic/claude-3.7-sonnet',
      expect.any(Array),
      600_000,
    );

    const second = await fetchOpenRouterModelEndpoints({
      model: 'anthropic/claude-3.7-sonnet',
      cache,
      fetchImpl: mockFetch,
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.cached).toBe(true);
      expect(second.value.endpoints).toHaveLength(1);
    }
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
