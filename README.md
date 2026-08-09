# Tsonic TypeScript Target

`@tsonic/target-typescript` lowers finalized Tsonic semantic facts into fast,
ordinary TypeScript.

The target transforms TSTS's exact checked TS-Go-contract AST directly. It does
not parse source again, join by ranges, recognize marker spellings, or patch
text. The transformed tree is encoded with the pinned TS-Go external-AST
protocol and printed by one configured printer service. Bootstrap builds use
the pinned TS-Go printer; the lowering contract is independent of that printer
implementation.

The backend prepares, lowers, encodes, and resource-validates every selected
source before invoking that service. It then prints immutable-membership
batches under one finite protocol budget and publishes artifacts only after
every batch returns the exact ordered file count. Source-side failures invoke
no printer; printer failures publish no partial target result.

The target provider contributes the exact declared TypeScript runtime package
reference. The backend emits one strict-ESM `package.json`, retains that
dependency only when fact-driven lowering introduces a runtime import, and
fails if the selected runtime name or version is absent or mismatched. Product
assembly resolves the declared package locally or through its package manager;
it does not invent a second runtime selection.

The same provider owns the checked-source declaration profile: the bundled
`lib.es2024.d.ts` closure and declaration contracts from installed packages.
Callers do not inject ambient globals or rediscover the target's library set.

## Optimization profile

All representation changes are explicit target configuration. Omitting the
profile selects the canonical, open-world-safe result:

```json
{
  "optimizations": {
    "pointerFlows": "location",
    "scalarProjections": "preserve"
  }
}
```

An executable assembled as one closed program may select `"closed-direct"`
for either family. The backend builds every whole-program plan before changing
any source, then composes all selected rewrites in one post-order traversal of
each original TS-Go-contract AST. Every planned source and semantic fact must
be consumed exactly once before the transaction seals; otherwise printing is
not invoked and no artifact is published.

## Pointer representations

Canonical pointer lowering is `Location<T>`. It remains the default and the
complete fallback for open, escaping, potentially nil, identity-observed,
unsafe, indirect, or otherwise unproved flows.

The target optimization `optimizations.pointerFlows: "closed-direct"` lets the
backend create one whole-program plan with
`createClosedPointerFlowPlan(source)` and supply that plan while lowering every
source file. Lowering does not read configuration; omitting the plan always
selects canonical `Location<T>`.

Selecting `closed-direct` asserts that the complete emitted program is the
consumer boundary. Project exports may therefore change representation, but
only after the planner has joined every project definition, call, alias, and
reference. Library output with unknown consumers must use canonical lowering.

The closed planner can select only these exact representations:

- a read-only scalar pointer becomes the scalar snapshot;
- a closed mutable scalar alias component becomes one `{ value: T }` cell;
- a class-represented pointee becomes the object itself only when its checked
  type symbol has a primary project `ClassDeclaration` and the complete flow
  neither replaces nor observes the pointer location.

Object shape is never representation evidence. Arrays, interfaces,
declaration-file classes, and structural wrapper shapes therefore remain
`Location<T>`. A project class may carry value semantics because canonical
`Location<T>.value` also returns that same represented object; generated copy
operations remain outside pointer lowering. `addressOf(x)` can become a scalar
snapshot only when `x` has one exact local storage identity and the checked
navigation graph proves that storage cannot change. Repeated addresses of the
same storage are one component. Nullable authored types and `value ?? panic()`
guards are contracted only when all exact assignments and calls prove the
component non-null.

Planning uses original checked-node identities. `createPointerRewriteSession`
exposes the node rewrite for composition with other semantic lowerers in one
canonical target-AST traversal; it seals only after every planned fact has
been consumed. No pass is keyed to cloned nodes.
