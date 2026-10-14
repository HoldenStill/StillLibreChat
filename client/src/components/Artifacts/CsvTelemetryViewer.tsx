import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Button } from '@librechat/client';
import {
  ChevronLeft,
  ChevronRight,
  LineChart,
  RotateCcw,
  Table as TableIcon,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export interface ParsedCsvTelemetry {
  headers: string[];
  rows: string[][];
  xColumnIndex: number;
  xLabels: string[];
  series: Array<{
    name: string;
    columnIndex: number;
    values: Array<number | null>;
    min: number;
    max: number;
    colorVar: string;
    bgClass: string;
  }>;
}

const SERIES_COLORS = [
  'var(--series-1, #2563eb)',
  'var(--series-2, #0d9488)',
  'var(--series-3, #d97706)',
  'var(--series-4, #7c3aed)',
  'var(--series-5, #db2777)',
  'var(--series-6, #0891b2)',
  'var(--series-7, #65a30d)',
  'var(--series-8, #ea580c)',
];

const SERIES_BG_CLASSES = [
  'bg-series-1',
  'bg-series-2',
  'bg-series-3',
  'bg-series-4',
  'bg-series-5',
  'bg-series-6',
  'bg-series-7',
  'bg-series-8',
];

function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && ch === delimiter) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function extractRowsFromHtmlTable(html: string): string[][] {
  if (typeof DOMParser === 'undefined') {
    return [];
  }
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const trList = Array.from(doc.querySelectorAll('table tr'));
    const extracted: string[][] = [];
    for (const tr of trList) {
      const cells = Array.from(tr.querySelectorAll('th, td')).map(
        (cell) => cell.textContent?.trim() ?? '',
      );
      if (cells.length > 0 && cells.some((c) => c.length > 0)) {
        extracted.push(cells);
      }
    }
    return extracted;
  } catch {
    return [];
  }
}

export function parseCsvTelemetry(content: string): ParsedCsvTelemetry {
  const trimmed = content.trim();
  if (!trimmed) {
    return { headers: [], rows: [], xColumnIndex: 0, xLabels: [], series: [] };
  }

  let rawGrid: string[][] = [];
  if (/<table[\s>]/i.test(trimmed)) {
    rawGrid = extractRowsFromHtmlTable(trimmed);
  }

  if (rawGrid.length === 0) {
    const lines = trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) {
      return { headers: [], rows: [], xColumnIndex: 0, xLabels: [], series: [] };
    }
    const firstLine = lines[0];
    const commaCount = (firstLine.match(/,/g) ?? []).length;
    const tabCount = (firstLine.match(/\t/g) ?? []).length;
    const semiCount = (firstLine.match(/;/g) ?? []).length;
    let delimiter = ',';
    if (tabCount > commaCount && tabCount >= semiCount) {
      delimiter = '\t';
    } else if (semiCount > commaCount) {
      delimiter = ';';
    }
    rawGrid = lines.map((line) => parseCsvLine(line, delimiter));
  }

  if (rawGrid.length < 2) {
    return {
      headers: rawGrid[0] ?? [],
      rows: [],
      xColumnIndex: 0,
      xLabels: [],
      series: [],
    };
  }

  const headers = rawGrid[0];
  const rows = rawGrid.slice(1);
  const colCount = headers.length;

  // Determine numeric columns
  const numericCols: number[] = [];
  for (let col = 0; col < colCount; col++) {
    let validNums = 0;
    let nonEmpty = 0;
    for (const row of rows) {
      const rawVal = row[col]?.trim() ?? '';
      if (!rawVal) {
        continue;
      }
      nonEmpty++;
      const num = Number(rawVal);
      if (Number.isFinite(num)) {
        validNums++;
      }
    }
    if (nonEmpty > 0 && validNums / nonEmpty >= 0.6) {
      numericCols.push(col);
    }
  }

  const xColumnIndex = 0;
  const seriesCols = numericCols.filter((c) => c !== xColumnIndex || numericCols.length === 1);

  const xLabels = rows.map((row, idx) => row[xColumnIndex] || String(idx + 1));

  const series = seriesCols.map((colIdx, sIdx) => {
    let min = Infinity;
    let max = -Infinity;
    const values = rows.map((row) => {
      const rawVal = row[colIdx]?.trim() ?? '';
      if (!rawVal) {
        return null;
      }
      const num = Number(rawVal);
      if (!Number.isFinite(num)) {
        return null;
      }
      if (num < min) {
        min = num;
      }
      if (num > max) {
        max = num;
      }
      return num;
    });

    if (!Number.isFinite(min)) {
      min = 0;
    }
    if (!Number.isFinite(max)) {
      max = 1;
    }

    return {
      name: headers[colIdx] || `Series ${sIdx + 1}`,
      columnIndex: colIdx,
      values,
      min,
      max,
      colorVar: SERIES_COLORS[sIdx % SERIES_COLORS.length],
      bgClass: SERIES_BG_CLASSES[sIdx % SERIES_BG_CLASSES.length],
    };
  });

  return {
    headers,
    rows,
    xColumnIndex,
    xLabels,
    series,
  };
}

