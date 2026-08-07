# Tsonic TypeScript Target

`@tsonic/target-typescript` lowers finalized Tsonic semantic facts into fast,
ordinary TypeScript.

The target transforms TSTS's exact checked TS-Go-contract AST directly. It does
not parse source again, join by ranges, recognize marker spellings, or patch
text. The transformed tree is encoded with the pinned TS-Go external-AST
protocol and printed by one configured printer service. Bootstrap builds use
the pinned TS-Go printer; the lowering contract is independent of that printer
implementation.

The target provider contributes the exact declared TypeScript runtime package
reference. The backend emits one strict-ESM `package.json`, retains that
dependency only when fact-driven lowering introduces a runtime import, and
fails if the selected runtime name or version is absent or mismatched. Product
assembly resolves the declared package locally or through its package manager;
it does not invent a second runtime selection.

The same provider owns the checked-source declaration profile: the bundled
`lib.es2024.d.ts` closure and declaration contracts from installed packages.
Callers do not inject ambient globals or rediscover the target's library set.
