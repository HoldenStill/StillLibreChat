import React, { memo, useCallback, useId, useMemo, useRef, useState } from 'react';
import * as Ariakit from '@ariakit/react';
import { DropdownPopup, TooltipAnchor } from '@librechat/client';
import { Check, ChevronDown, LoaderCircle, Server, Sparkles } from 'lucide-react';
import type { TOpenRouterProviderEndpoint } from 'librechat-data-provider';
import type { MenuItemProps } from '~/common';
import { useGetOpenRouterEndpointsQuery } from '~/data-provider';
import { useChatContext } from '~/Providers';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const AUTO_PROVIDER_VALUE = 'auto';

export function isOpenRouterModelActive(
  conversation?: {
    conversationId?: string | null;
    model?: string | null;
    endpoint?: string | null;
    endpointType?: string | null;
    spec?: string | null;
  } | null,
): boolean {
  if (!conversation) {
    return false;
  }
  const model = conversation.model?.trim() ?? '';
  if (!model.includes('/')) {
    return false;
  }
  const endpoint = (conversation.endpoint ?? '').toLowerCase();
  const endpointType = (conversation.endpointType ?? '').toLowerCase();
  const spec = (conversation.spec ?? '').toLowerCase();
  return (
    endpoint.includes('openrouter') ||
    endpointType.includes('openrouter') ||
    spec.includes('openrouter') ||
    endpointType === 'custom' ||
    endpoint === 'openai'
  );
}

export function formatPerMillionRate(
  perTokenRate?: number | null,
  perMillionOverride?: number | null,
): string {
  const perMillion =
    perMillionOverride != null && Number.isFinite(perMillionOverride) && perMillionOverride > 0
      ? perMillionOverride
      : (Number(perTokenRate) || 0) * 1_000_000;
  if (!Number.isFinite(perMillion) || perMillion <= 0) {
    return '$0.00/M';
  }
  if (perMillion < 0.01) {
    return `$${perMillion.toFixed(4)}/M`;
  }
  return `$${perMillion.toFixed(2)}/M`;
}

export function formatProviderOptionLabel(provider: TOpenRouterProviderEndpoint): string {
  const promptRate = formatPerMillionRate(
    provider.pricing.prompt,
    provider.pricing.promptPerMillion,
  );
  const completionRate = formatPerMillionRate(
    provider.pricing.completion,
    provider.pricing.completionPerMillion,
  );
  const priceText =
    promptRate === completionRate
      ? promptRate
      : `${promptRate.replace('/M', '')}/${completionRate}`;

  const parts = [`${provider.name} — ${priceText}`];
  if (provider.contextLength != null && provider.contextLength > 0) {
    const kCtx = Math.round(provider.contextLength / 1000);
    parts.push(`${kCtx}k ctx`);
  }
  if (provider.latencyMs != null && provider.latencyMs > 0) {
    parts.push(`${Math.round(provider.latencyMs)}ms`);
  }
  return parts.join(' · ');
}

