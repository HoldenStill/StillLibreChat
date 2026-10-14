import {
  formatPerMillionRate,
  formatProviderOptionLabel,
  isOpenRouterModelActive,
} from '~/components/Chat/Menus/OpenRouterProviderSelector';
import {
  formatMessageCost,
  formatTokenCount,
} from '~/components/Chat/Messages/ui/MessageCostBadge';
import { isCsvArtifact, isWaveDromArtifactType } from '~/utils/artifacts';
import { parseCsvTelemetry } from '../CsvTelemetryViewer';
import { parseWaveDromSource } from '../WaveDromViewer';

describe('Custom Features Frontend Unit Suite (Features 1, 2, 5)', () => {
  describe('Feature 1: Message Cost & Token Formatting', () => {
    it('formats USD costs accurately', () => {
      expect(formatMessageCost(0)).toBe('$0.0000');
      expect(formatMessageCost(0.00025)).toBe('<$0.001');
      expect(formatMessageCost(0.00314)).toBe('$0.0031');
      expect(formatMessageCost(0.145)).toBe('$0.145');
      expect(formatMessageCost(1.5)).toBe('$1.50');
    });

    it('formats token counts cleanly', () => {
      expect(formatTokenCount(340)).toBe('340');
      expect(formatTokenCount(1200)).toBe('1.2k');
      expect(formatTokenCount(15400)).toBe('15k');
    });
  });

  describe('Feature 2: OpenRouter Provider Selector Helpers', () => {
    it('detects active OpenRouter models', () => {
      expect(
        isOpenRouterModelActive({
          conversationId: 'c1',
          endpoint: 'OpenRouter',
          model: 'anthropic/claude-3.7-sonnet',
        }),
      ).toBe(true);
      expect(
        isOpenRouterModelActive({
          conversationId: 'c2',
          endpoint: 'anthropic',
          model: 'claude-3-5-sonnet-latest',
        }),
      ).toBe(false);
    });

    it('formats per-million rates and provider option labels', () => {
      expect(formatPerMillionRate(0.00000012)).toBe('$0.12/M');
      const label = formatProviderOptionLabel({
        name: 'Morph',
        contextLength: 128000,
        latencyMs: 42,
        pricing: {
          prompt: 0.00000012,
          completion: 0.00000012,
        },
      });
      expect(label).toContain('Morph — $0.12/M');
      expect(label).toContain('128k ctx');
      expect(label).toContain('42ms');
    });
  });

  describe('Feature 5: WaveDrom & CSV Telemetry Parsers', () => {
    it('identifies WaveDrom and CSV artifact types', () => {
      expect(isWaveDromArtifactType('application/vnd.wavedrom')).toBe(true);
      expect(isWaveDromArtifactType('wavejson')).toBe(true);
      expect(isCsvArtifact({ type: 'text/csv', title: 'data.csv' })).toBe(true);
      expect(
        isCsvArtifact({
          type: 'application/vnd.librechat.spreadsheet-preview',
          title: 'telemetry.csv',
        }),
      ).toBe(true);
    });

    it('parses both strict JSON and relaxed WaveJSON syntax', () => {
      const relaxed = `{ signal: [ { name: 'clk', wave: 'p....' }, { name: 'mosi', wave: 'x.==x', data: ['CMD', 'DATA'], } ] }`;
      const res = parseWaveDromSource(relaxed);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.doc.signal).toHaveLength(2);
      }
    });

    it('parses CSV telemetry into time-series numeric channels', () => {
      const csv = 'timestamp,voltage,current\n0.0,3.30,0.12\n0.1,3.29,0.15\n0.2,3.31,0.14';
      const parsed = parseCsvTelemetry(csv);
      expect(parsed.headers).toEqual(['timestamp', 'voltage', 'current']);
      expect(parsed.rows).toHaveLength(3);
      expect(parsed.series.length).toBeGreaterThanOrEqual(2);
    });
  });
});
