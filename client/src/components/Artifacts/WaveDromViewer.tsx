import React, { memo, useCallback, useId, useMemo, useState } from 'react';
import { Button } from '@librechat/client';
import { Code2, Download, Eye, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export interface WaveDromSignalItem {
  name?: string;
  wave?: string;
  data?: string | string[];
  period?: number;
  phase?: number;
  node?: string;
}

export type WaveDromEntry = WaveDromSignalItem | [string, ...WaveDromEntry[]];

export interface WaveDromDoc {
  signal?: WaveDromEntry[];
  head?: {
    text?: string;
    tick?: number;
    every?: number;
  };
  foot?: {
    text?: string;
    tock?: number;
    every?: number;
  };
  config?: {
    hscale?: number;
  };
}

interface FlattenedSignal {
  group?: string;
  name: string;
  wave: string;
  data: string[];
  period: number;
  phase: number;
  isSpacer: boolean;
}

function normalizeDataField(data?: string | string[]): string[] {
  if (!data) {
    return [];
  }
  if (Array.isArray(data)) {
    return data.map((item) => String(item));
  }
  return String(data).trim().split(/\s+/);
}

function flattenSignals(entries: WaveDromEntry[], groupName?: string): FlattenedSignal[] {
  const result: FlattenedSignal[] = [];
  for (const entry of entries) {
    if (Array.isArray(entry)) {
      const [label, ...children] = entry;
      const childGroup = groupName ? `${groupName} / ${String(label)}` : String(label);
      result.push(...flattenSignals(children, childGroup));
      continue;
    }
    if (entry && typeof entry === 'object') {
      const hasWave = typeof entry.wave === 'string' && entry.wave.length > 0;
      const hasName = typeof entry.name === 'string' && entry.name.length > 0;
      result.push({
        group: groupName,
        name: entry.name ?? '',
        wave: entry.wave ?? '',
        data: normalizeDataField(entry.data),
        period: typeof entry.period === 'number' && entry.period > 0 ? entry.period : 1,
        phase: typeof entry.phase === 'number' ? entry.phase : 0,
        isSpacer: !hasWave && !hasName,
      });
    }
  }
  return result;
}

/**
 * Parses WaveJSON or relaxed JS-object-literal WaveDrom definitions (where keys or strings
 * may use single quotes or trailing commas).
 */
export function parseWaveDromSource(raw: string):
  | {
      ok: true;
      doc: WaveDromDoc;
    }
  | {
      ok: false;
      error: string;
    } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: 'Empty WaveDrom definition' };
  }

  try {
    const parsed = JSON.parse(trimmed) as WaveDromDoc;
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.signal)) {
      return { ok: true, doc: parsed };
    }
  } catch {
    // Fall back to relaxed WaveJSON normalization below
  }

  try {
    const normalized = trimmed
      // Strip single-line and block comments outside strings
      .replace(/\/\/[^\r\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Convert single-quoted strings to double-quoted strings
      .replace(
        /'([^'\\]*(?:\\.[^'\\]*)*)'/g,
        (_, inner: string) => `"${inner.replace(/"/g, '\\"')}"`,
      )
      // Quote unquoted object keys
      .replace(/([{,]\s*)([a-zA-Z_$][\w$]*)\s*:/g, '$1"$2":')
      // Strip trailing commas before } or ]
      .replace(/,\s*([}\]])/g, '$1');

    const parsed = JSON.parse(normalized) as WaveDromDoc;
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.signal)) {
      return { ok: true, doc: parsed };
    }
    return { ok: false, error: 'WaveJSON object must contain a "signal" array.' };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Invalid WaveJSON syntax',
    };
  }
}

type CycleToken = '0' | '1' | 'x' | 'z' | 'u' | 'd' | 'p' | 'P' | 'n' | 'N' | 'data';

