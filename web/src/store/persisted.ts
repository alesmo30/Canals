/**
 * Tiny localStorage-backed store with useSyncExternalStore semantics.
 * Every read/write is wrapped: storage can throw (private mode, quota,
 * blocked site data) and the console must still work in memory.
 */
export interface PersistedStore<T> {
  get: () => T;
  set: (next: T | ((previous: T) => T)) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createPersistedStore<T>(
  key: string,
  fallback: T,
): PersistedStore<T> {
  let value: T = fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw !== null) {
      value = JSON.parse(raw) as T;
    }
  } catch {
    value = fallback;
  }

  const listeners = new Set<() => void>();

  return {
    get: () => value,
    set: (next) => {
      value =
        typeof next === 'function'
          ? (next as (previous: T) => T)(value)
          : next;
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Keep the in-memory value; persistence is a convenience.
      }
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
