import { LocalStorageKeys } from 'librechat-data-provider';
import { createStorageAtom } from './jotai-utils';

const DEFAULT_SHOW_MESSAGE_COST = true;

/**
 * Controls whether assistant message-level cost, token count, and cache warmth badges are displayed.
 */
export const showMessageCostAtom = createStorageAtom<boolean>(
  LocalStorageKeys.SHOW_MESSAGE_COST,
  DEFAULT_SHOW_MESSAGE_COST,
);
