import { buildMessageTelemetry, computeUsageCostUSD } from '../usage';

describe('Message Telemetry & Cost Calculation (Feature 1)', () => {
  const pricing = {
    getMultiplier: ({ tokenType }: { tokenType?: 'prompt' | 'completion' }) => {
      if (tokenType === 'prompt') {
        return 3.0; // $3.00 per 1M
      }
      if (tokenType === 'completion') {
        return 15.0; // $15.00 per 1M
      }
      return 0;
    },
    getCacheMultiplier: ({ cacheType }: { cacheType?: 'write' | 'read' }) => {
      if (cacheType === 'read') {
        return 0.3; // $0.30 per 1M
      }
      if (cacheType === 'write') {
        return 3.75;
      }
      return null;
    },
  };

  it('prefers direct provider cost when reported in usage metadata', () => {
    const cost = computeUsageCostUSD(
      {
        input_tokens: 1000,
        output_tokens: 500,
        cost: 0.004215,
      },
      pricing,
    );
    expect(cost).toBeCloseTo(0.004215, 6);
  });

  it('builds complete message telemetry with cache hit and cache savings', () => {
    const telemetry = buildMessageTelemetry({
      collectedUsage: [
        {
          model: 'anthropic/claude-3.7-sonnet',
          input_tokens: 2000,
          output_tokens: 400,
          input_token_details: {
            cache_read: 1500,
            cache_creation: 0,
          },
        },
      ],
      pricing,
    });

    expect(telemetry).toBeDefined();
    expect(telemetry?.cacheHit).toBe(true);
    expect(telemetry?.tokenUsage.promptTokens).toBeGreaterThanOrEqual(2000);
    expect(telemetry?.tokenUsage.completionTokens).toBe(400);
    expect(telemetry?.tokenUsage.cachedTokens).toBe(1500);
    expect(telemetry?.tokenUsage.cacheSavings).toBeGreaterThan(0);
    expect(telemetry?.cost).toBeGreaterThan(0);
  });

  it('marks cacheHit false when cachedTokens is 0', () => {
    const telemetry = buildMessageTelemetry({
      collectedUsage: [
        {
          model: 'openai/gpt-4o',
          input_tokens: 500,
          output_tokens: 200,
        },
      ],
      pricing,
    });

    expect(telemetry).toBeDefined();
    expect(telemetry?.cacheHit).toBe(false);
    expect(telemetry?.tokenUsage.cachedTokens).toBeUndefined();
  });
});
