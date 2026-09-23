/**
 * Handlers get payload only: JobRunner consumes meta (correlation id, trace
 * context) before they run.
 */
export interface JobHandler<TPayload> {
  readonly queue: string;
  handle(payload: TPayload): Promise<void>;
}

/** DI token for the multi-provider array of every registered JobHandler, consumed by the JobRunner. */
export const JOB_HANDLERS = Symbol('JobHandlers');
