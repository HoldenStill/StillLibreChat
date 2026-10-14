import React, { memo, useMemo } from 'react';
import { Zap } from 'lucide-react';
import { useAtomValue } from 'jotai';
import { TooltipAnchor } from '@librechat/client';
import type { TMessage } from 'librechat-data-provider';
import { showMessageCostAtom } from '~/store/showMessageCost';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export function formatMessageCost(cost?: number | null): string {
  if (cost == null || !Number.isFinite(cost) || cost <= 0) {
    return '$0.0000';
  }
  if (cost < 0.001) {
    return '<$0.001';
  }
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  const fixed4 = cost.toFixed(4);
  const trimmed = fixed4.replace(/0+$/, '');
  const parts = trimmed.split('.');
  const decimals = parts[1] ?? '';
  if (decimals.length < 2) {
    return `$${cost.toFixed(2)}`;
  }
  return `$${trimmed}`;
}

export function formatCompactTokens(tokens?: number | null): string {
  const count = Number(tokens) || 0;
  if (count <= 0) {
    return '0';
  }
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (count >= 10_000) {
    return `${Math.round(count / 1_000)}k`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return `${Math.round(count)}`;
}

export const formatTokenCount = formatCompactTokens;

interface MessageMetadataUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
}

interface MessageCostBadgeProps {
  message?: TMessage | null;
  className?: string;
}

const MessageCostBadge: React.FC<MessageCostBadgeProps> = ({ message, className }) => {
  const localize = useLocalize();
  const showMessageCost = useAtomValue(showMessageCostAtom);

  const telemetry = useMemo(() => {
    if (!message || message.isCreatedByUser === true) {
      return null;
    }

    const tu = message.tokenUsage;
    const metaUsage = message.metadata?.usage as MessageMetadataUsage | undefined;

    if (!tu && !metaUsage && message.cost == null) {
      return null;
    }

    const promptTokens =
      tu?.promptTokens ??
      (metaUsage
        ? (metaUsage.input ?? 0) + (metaUsage.cacheRead ?? 0) + (metaUsage.cacheWrite ?? 0)
        : 0);
    const completionTokens = tu?.completionTokens ?? metaUsage?.output ?? message.tokenCount ?? 0;
    const totalTokens = tu?.totalTokens ?? promptTokens + completionTokens;
    const cachedTokens = tu?.cachedTokens ?? metaUsage?.cacheRead ?? 0;
    const cacheHit = message.cacheHit ?? cachedTokens > 0;
    const cost = message.cost ?? metaUsage?.cost ?? 0;

    if (totalTokens <= 0 && cost <= 0 && message.cost == null && !tu) {
      return null;
    }

    return {
      cost,
      promptTokens,
      completionTokens,
      totalTokens,
      cachedTokens,
      cacheHit,
      inputCost: tu?.inputCost,
      outputCost: tu?.outputCost,
      cacheSavings: tu?.cacheSavings,
    };
  }, [message]);

  if (!showMessageCost || !telemetry) {
    return null;
  }

  const formattedCost = formatMessageCost(telemetry.cost);
  const formattedIn = formatCompactTokens(telemetry.promptTokens);
  const formattedOut = formatCompactTokens(telemetry.completionTokens);

  const cacheStatusText = telemetry.cacheHit
    ? localize('com_ui_cost_cache_hit')
    : localize('com_ui_cost_cache_miss');

  const breakdownLines: string[] = [
    `${localize('com_ui_cost_total')}: ${
      telemetry.cost > 0 ? `$${telemetry.cost.toFixed(6)}` : '$0.000000'
    }`,
    `${localize('com_ui_cost_input')}: ${
      telemetry.inputCost != null ? `$${telemetry.inputCost.toFixed(6)}` : formattedCost
    } (${telemetry.promptTokens.toLocaleString()} tok)`,
    `${localize('com_ui_cost_output')}: ${
      telemetry.outputCost != null ? `$${telemetry.outputCost.toFixed(6)}` : '$0.000000'
    } (${telemetry.completionTokens.toLocaleString()} tok)`,
  ];

  if (telemetry.cacheHit) {
    const savingsStr =
      telemetry.cacheSavings != null && telemetry.cacheSavings > 0
        ? ` (-$${telemetry.cacheSavings.toFixed(6)})`
        : '';
    breakdownLines.push(
      `${cacheStatusText}: ${telemetry.cachedTokens.toLocaleString()} tok${savingsStr}`,
    );
  } else {
    breakdownLines.push(cacheStatusText);
  }

  const tooltipDescription = breakdownLines.join(' · ');
  const tokensInOutText = localize('com_ui_cost_tokens_in_out', {
    0: formattedIn,
    1: formattedOut,
  });

  return (
    <TooltipAnchor
      description={tooltipDescription}
      render={
        <div
          data-testid="message-cost-badge"
          tabIndex={0}
          role="status"
          aria-label={tooltipDescription}
          className={cn(
            'border-border-light bg-surface-secondary text-text-secondary hover:border-border-medium hover:text-text-primary focus-visible:ring-focus-control ml-1 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-xs leading-tight transition-colors focus-visible:ring-2 focus-visible:outline-hidden',
            className,
          )}
        >
          <Zap
            data-testid="message-cache-indicator"
            aria-label={cacheStatusText}
            className={cn(
              'size-3 shrink-0 transition-colors',
              telemetry.cacheHit ? 'text-status-success fill-current' : 'text-text-tertiary',
            )}
            strokeWidth={telemetry.cacheHit ? 2 : 1.5}
          />
          <span className="text-text-primary font-medium">{formattedCost}</span>
          <span className="text-text-tertiary" aria-hidden="true">
            ·
          </span>
          <span>{tokensInOutText}</span>
        </div>
      }
    />
  );
};

export default memo(MessageCostBadge);
