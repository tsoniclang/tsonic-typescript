# Tsonic TypeScript Target

`@tsonic/target-typescript` lowers finalized Tsonic semantic facts into fast,
ordinary TypeScript.

[`docs/spec/`](docs/spec/README.md) is the governing target contract.

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

The input program is already synchronous when its GoToTS profile disables
concurrency. This target never infers effects, removes `Promise`, or rewrites
`async`/`await`; encountering those constructs is source-owner evidence, not an
invitation to recover semantics in the target.

The optional target-level `execution` contract defaults to `"unrestricted"`
for ordinary TypeScript projects. A synchronous product selects
`"synchronous"`; the target then rejects authored `async`, `await`, `for await`,
and `await using` nodes from the exact checked tree before any plan is built or
the printer is invoked. The sealed optimization artifact records that selected
execution contract separately from representation choices.

## Optimization profile

All representation changes are explicit target configuration. Omitting the
profile selects the canonical, open-world-safe result:

```json
{
  "execution": "unrestricted",
  "optimizations": {
    "pointerFlows": "location",
    "scalarProjections": "preserve",
    "representationProjections": "preserve"
  },
  "representationTransports": []
}
```

An executable assembled as one closed program may select `"closed-direct"`
for any family. The backend builds every whole-program plan before changing
any source, then composes all selected rewrites in one post-order traversal of
each original TS-Go-contract AST. Every planned source and semantic fact must
be consumed exactly once before the transaction seals; otherwise printing is
not invoked and no artifact is published.

The shared target-program index owns one source/node census, syntax-kind
partitions, collision-safe authored names, and binding writes selected by the
enabled families. Versioned evidence records exact source membership and a
complete optimized-or-retained denominator for every family.
Closed pointer evidence also reports the 32 largest retained class families by
exact declaration identity, pointer-type and operation counts, and bounded
blocker occurrences. This diagnostic is deterministic and cannot influence a
representation decision.

A closed product may additionally supply two closed kinds of callable through
`representationTransports`. A manifest-certified `generic-kernel` makes only
its generic-owned parameters opaque representation transport and never exposes
or inlines its body. An explicitly configured
`inline-generic-method-call` must resolve to one checked, synchronous generic
function whose plain required parameters are all owned by its own type
parameters and whose body is exactly one receiver-parameter method call using
every remaining parameter once in order. The target substitutes the exact call
arguments into that body and preserves the helper's `void` result.

Both kinds exact-join the imported module, export, declaration, and selected
signature. Generic ownership comes from checker type identity, not text.
Wrong-module, same-spelled, aliased, overloaded, optional, concrete-parameter,
or body-drifted callables remain boundaries or fail the selected inline
contract. Sealed evidence records the contract digest, callable denominator,
selected-call count, and inline-call count.

## Scalar projections

`scalarProjections: "closed-direct"` replaces an exact behavior-free wrapper
projection such as `new Width(value).value` with `value` only when the selected
constructor, readonly scalar field, binding, module boundary, and evaluation
order are all closed. Every other occurrence remains unchanged with one named
retention reason.

## Representation projections

`representationProjections: "closed-direct"` removes proved identity calls,
inverse construct/project pairs, closed stored projections, and identity
callable parameters. It exact-joins declarations, signatures, references,
writes, arguments, and source ownership; it never recognizes generated names
or structural lookalikes.

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
  type symbol has a primary project `ClassDeclaration`; whole-pointee stores
  are admitted only for a closed class whose complete mutable state is the
  exact public constructor-property set, and become one collision-free
  generated replacement method that copies those fields in place.

The replacement shape belongs to the class, but admission belongs to each
connected pointer-flow component. A canonical or unstable component never
suppresses an independent proved component of the same class, and no store is
rewritten unless that exact component selects the replacement.

Pointer equality and hashing admit an addressed object only when its exact
storage declaration is never rebound and its initializer recursively proves a
fresh project construction. Exact project function factories and exact static
class factories may carry that proof; shared, reassigned, recursive, indirect,
or otherwise open factories retain canonical locations.

Object shape is never representation evidence. Arrays, interfaces,
declaration-file classes, and structural wrapper shapes therefore remain
`Location<T>`. A project class may carry value semantics because canonical
`Location<T>.value` also returns that same represented object; generated copy
operations remain outside pointer lowering. Replacing an object pointee never
changes its object identity, so aliases continue to denote the same Go pointer.
Classes with inheritance, accessors, computed members, omitted mutable state,
decorators, open boundaries, or mutable class bindings retain `Location<T>`.
`addressOf(x)` can become a scalar snapshot only when `x` has one exact local
storage identity and the checked navigation graph proves that storage cannot
change. Repeated addresses of the same storage are one component. Nullable
authored types retain `value ?? panic()`; a nil guard is contracted only when
the checked left operand itself cannot be undefined.

Planning uses original checked-node identities. `createPointerRewriteSession`
exposes the node rewrite for composition with other semantic lowerers in one
canonical target-AST traversal; it seals only after every planned fact has
been consumed. No pass is keyed to cloned nodes.
