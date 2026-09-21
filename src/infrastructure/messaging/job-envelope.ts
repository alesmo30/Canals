/**
 * SPEC 04 Data model, "Job body and routing". `correlationId`/`traceparent`
 * are captured by `PgBossEventPublisher` and restored by the `JobRunner`
 * (step 7) — a handler never sees `meta`, only `payload`
 * (`job-handler.ts`'s contract).
 */
export interface JobMeta {
  readonly correlationId: string;
  /** W3C trace context; null when no span is active (before step 7 lands tracing, always null). */
  readonly traceparent: string | null;
  readonly publishedAt: string;
}

export interface JobBody<TPayload = Record<string, unknown>> {
  readonly payload: TPayload;
  readonly meta: JobMeta;
}
