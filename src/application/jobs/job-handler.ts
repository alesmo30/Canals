/**
 * SPEC 04 Data model, "Handler contract". Handlers receive `payload` only:
 * `meta` is consumed by the `JobRunner` before they run — the
 * `correlationId` is already in the logging context and the span already
 * open (step 7), so a handler never reads, forwards or knows about it.
 */
export interface JobHandler<TPayload> {
  readonly queue: string;
  handle(payload: TPayload): Promise<void>;
}

/** DI token for the multi-provider array of every registered JobHandler, consumed by the JobRunner. */
export const JOB_HANDLERS = Symbol('JobHandlers');