interface ResolvedCycle {
  token: CycleToken;
  rawChar: string;
  isContinuation: boolean;
  hasGap: boolean;
  dataLabel?: string;
  colorIndex: number;
}

function classifyWaveChar(ch: string): { token: CycleToken; colorIndex: number } {
  switch (ch) {
    case '0':
    case 'l':
    case 'L':
      return { token: '0', colorIndex: 1 };
    case '1':
    case 'h':
    case 'H':
      return { token: '1', colorIndex: 1 };
    case 'x':
    case 'X':
      return { token: 'x', colorIndex: 1 };
    case 'z':
    case 'Z':
      return { token: 'z', colorIndex: 1 };
    case 'u':
      return { token: 'u', colorIndex: 1 };
    case 'd':
      return { token: 'd', colorIndex: 1 };
    case 'p':
      return { token: 'p', colorIndex: 1 };
    case 'P':
      return { token: 'P', colorIndex: 1 };
    case 'n':
      return { token: 'n', colorIndex: 1 };
    case 'N':
      return { token: 'N', colorIndex: 1 };
    case '=':
    case '2':
      return { token: 'data', colorIndex: 1 };
    case '3':
      return { token: 'data', colorIndex: 2 };
    case '4':
      return { token: 'data', colorIndex: 3 };
    case '5':
      return { token: 'data', colorIndex: 4 };
    case '6':
      return { token: 'data', colorIndex: 5 };
    case '7':
      return { token: 'data', colorIndex: 6 };
    case '8':
      return { token: 'data', colorIndex: 7 };
    case '9':
      return { token: 'data', colorIndex: 8 };
    default:
      return { token: 'z', colorIndex: 1 };
  }
}

function resolveSignalCycles(signal: FlattenedSignal): ResolvedCycle[] {
  const cycles: ResolvedCycle[] = [];
  let dataIdx = 0;
  let lastToken: CycleToken = 'z';
  let lastColor = 1;
  let lastLabel: string | undefined;

  for (let i = 0; i < signal.wave.length; i++) {
    const ch = signal.wave[i];
    const isCont = ch === '.' || ch === '|';
    const hasGap = ch === '|';

    if (isCont) {
      cycles.push({
        token: lastToken,
        rawChar: ch,
        isContinuation: true,
        hasGap,
        dataLabel: lastToken === 'data' ? lastLabel : undefined,
        colorIndex: lastColor,
      });
      continue;
    }

    const { token, colorIndex } = classifyWaveChar(ch);
    const dataLabel = token === 'data' ? (signal.data[dataIdx++] ?? '') : undefined;
    lastToken = token;
    lastColor = colorIndex;
    lastLabel = dataLabel;

    cycles.push({
      token,
      rawChar: ch,
      isContinuation: false,
      hasGap: false,
      dataLabel,
      colorIndex,
    });
  }

  return cycles;
}

const ROW_HEIGHT = 38;
const WAVE_TOP = 8;
const WAVE_MID = 19;
const WAVE_BOT = 30;
const SLEW = 4;

export interface WaveDromViewerProps {
  content: string;
  title?: string;
  inline?: boolean;
  className?: string;
}

