# TypeScript Target Specification

This directory is authoritative for the TypeScript target architecture.

- `architecture.md` assigns semantic ownership and the only lowering path.
- `verification.md` defines the proof required before a target checkpoint.

TSTS supplies one checked TS-Go-contract AST and finalized semantic facts. The
target transforms that same AST and the configured printer emits TypeScript.
The selected synchronous TSTS product expresses synchronous execution at
GoToTS source emission; this target has no cooperative-effect inference or
post-generation Promise-removal path.
