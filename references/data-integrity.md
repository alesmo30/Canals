# Data integrity: append-only ledgers and idempotency

Referenced from `CLAUDE.md`. Read when touching `inventory_movements` or
building another append-only ledger, or writing an operation that must
not repeat a side effect on retry.

`inventory_movements` (and anything like it) is `INSERT`-only, forever —
no `UPDATE`, no `DELETE`. An idempotent operation that must not repeat a
side effect (`release`, `commit`) guards on the **latest** ledger row for
its key, read **after** the relevant row-level lock is acquired (never
before — reading state before locking is a check-then-act race). The
amount such an operation moves comes from the ledger's own prior row
(e.g. the original `RESERVE`'s `quantity_delta`), never re-supplied by
the caller — the ledger is the source of truth for "how much", the
caller only says "which".
