# TypeScript Target Specification

These files are the governing contract for `@tsonic/target-typescript`:

1. [`architecture.md`](architecture.md) owns input/output boundaries,
   complete-flow planning, representation selection, and human-shaped source.
2. [`verification.md`](verification.md) owns differential, mutation, cost,
   transaction, and product evidence.

`README.md` describes the currently implemented public surface. Plans,
benchmarks, generated artifacts, and historical branches are evidence only and
cannot override this specification.

TSTS supplies one checked TS-Go-contract AST and finalized semantic facts. The
target transforms that same AST and the configured printer emits TypeScript.
Canonical source attributes are finalized compile-time metadata: this target
exact-joins and erases them while retaining the ordinary executable carrier.
It does not classify their declaration or payload spelling.
