# Dynamic OpenRouter Provider & Live Pricing Selector

This document explains the backend proxy route, Redis/Keyv caching layer, upstream provider routing parameters, and chat header UI for dynamic OpenRouter provider selection.

---

## 1. Overview

When an OpenRouter model (e.g., `anthropic/claude-3.7-sonnet`, `deepseek/deepseek-r1`, `google/gemini-2.5-pro`) is active in the chat header, an expandable **Provider Selector** pill appears beside the model selector. It fetches live host endpoints and per-million-token pricing for the active model and lets you pin a specific provider or route to the cheapest price floor for the current conversation.

---

## 2. Backend Proxy & 10-Minute Redis Cache

### 2.1 Route Definition
- **Endpoint**: `GET /api/models/openrouter/endpoints?model=<author>/<slug>`
- **Authentication**: Protected by `requireJwtAuth` (`api/server/routes/models.js`).
- **Implementation**: `packages/api/src/endpoints/openrouter/providers.ts`

### 2.2 Upstream Fetch & Caching (`EX 600`)
1. Validates that `model` matches the `<author>/<slug>` format.
2. Checks the `OPENROUTER_ENDPOINTS` cache store (`getLogStores(CacheKeys.OPENROUTER_ENDPOINTS)`), backed by Redis when `USE_REDIS=true` (or Keyv in-memory store otherwise) under key `openrouter:endpoints:<author>/<slug>`.
3. On a cache miss, requests `https://openrouter.ai/api/v1/models/{author}/{slug}/endpoints` (including `Authorization: Bearer $OPENROUTER_KEY` when configured).
4. Normalizes each upstream provider endpoint into `TOpenRouterProviderEndpoint`:
   - `name`: Provider display name (e.g., `Morph`, `Google Vertex`, `DeepInfra`).
   - `tag`: Provider routing slug.
   - `contextLength`: Maximum context window in tokens.
   - `latencyMs` / `throughputTps`: Recent telemetry when reported by OpenRouter.
   - `pricing`: `{ prompt, completion, cacheRead, cacheWrite }` (USD per token).
5. Caches the normalized list with a **10-minute TTL (`600_000` ms / `EX 600`)** so switching conversations or reopening the menu responds instantaneously without hitting OpenRouter rate limits.

---

## 3. Upstream Request Routing (`modelKwargs.provider`)

`buildOpenRouterProviderRouting(selectedProvider)` in `packages/api/src/endpoints/openrouter/providers.ts` maps the conversation's `openRouterProvider` field into OpenRouter's `provider` request body block (`packages/api/src/endpoints/openai/llm.ts` and `packages/api/src/agents/load.ts`):

- **Auto / Price Floor (`"auto"` or `"price"`)**:
  ```json
  {
    "provider": {
      "sort": "price"
    }
  }
  ```
- **Specific Provider (e.g., `"Morph"`, `"Vertex"`)**:
  ```json
  {
    "provider": {
      "order": ["Morph"],
      "allow_fallbacks": true
    }
  }
  ```

---

## 4. Frontend Tutorial (`OpenRouterProviderSelector.tsx`)

1. Select an OpenRouter endpoint and a model in `<author>/<slug>` format in the Chat Header.
2. Click the **Provider Selector** button next to the Model Selector (`data-testid="openrouter-provider-selector"`).
3. Choose between:
   - **`Auto (Cheapest / Price Floor)`** (Default)
   - Any individual provider option showing **Name**, **Prompt/Completion pricing per 1M tokens** (e.g., `Morph — $0.12/M`), **Context limit** (`128k ctx`), and **Latency** (`42ms`).
4. The selected provider is saved on `conversation.openRouterProvider` so all subsequent turns in that conversation preserve your chosen host.
