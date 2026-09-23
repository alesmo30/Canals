import { useSyncExternalStore } from 'react';

import { DEFAULT_BASE_URL } from '../api/catalog';
import { createPersistedStore } from './persisted';

const baseUrlStore = createPersistedStore<string>(
  'canals-console:base-url',
  DEFAULT_BASE_URL,
);

export function getBaseUrl(): string {
  return baseUrlStore.get().replace(/\/+$/, '');
}

export function setBaseUrl(value: string): void {
  baseUrlStore.set(value.trim() || DEFAULT_BASE_URL);
}

export function useBaseUrl(): string {
  return useSyncExternalStore(baseUrlStore.subscribe, baseUrlStore.get);
}