const WaveDromViewer = memo(function WaveDromViewer({
  content,
  title,
  inline = false,
  className,
}: WaveDromViewerProps) {
  const localize = useLocalize();
  const patternId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [zoom, setZoom] = useState(1);
  const [showSource, setShowSource] = useState(false);

  const parsed = useMemo(() => parseWaveDromSource(content), [content]);

  const diagramGeometry = useMemo(() => {
    if (!parsed.ok) {
      return null;
    }
    const { doc } = parsed;
    const signals = flattenSignals(doc.signal ?? []);
    const hscale = Math.max(0.5, Math.min(4, doc.config?.hscale ?? 1));
    const baseCycleWidth = 44 * hscale * zoom;

    let maxCycles = 1;
    for (const sig of signals) {
      const len = Math.ceil(sig.wave.length * sig.period);
      if (len > maxCycles) {
        maxCycles = len;
      }
    }

    const maxLabelChars = signals.reduce((acc, sig) => {
      const full = sig.group ? `${sig.group}: ${sig.name}` : sig.name;
      return Math.max(acc, full.length);
    }, 6);

    const labelColWidth = Math.min(240, Math.max(84, maxLabelChars * 7.5 + 24));
    const headerHeight = doc.head?.text || doc.head?.tick != null ? 32 : 16;
    const footerHeight = doc.foot?.text || doc.foot?.tock != null ? 30 : 14;
    const totalWidth = labelColWidth + maxCycles * baseCycleWidth + 24;
    const totalHeight = headerHeight + signals.length * ROW_HEIGHT + footerHeight;

    return {
      doc,
      signals,
      maxCycles,
      baseCycleWidth,
      labelColWidth,
      headerHeight,
      footerHeight,
      totalWidth,
      totalHeight,
    };
  }, [parsed, zoom]);

  const handleDownloadSvg = useCallback(() => {
    const svgEl = document.getElementById(`wavedrom-svg-${patternId}`);
    if (!svgEl) {
      return;
    }
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svgEl);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (title || 'waveform').replace(/\.[^.]+$/, '');
    a.download = `${safeName}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [patternId, title]);

  if (!parsed.ok || !diagramGeometry) {
    return (
      <div
        data-testid="wavedrom-viewer-error"
        className={cn(
          'border-border-medium bg-surface-secondary text-text-primary rounded-lg border p-4 text-sm',
          className,
        )}
      >
        <div className="text-text-secondary mb-2 font-medium">
          {localize('com_ui_wavedrom_parse_error')}: {parsed.ok ? '' : parsed.error}
        </div>
        <pre className="bg-surface-primary text-text-secondary overflow-x-auto rounded p-3 font-mono text-xs">
          {content}
        </pre>
      </div>
    );
  }

  const {
    doc,
    signals,
    maxCycles,
    baseCycleWidth,
    labelColWidth,
    headerHeight,
    totalWidth,
    totalHeight,
  } = diagramGeometry;

  return (
    <div
      data-testid="wavedrom-viewer"
      className={cn(
        'border-border-light bg-surface-primary text-text-primary flex flex-col overflow-hidden rounded-lg border',
        inline ? 'my-3' : 'h-full w-full',
        className,
      )}
    >
      {/* Toolbar */}
      <div className="border-border-light bg-surface-secondary flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-text-secondary truncate text-xs font-semibold tracking-wide uppercase">
            {doc.head?.text || title || localize('com_ui_wavedrom_title')}
          </span>
          <span className="text-text-tertiary text-xs">
            ({signals.filter((s) => !s.isSpacer).length} {localize('com_ui_wavedrom_signals')} ·{' '}
            {maxCycles} {localize('com_ui_wavedrom_cycles')})
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
            aria-label={localize('com_ui_zoom_out')}
            title={localize('com_ui_zoom_out')}
          >
            <ZoomOut className="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={() => setZoom(1)}
            aria-label={localize('com_ui_reset_zoom')}
            title={localize('com_ui_reset_zoom')}
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={() => setZoom((z) => Math.min(2.5, Number((z + 0.25).toFixed(2))))}
            aria-label={localize('com_ui_zoom_in')}
            title={localize('com_ui_zoom_in')}
          >
            <ZoomIn className="size-3.5" aria-hidden="true" />
          </Button>
          {inline && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={() => setShowSource((prev) => !prev)}
              aria-label={showSource ? localize('com_ui_preview') : localize('com_ui_code')}
              title={showSource ? localize('com_ui_preview') : localize('com_ui_code')}
            >
              {showSource ? (
                <Eye className="size-3.5" aria-hidden="true" />
              ) : (
                <Code2 className="size-3.5" aria-hidden="true" />
              )}
            </Button>
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={handleDownloadSvg}
            aria-label={localize('com_ui_export_svg')}
            title={localize('com_ui_export_svg')}
          >
            <Download className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {showSource ? (
        <pre className="bg-surface-primary text-text-primary flex-1 overflow-auto p-4 font-mono text-xs">
          {content}
        </pre>
      ) : (
        <div className="flex-1 overflow-auto p-3">
          <svg
            id={`wavedrom-svg-${patternId}`}
            width={totalWidth}
            height={totalHeight}
            viewBox={`0 0 ${totalWidth} ${totalHeight}`}
            xmlns="http://www.w3.org/2000/svg"
            className="font-mono select-none"
            role="img"
            aria-label={doc.head?.text || title || localize('com_ui_wavedrom_title')}
          >
            <defs>
              <pattern
                id={`hatch-${patternId}`}
                width="6"
                height="6"
                patternTransform="rotate(45 0 0)"
                patternUnits="userSpaceOnUse"
              >
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="6"
                  stroke="currentColor"
                  strokeOpacity="0.35"
                  strokeWidth="2"
                />
              </pattern>
            </defs>

            {/* Vertical Cycle Grid Lines & Tick Labels */}
            {Array.from({ length: maxCycles + 1 }).map((_, cycleIdx) => {
              const x = labelColWidth + cycleIdx * baseCycleWidth;
              const tickStart = doc.head?.tick;
              const tockStart = doc.foot?.tock;
              const headEvery = doc.head?.every ?? 1;
              const footEvery = doc.foot?.every ?? 1;
              return (
                <g key={`grid-${cycleIdx}`}>
                  <line
                    x1={x}
                    y1={headerHeight - 4}
                    x2={x}
                    y2={headerHeight + signals.length * ROW_HEIGHT + 4}
                    stroke="currentColor"
                    strokeOpacity="0.14"
                    strokeDasharray="3,3"
                    strokeWidth="1"
                  />
                  {tickStart != null && cycleIdx < maxCycles && cycleIdx % headEvery === 0 && (
                    <text
                      x={x + baseCycleWidth / 2}
                      y={headerHeight - 8}
                      textAnchor="middle"
                      fontSize="10"
                      fill="currentColor"
                      fillOpacity="0.6"
                    >
                      {tickStart + cycleIdx}
                    </text>
                  )}
                  {tockStart != null && cycleIdx < maxCycles && cycleIdx % footEvery === 0 && (
                    <text
                      x={x + baseCycleWidth / 2}
                      y={headerHeight + signals.length * ROW_HEIGHT + 16}
                      textAnchor="middle"
                      fontSize="10"
                      fill="currentColor"
                      fillOpacity="0.6"
                    >
                      {tockStart + cycleIdx}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Signal Rows */}
            {signals.map((sig, rowIdx) => {
              const rowY = headerHeight + rowIdx * ROW_HEIGHT;
              if (sig.isSpacer) {
                return (
                  <g key={`row-${rowIdx}`} transform={`translate(0, ${rowY})`}>
                    <line
                      x1={12}
                      y1={WAVE_MID}
                      x2={totalWidth - 12}
                      y2={WAVE_MID}
                      stroke="currentColor"
                      strokeOpacity="0.1"
                    />
                  </g>
                );
              }

              const resolved = resolveSignalCycles(sig);
              const cycleW = baseCycleWidth * sig.period;
              const phaseOffset = -sig.phase * baseCycleWidth;
              const fullName = sig.group ? `${sig.group}: ${sig.name}` : sig.name;

              // Group consecutive identical data cycles into single wider envelopes
              const spans: Array<{
                startCycle: number;
                length: number;
                cycle: ResolvedCycle;
              }> = [];
              for (let i = 0; i < resolved.length; i++) {
                const cur = resolved[i];
                if (cur.isContinuation && spans.length > 0) {
                  spans[spans.length - 1].length += 1;
                  if (cur.hasGap) {
                    spans[spans.length - 1].cycle = {
                      ...spans[spans.length - 1].cycle,
                      hasGap: true,
                    };
                  }
                } else {
                  spans.push({ startCycle: i, length: 1, cycle: cur });
                }
              }

              return (
                <g key={`row-${rowIdx}`} transform={`translate(0, ${rowY})`}>
                  {/* Signal Label */}
                  <text
                    x={labelColWidth - 10}
                    y={WAVE_MID + 4}
                    textAnchor="end"
                    fontSize="12"
                    fontWeight="500"
                    fill="currentColor"
                  >
                    {fullName}
                  </text>

                  {/* Waveform Group */}
                  <g transform={`translate(${labelColWidth + phaseOffset}, 0)`}>
                    {spans.map((span, spanIdx) => {
                      const x0 = span.startCycle * cycleW;
                      const w = span.length * cycleW;
                      const x1 = x0 + w;
                      const prevSpan = spanIdx > 0 ? spans[spanIdx - 1] : null;
                      const { token, dataLabel, colorIndex, hasGap } = span.cycle;

                      if (token === '0' || token === 'd') {
                        const needEdge =
                          prevSpan != null &&
                          (prevSpan.cycle.token === '1' ||
                            prevSpan.cycle.token === 'u' ||
                            prevSpan.cycle.token === 'data' ||
                            prevSpan.cycle.token === 'z');
                        const prevY = prevSpan?.cycle.token === 'z' ? WAVE_MID : WAVE_TOP;
                        const d = needEdge
                          ? `M ${x0} ${prevY} L ${x0 + SLEW} ${WAVE_BOT} L ${x1} ${WAVE_BOT}`
                          : `M ${x0} ${WAVE_BOT} L ${x1} ${WAVE_BOT}`;
                        return (
                          <path
                            key={`span-${spanIdx}`}
                            d={d}
                            fill="none"
                            stroke="var(--series-1, currentColor)"
                            strokeWidth="1.75"
                            strokeDasharray={token === 'd' ? '4,2' : undefined}
                          />
                        );
                      }

                      if (token === '1' || token === 'u') {
                        const needEdge =
                          prevSpan != null &&
                          (prevSpan.cycle.token === '0' ||
                            prevSpan.cycle.token === 'd' ||
                            prevSpan.cycle.token === 'data' ||
                            prevSpan.cycle.token === 'z');
                        const prevY = prevSpan?.cycle.token === 'z' ? WAVE_MID : WAVE_BOT;
                        const d = needEdge
                          ? `M ${x0} ${prevY} L ${x0 + SLEW} ${WAVE_TOP} L ${x1} ${WAVE_TOP}`
                          : `M ${x0} ${WAVE_TOP} L ${x1} ${WAVE_TOP}`;
                        return (
                          <path
                            key={`span-${spanIdx}`}
                            d={d}
                            fill="none"
                            stroke="var(--series-2, currentColor)"
                            strokeWidth="1.75"
                            strokeDasharray={token === 'u' ? '4,2' : undefined}
                          />
                        );
                      }

                      if (token === 'z') {
                        return (
                          <line
                            key={`span-${spanIdx}`}
                            x1={x0}
                            y1={WAVE_MID}
                            x2={x1}
                            y2={WAVE_MID}
                            stroke="currentColor"
                            strokeOpacity="0.65"
                            strokeWidth="1.5"
                          />
                        );
                      }

                      if (token === 'x') {
                        const poly = `${x0 + SLEW},${WAVE_TOP} ${x1 - SLEW},${WAVE_TOP} ${x1},${WAVE_MID} ${x1 - SLEW},${WAVE_BOT} ${x0 + SLEW},${WAVE_BOT} ${x0},${WAVE_MID}`;
                        return (
                          <polygon
                            key={`span-${spanIdx}`}
                            points={poly}
                            fill={`url(#hatch-${patternId})`}
                            stroke="currentColor"
                            strokeOpacity="0.65"
                            strokeWidth="1.25"
                          />
                        );
                      }

                      if (token === 'p' || token === 'P' || token === 'n' || token === 'N') {
                        const isPos = token === 'p' || token === 'P';
                        const hasArrow = token === 'P' || token === 'N';
                        const subCycles: React.ReactNode[] = [];
                        for (let c = 0; c < span.length; c++) {
                          const cx0 = x0 + c * cycleW;
                          const cxMid = cx0 + cycleW / 2;
                          const cx1 = cx0 + cycleW;
                          const yStart = isPos ? WAVE_BOT : WAVE_TOP;
                          const yHigh = isPos ? WAVE_TOP : WAVE_BOT;
                          const pathD = `M ${cx0} ${yStart} L ${cx0} ${yHigh} L ${cxMid} ${yHigh} L ${cxMid} ${yStart} L ${cx1} ${yStart}`;
                          subCycles.push(
                            <g key={`clk-${spanIdx}-${c}`}>
                              <path
                                d={pathD}
                                fill="none"
                                stroke="var(--series-3, currentColor)"
                                strokeWidth="1.75"
                              />
                              {hasArrow && (
                                <polygon
                                  points={
                                    isPos
                                      ? `${cx0 - 3},${WAVE_MID + 2} ${cx0 + 3},${WAVE_MID + 2} ${cx0},${WAVE_MID - 4}`
                                      : `${cx0 - 3},${WAVE_MID - 2} ${cx0 + 3},${WAVE_MID - 2} ${cx0},${WAVE_MID + 4}`
                                  }
                                  fill="var(--series-3, currentColor)"
                                />
                              )}
                            </g>,
                          );
                        }
                        return <g key={`span-${spanIdx}`}>{subCycles}</g>;
                      }

                      // Data bus envelope
                      const poly = `${x0 + SLEW},${WAVE_TOP} ${x1 - SLEW},${WAVE_TOP} ${x1},${WAVE_MID} ${x1 - SLEW},${WAVE_BOT} ${x0 + SLEW},${WAVE_BOT} ${x0},${WAVE_MID}`;
                      const seriesVar = `var(--series-${colorIndex}, currentColor)`;
                      return (
                        <g key={`span-${spanIdx}`}>
                          <polygon
                            points={poly}
                            fill={seriesVar}
                            fillOpacity="0.16"
                            stroke={seriesVar}
                            strokeWidth="1.5"
                          />
                          {dataLabel && (
                            <text
                              x={(x0 + x1) / 2}
                              y={WAVE_MID + 4}
                              textAnchor="middle"
                              fontSize="11"
                              fontWeight="600"
                              fill="currentColor"
                            >
                              {dataLabel}
                            </text>
                          )}
                          {hasGap && (
                            <path
                              d={`M ${(x0 + x1) / 2 - 3} ${WAVE_TOP - 2} L ${(x0 + x1) / 2 - 7} ${WAVE_BOT + 2} M ${(x0 + x1) / 2 + 3} ${WAVE_TOP - 2} L ${(x0 + x1) / 2 - 1} ${WAVE_BOT + 2}`}
                              stroke="currentColor"
                              strokeWidth="1.5"
                            />
                          )}
                        </g>
                      );
                    })}
                  </g>
                </g>
              );
            })}

            {/* Footer Text */}
            {doc.foot?.text && (
              <text
                x={totalWidth / 2}
                y={totalHeight - 4}
                textAnchor="middle"
                fontSize="11"
                fill="currentColor"
                fillOpacity="0.7"
              >
                {doc.foot.text}
              </text>
            )}
          </svg>
        </div>
      )}
    </div>
  );
});

WaveDromViewer.displayName = 'WaveDromViewer';

export default WaveDromViewer;