function OpenRouterProviderSelector() {
  const localize = useLocalize();
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const { conversation, setConversation } = useChatContext();

  const isActive = isOpenRouterModelActive(conversation);
  const modelSlug = isActive ? (conversation?.model?.trim() ?? '') : '';
  const selectedProvider = conversation?.openRouterProvider?.trim() || AUTO_PROVIDER_VALUE;

  const { data, isLoading, isError } = useGetOpenRouterEndpointsQuery(modelSlug, {
    enabled: isActive && modelSlug.length > 0,
  });

  const handleSelectProvider = useCallback(
    (nextProvider: string) => {
      setConversation((prev) => {
        if (!prev) {
          return prev;
        }
        return {
          ...prev,
          openRouterProvider: nextProvider,
        };
      });
    },
    [setConversation],
  );

  const endpoints = useMemo(() => data?.endpoints ?? [], [data?.endpoints]);

  const activeProviderDisplay = useMemo(() => {
    if (selectedProvider === AUTO_PROVIDER_VALUE || selectedProvider === 'price') {
      return localize('com_ui_openrouter_provider_auto_short');
    }
    const matched = endpoints.find(
      (ep) =>
        ep.tag?.toLowerCase() === selectedProvider.toLowerCase() ||
        ep.name.toLowerCase() === selectedProvider.toLowerCase(),
    );
    if (matched) {
      return `${matched.name} (${formatPerMillionRate(
        matched.pricing.prompt,
        matched.pricing.promptPerMillion,
      )})`;
    }
    return selectedProvider;
  }, [endpoints, localize, selectedProvider]);

  const items = useMemo<MenuItemProps[]>(() => {
    const isAutoSelected = selectedProvider === AUTO_PROVIDER_VALUE || selectedProvider === 'price';
    const list: MenuItemProps[] = [
      {
        id: 'openrouter-provider-auto',
        label: localize('com_ui_openrouter_provider_auto'),
        ariaChecked: isAutoSelected,
        className: isAutoSelected ? 'bg-surface-active font-medium' : undefined,
        icon: isAutoSelected ? (
          <Check className="text-text-primary size-4" />
        ) : (
          <Sparkles className="text-text-secondary size-4" />
        ),
        onClick: () => handleSelectProvider(AUTO_PROVIDER_VALUE),
      },
    ];

    if (isLoading) {
      list.push({
        id: 'openrouter-provider-loading',
        label: localize('com_ui_openrouter_provider_loading'),
        disabled: true,
        icon: <LoaderCircle className="text-text-secondary size-4 animate-spin" />,
      });
      return list;
    }

    if (isError) {
      list.push({
        id: 'openrouter-provider-error',
        label: localize('com_ui_openrouter_provider_error'),
        disabled: true,
        icon: <Server className="text-text-secondary size-4" />,
      });
      return list;
    }

    if (endpoints.length > 0) {
      list.push({ separate: true });
      for (const provider of endpoints) {
        const providerKey = provider.tag || provider.name;
        const isSelected = selectedProvider.toLowerCase() === providerKey.toLowerCase();
        list.push({
          id: `openrouter-provider-${providerKey}`,
          label: formatProviderOptionLabel(provider),
          ariaChecked: isSelected,
          className: isSelected ? 'bg-surface-active font-medium' : undefined,
          icon: isSelected ? (
            <Check className="text-text-primary size-4" />
          ) : (
            <Server className="text-text-secondary size-4" />
          ),
          onClick: () => handleSelectProvider(providerKey),
        });
      }
    }

    return list;
  }, [endpoints, handleSelectProvider, isError, isLoading, localize, selectedProvider]);

  if (!isActive) {
    return null;
  }

  const label = localize('com_ui_openrouter_provider_selector');

  return (
    <DropdownPopup
      portal
      focusLoop
      unmountOnHide
      menuId={menuId}
      finalFocus={triggerRef}
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      items={items}
      minWidth="18rem"
      className="max-h-80 overflow-y-auto"
      trigger={
        <TooltipAnchor
          description={label}
          render={
            <Ariakit.MenuButton
              ref={triggerRef}
              data-testid="openrouter-provider-selector"
              aria-label={label}
              aria-expanded={isOpen}
              className={cn(
                'border-border-chrome bg-presentation text-text-primary hover:bg-surface-active-alt',
                'rounded-theme-control my-1 flex h-9 shrink-0 items-center gap-1.5 border px-2.5 py-1.5 text-xs font-medium transition-colors',
              )}
            >
              <Server className="text-text-secondary size-3.5 shrink-0" aria-hidden="true" />
              <span className="max-w-[10rem] truncate">{activeProviderDisplay}</span>
              <ChevronDown className="text-text-tertiary size-3.5 shrink-0" aria-hidden="true" />
            </Ariakit.MenuButton>
          }
        />
      }
    />
  );
}

export default memo(OpenRouterProviderSelector);