export interface CsvTelemetryViewerProps {
  content: string;
  title?: string;
  defaultView?: 'chart' | 'table';
  inline?: boolean;
  className?: string;
}

const CHART_WIDTH = 760;
const CHART_HEIGHT = 320;
const PAD_LEFT = 58;
const PAD_RIGHT = 20;
const PAD_TOP = 20;
const PAD_BOTTOM = 42;

const CsvTelemetryViewer = memo(function CsvTelemetryViewer({
  content,
  title,
  defaultView = 'chart',
  inline = false,
  className,
}: CsvTelemetryViewerProps) {
  const localize = useLocalize();
  const parsed = useMemo(() => parseCsvTelemetry(content), [content]);
  const hasNumericSeries = parsed.series.length > 0 && parsed.rows.length > 1;
  const [viewMode, setViewMode] = useState<'chart' | 'table'>(
    hasNumericSeries ? defaultView : 'table',
  );
  const [hiddenSeries, setHiddenSeries] = useState<Record<string, boolean>>({});
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const totalPoints = parsed.rows.length;
  const [windowRange, setWindowRange] = useState<[number, number]>([
    0,
    Math.max(1, totalPoints - 1),
  ]);
  const dragRef = useRef<{ startX: number; initialRange: [number, number] } | null>(null);

  // Keep windowRange clamped to totalPoints
  const startIdx = Math.max(0, Math.min(windowRange[0], Math.max(0, totalPoints - 2)));
  const endIdx = Math.max(
    startIdx + 1,
    Math.min(
      windowRange[1] >= totalPoints || windowRange[1] <= startIdx
        ? totalPoints - 1
        : windowRange[1],
      totalPoints - 1,
    ),
  );
  const visibleCount = endIdx - startIdx + 1;

  const handleZoom = useCallback(
    (factor: number) => {
      if (totalPoints <= 2) {
        return;
      }
      const center = (startIdx + endIdx) / 2;
      const newSpan = Math.max(
        2,
        Math.min(totalPoints - 1, Math.round((endIdx - startIdx) * factor)),
      );
      let nextStart = Math.round(center - newSpan / 2);
      let nextEnd = nextStart + newSpan;
      if (nextStart < 0) {
        nextEnd -= nextStart;
        nextStart = 0;
      }
      if (nextEnd >= totalPoints) {
        nextStart -= nextEnd - (totalPoints - 1);
        nextEnd = totalPoints - 1;
      }
      setWindowRange([Math.max(0, nextStart), Math.min(totalPoints - 1, nextEnd)]);
    },
    [endIdx, startIdx, totalPoints],
  );

  const handlePan = useCallback(
    (deltaPoints: number) => {
      const span = endIdx - startIdx;
      let nextStart = startIdx + deltaPoints;
      let nextEnd = endIdx + deltaPoints;
      if (nextStart < 0) {
        nextStart = 0;
        nextEnd = span;
      }
      if (nextEnd >= totalPoints) {
        nextEnd = totalPoints - 1;
        nextStart = Math.max(0, nextEnd - span);
      }
      setWindowRange([nextStart, nextEnd]);
    },
    [endIdx, startIdx, totalPoints],
  );

  const handleResetZoom = useCallback(() => {
    setWindowRange([0, Math.max(1, totalPoints - 1)]);
  }, [totalPoints]);

  const toggleSeries = useCallback((name: string) => {
    setHiddenSeries((prev) => ({ ...prev, [name]: !prev[name] }));
  }, []);

  const visibleSeries = useMemo(
    () => parsed.series.filter((s) => !hiddenSeries[s.name]),
    [hiddenSeries, parsed.series],
  );

  const { yMin, yMax } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const s of visibleSeries) {
      for (let i = startIdx; i <= endIdx; i++) {
        const v = s.values[i];
        if (v != null) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { yMin: 0, yMax: 1 };
    }
    if (min === max) {
      return { yMin: min - 1, yMax: max + 1 };
    }
    const pad = (max - min) * 0.06;
    return { yMin: min - pad, yMax: max + pad };
  }, [endIdx, startIdx, visibleSeries]);

  const plotW = CHART_WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;

  const xForIndex = useCallback(
    (idx: number) => {
      if (endIdx <= startIdx) {
        return PAD_LEFT;
      }
      return PAD_LEFT + ((idx - startIdx) / (endIdx - startIdx)) * plotW;
    },
    [endIdx, plotW, startIdx],
  );

  const yForValue = useCallback(
    (val: number) => {
      return PAD_TOP + plotH - ((val - yMin) / (yMax - yMin)) * plotH;
    },
    [plotH, yMax, yMin],
  );

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current = { startX: e.clientX, initialRange: [startIdx, endIdx] };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * CHART_WIDTH;

    if (dragRef.current) {
      const dxPx = e.clientX - dragRef.current.startX;
      const [initStart, initEnd] = dragRef.current.initialRange;
      const span = initEnd - initStart;
      const deltaIdx = Math.round((-dxPx / Math.max(1, rect.width)) * span);
      let nextStart = initStart + deltaIdx;
      let nextEnd = initEnd + deltaIdx;
      if (nextStart < 0) {
        nextStart = 0;
        nextEnd = span;
      }
      if (nextEnd >= totalPoints) {
        nextEnd = totalPoints - 1;
        nextStart = Math.max(0, nextEnd - span);
      }
      setWindowRange([nextStart, nextEnd]);
      return;
    }

    if (relX < PAD_LEFT || relX > CHART_WIDTH - PAD_RIGHT) {
      setHoverIdx(null);
      return;
    }
    const ratio = (relX - PAD_LEFT) / plotW;
    const idx = Math.round(startIdx + ratio * (endIdx - startIdx));
    if (idx >= startIdx && idx <= endIdx) {
      setHoverIdx(idx);
    }
  };

  const handleSvgPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragRef.current) {
      dragRef.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    handleZoom(e.deltaY < 0 ? 0.75 : 1.35);
  };

  return (
    <div
      data-testid="csv-telemetry-viewer"
      className={cn(
        'border-border-light bg-surface-primary text-text-primary flex flex-col overflow-hidden rounded-lg border',
        inline ? 'my-3' : 'h-full w-full',
        className,
      )}
    >
      {/* Top Toolbar */}
      <div className="border-border-light bg-surface-secondary flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-text-secondary truncate text-xs font-semibold tracking-wide uppercase">
            {title || localize('com_ui_csv_telemetry_title')}
          </span>
          <span className="text-text-tertiary text-xs">
            ({parsed.rows.length} {localize('com_ui_csv_rows')})
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {hasNumericSeries && (
            <div
              role="group"
              aria-label={localize('com_ui_csv_view_mode')}
              className="border-border-light bg-surface-primary flex items-center rounded-md border p-0.5"
            >
              <button
                type="button"
                data-testid="csv-toggle-chart"
                aria-pressed={viewMode === 'chart'}
                onClick={() => setViewMode('chart')}
                className={cn(
                  'flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                  viewMode === 'chart'
                    ? 'bg-surface-active text-text-primary'
                    : 'text-text-secondary hover:text-text-primary',
                )}
              >
                <LineChart className="size-3.5" aria-hidden="true" />
                <span>{localize('com_ui_csv_chart_view')}</span>
              </button>
              <button
                type="button"
                data-testid="csv-toggle-table"
                aria-pressed={viewMode === 'table'}
                onClick={() => setViewMode('table')}
                className={cn(
                  'flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                  viewMode === 'table'
                    ? 'bg-surface-active text-text-primary'
                    : 'text-text-secondary hover:text-text-primary',
                )}
              >
                <TableIcon className="size-3.5" aria-hidden="true" />
                <span>{localize('com_ui_csv_table_view')}</span>
              </button>
            </div>
          )}

          {viewMode === 'chart' && hasNumericSeries && (
            <div className="flex items-center gap-0.5">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                onClick={() => handlePan(-Math.max(1, Math.round(visibleCount * 0.25)))}
                disabled={startIdx === 0}
                aria-label={localize('com_ui_pan_left')}
                title={localize('com_ui_pan_left')}
              >
                <ChevronLeft className="size-3.5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                onClick={() => handleZoom(0.7)}
                aria-label={localize('com_ui_zoom_in')}
                title={localize('com_ui_zoom_in')}
              >
                <ZoomIn className="size-3.5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                onClick={() => handleZoom(1.4)}
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
                onClick={handleResetZoom}
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
                onClick={() => handlePan(Math.max(1, Math.round(visibleCount * 0.25)))}
                disabled={endIdx >= totalPoints - 1}
                aria-label={localize('com_ui_pan_right')}
                title={localize('com_ui_pan_right')}
              >
                <ChevronRight className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {viewMode === 'chart' && hasNumericSeries ? (
        <div className="flex flex-1 flex-col gap-2 overflow-auto p-3">
          {/* Interactive Series Legend */}
          <div className="flex flex-wrap items-center gap-1.5">
            {parsed.series.map((s) => {
              const isHidden = Boolean(hiddenSeries[s.name]);
              return (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => toggleSeries(s.name)}
                  aria-pressed={!isHidden}
                  className={cn(
                    'border-border-light inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-opacity',
                    isHidden
                      ? 'bg-surface-secondary text-text-tertiary opacity-50'
                      : 'bg-surface-secondary text-text-primary font-medium',
                  )}
                >
                  <span className={cn('size-2 rounded-full', s.bgClass)} aria-hidden="true" />
                  <span>{s.name}</span>
                </button>
              );
            })}
            <span className="text-text-tertiary ml-auto text-xs">
              {localize('com_ui_csv_window_range', {
                0: String(startIdx + 1),
                1: String(endIdx + 1),
                2: String(totalPoints),
              })}
            </span>
          </div>

          {/* Interactive SVG Line Chart */}
          <div className="relative min-h-[260px] w-full flex-1">
            <svg
              viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
              className="h-full w-full cursor-grab select-none active:cursor-grabbing"
              onPointerDown={handleSvgPointerDown}
              onPointerMove={handleSvgPointerMove}
              onPointerUp={handleSvgPointerUp}
              onPointerLeave={() => setHoverIdx(null)}
              onWheel={handleWheel}
              role="img"
              aria-label={title || localize('com_ui_csv_telemetry_title')}
            >
              {/* Horizontal Y Grid Lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
                const val = yMin + tick * (yMax - yMin);
                const y = yForValue(val);
                return (
                  <g key={`y-${tick}`}>
                    <line
                      x1={PAD_LEFT}
                      y1={y}
                      x2={CHART_WIDTH - PAD_RIGHT}
                      y2={y}
                      stroke="currentColor"
                      strokeOpacity="0.12"
                      strokeDasharray="3,3"
                    />
                    <text
                      x={PAD_LEFT - 8}
                      y={y + 4}
                      textAnchor="end"
                      fontSize="10"
                      fill="currentColor"
                      fillOpacity="0.65"
                    >
                      {Math.abs(val) >= 1000 || (Math.abs(val) > 0 && Math.abs(val) < 0.01)
                        ? val.toExponential(1)
                        : Number(val.toFixed(2))}
                    </text>
                  </g>
                );
              })}

              {/* X-Axis Labels */}
              {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
                const idx = Math.round(startIdx + tick * (endIdx - startIdx));
                const x = xForIndex(idx);
                const label = parsed.xLabels[idx] ?? String(idx + 1);
                return (
                  <text
                    key={`x-${tick}-${idx}`}
                    x={x}
                    y={CHART_HEIGHT - 12}
                    textAnchor="middle"
                    fontSize="10"
                    fill="currentColor"
                    fillOpacity="0.65"
                  >
                    {label.length > 14 ? `${label.slice(0, 12)}…` : label}
                  </text>
                );
              })}

              {/* Series Polylines */}
              {visibleSeries.map((s) => {
                const segments: string[] = [];
                let openPath = false;
                for (let i = startIdx; i <= endIdx; i++) {
                  const v = s.values[i];
                  if (v == null) {
                    openPath = false;
                    continue;
                  }
                  const x = xForIndex(i).toFixed(1);
                  const y = yForValue(v).toFixed(1);
                  segments.push(`${openPath ? 'L' : 'M'} ${x} ${y}`);
                  openPath = true;
                }
                if (segments.length === 0) {
                  return null;
                }
                return (
                  <path
                    key={`line-${s.name}`}
                    d={segments.join(' ')}
                    fill="none"
                    stroke={s.colorVar}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                );
              })}

              {/* Hover Crosshair & Points */}
              {hoverIdx != null && hoverIdx >= startIdx && hoverIdx <= endIdx && (
                <g>
                  <line
                    x1={xForIndex(hoverIdx)}
                    y1={PAD_TOP}
                    x2={xForIndex(hoverIdx)}
                    y2={CHART_HEIGHT - PAD_BOTTOM}
                    stroke="currentColor"
                    strokeOpacity="0.35"
                    strokeDasharray="2,2"
                  />
                  {visibleSeries.map((s) => {
                    const v = s.values[hoverIdx];
                    if (v == null) return null;
                    return (
                      <circle
                        key={`pt-${s.name}`}
                        cx={xForIndex(hoverIdx)}
                        cy={yForValue(v)}
                        r="4"
                        fill={s.colorVar}
                        stroke="var(--surface-primary, #fff)"
                        strokeWidth="1.5"
                      />
                    );
                  })}
                </g>
              )}
            </svg>

            {/* Hover Readout Bar */}
            {hoverIdx != null && (
              <div className="border-border-light bg-surface-secondary/95 text-text-primary pointer-events-none absolute top-2 right-3 flex flex-wrap items-center gap-3 rounded-md border px-2.5 py-1 text-xs shadow-sm">
                <span className="text-text-secondary font-medium">
                  {parsed.headers[parsed.xColumnIndex] || 'X'}: {parsed.xLabels[hoverIdx]}
                </span>
                {visibleSeries.map((s) => {
                  const v = s.values[hoverIdx];
                  if (v == null) return null;
                  return (
                    <span
                      key={`readout-${s.name}`}
                      className="inline-flex items-center gap-1 font-mono"
                    >
                      <span className={cn('size-2 rounded-full', s.bgClass)} />
                      <span>
                        {s.name}: {v}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Table View */
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="border-border-light bg-surface-secondary text-text-secondary sticky top-0 border-b">
              <tr>
                {parsed.headers.map((h, idx) => (
                  <th key={`th-${idx}`} className="px-3 py-2 font-semibold whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-border-light divide-y">
              {parsed.rows.slice(0, 500).map((row, rIdx) => (
                <tr key={`tr-${rIdx}`} className="hover:bg-surface-hover/50">
                  {parsed.headers.map((_, cIdx) => (
                    <td
                      key={`td-${rIdx}-${cIdx}`}
                      className="px-3 py-1.5 font-mono whitespace-nowrap"
                    >
                      {row[cIdx] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
});

CsvTelemetryViewer.displayName = 'CsvTelemetryViewer';

export default CsvTelemetryViewer;
