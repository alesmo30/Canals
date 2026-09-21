/**
 * SPEC 04 Scope: "The worker, having no HTTP port, is checked by `node
 * dist/infrastructure/health/worker-healthcheck.js`, which verifies the
 * readiness file the worker writes at boot and removes on shutdown, plus
 * database connectivity." Not an env var — nobody tunes this per
 * deployment (references/coding-conventions.md).
 */
export const WORKER_READINESS_FILE_PATH = '/tmp/worker-ready';
