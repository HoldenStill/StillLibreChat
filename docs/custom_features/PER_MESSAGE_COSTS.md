# Granular Per-Message Cost, Token Tracking & Cache Warmth Indicator

This document details the architecture, calculation pipeline, MongoDB persistence schema, and frontend UI controls for per-message telemetry in this LibreChat fork.

---

## 1. Overview

Every assistant response turn captures and persists:
- **`cost`**: Total turn cost in USD (up to 6 decimal places, e.g., `$0.003142` or `<$0.001`).
- **`tokenUsage`**:
  - `promptTokens`: Total input/prompt tokens billed for the turn.
  - `completionTokens`: Total output/completion tokens generated.
  - `totalTokens`: Combined prompt + completion tokens.
  - `cachedTokens`: Prompt tokens served from provider prompt cache (`cache_read` / `cached_tokens`).
  - `cacheWriteTokens`: Tokens written into prompt cache (`cache_creation` / `cache_write_tokens`).
  - `inputCost`: USD cost of prompt tokens.
  - `outputCost`: USD cost of completion tokens.
  - `cacheSavings`: Estimated USD saved by serving `cachedTokens` at the cached read rate instead of the standard prompt rate.
- **`cacheHit`**: Boolean flag set to `true` whenever `cachedTokens > 0`.

Older messages stored in MongoDB without these fields load with graceful `undefined` fallbacks and do not render empty badges.

---

## 2. Backend Extraction & Calculation Logic

### 2.1 Stream Completion Interceptor (`api/server/controllers/agents/callbacks.js`)
During streaming turn completion, `ModelEndHandler` inspects the provider's usage payload (`output.usage_metadata` and raw OpenRouter `output.response_metadata.usage`):
- Extracts `prompt_tokens_details.cached_tokens` and `prompt_tokens_details.cache_write_tokens` when using OpenRouter or OpenAI-compatible endpoints and normalizes them into `input_token_details.cache_read` and `input_token_details.cache_creation`.
- Extracts direct USD `cost` when reported by OpenRouter (`response.usage.cost`).

### 2.2 Telemetry Computation (`packages/api/src/agents/usage.ts`)
`buildMessageTelemetry(collectedUsage, { getMultiplier, getCacheMultiplier })` aggregates token counts and costs across all model invocations in the turn (including tool-calling loops):
1. **Direct Provider Cost**: If OpenRouter reports `usage.cost` directly, that exact USD figure is recorded.
2. **Rate-Based Fallback**: Otherwise, cost is computed from LibreChat's token multiplier table (`packages/data-provider/src/models.ts`):
   $$\text{Input Cost} = \frac{\text{Base Input Tokens} \times R_{\text{prompt}} + \text{Cache Write Tokens} \times R_{\text{write}} + \text{Cache Read Tokens} \times R_{\text{read}}}{10^6}$$
   $$\text{Output Cost} = \frac{\text{Completion Tokens} \times R_{\text{completion}}}{10^6}$$
   $$\text{Cache Savings} = \max\left(0, \frac{\text{Cache Read Tokens} \times (R_{\text{prompt}} - R_{\text{read}})}{10^6}\right)$$

### 2.3 MongoDB Persistence (`api/app/clients/BaseClient.js` & `packages/data-schemas`)
Before `saveMessage` writes the final `responseMessage` to MongoDB, `BaseClient` attaches `cost`, `tokenUsage`, and `cacheHit` to the document. The Mongoose `Message` schema (`packages/data-schemas/src/schema/message.ts`) persists these fields with `default: undefined` so legacy documents remain untouched.

---

## 3. Frontend UI Controls

### 3.1 Assistant Message Footer Badge (`client/src/components/Chat/Messages/ui/MessageCostBadge.tsx`)
Rendered inside `HoverButtons.tsx` adjacent to the Copy, Edit, Fork, and Regenerate controls:
- **Cache Warmth Bolt Icon**:
  - **Green Bolt (`text-status-success`)**: `cacheHit === true` (`cachedTokens > 0`), with tooltip `Cache HIT (Prompt cached)`.
  - **Subtle Grey Bolt (`text-text-tertiary`)**: `cacheHit === false`, with tooltip `Cache MISS (No cached tokens)`.
- **Formatted Cost & Token Pill**: Displays compact cost and input/output token counts (e.g., `$0.0031 · 1.2k in / 340 out`).
- **Detailed Breakdown Tooltip**: Hovering or focusing the badge displays:
  - Cache status (`Cache HIT` / `Cache MISS`)
  - Prompt & completion token counts (`1.2k in / 340 out`)
  - Cached token count
  - Input cost, Output cost, Cache savings, and Total cost in USD.

### 3.2 Settings Toggle (`Settings > Chat`)
Users can show or hide message-level cost badges at any time via **Settings → Chat → Show message cost and token telemetry** (`showMessageCostAtom` in `client/src/store/showMessageCost.ts`, persisted in `localStorage` under `showMessageCost`, enabled by default).
