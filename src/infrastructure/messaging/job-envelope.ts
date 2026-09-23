/**
 * Captured by PgBossEventPublisher, restored by JobRunner; handlers never
 * see meta.
 */
export interface JobMeta {
  readonly correlationId: string;
  /** W3C trace context; null when no span is active. */
  readonly traceparent: string | null;
  readonly publishedAt: string;
}

export interface JobBody<TPayload = Record<string, unknown>> {
  readonly payload: TPayload;
  readonly meta: JobMeta;
}
