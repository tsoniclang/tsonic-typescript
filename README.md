# Tsonic TypeScript Target

`@tsonic/target-typescript` lowers finalized Tsonic semantic facts into fast,
ordinary TypeScript.

The target transforms TSTS's exact checked TS-Go-contract AST directly. It does
not parse source again, join by ranges, recognize marker spellings, or patch
text. The transformed tree is encoded with the pinned TS-Go external-AST
protocol and printed by one configured printer service. Bootstrap builds use
the pinned TS-Go printer; the lowering contract is independent of that printer
implementation.
