# Tsonic TypeScript Target

`@tsonic/target-typescript` lowers finalized Tsonic semantic facts into fast,
ordinary TypeScript.

[`docs/spec/`](docs/spec/README.md) is the governing target contract. This
README summarizes the currently implemented pointer, scalar, and cooperative-
effect profiles; it does not narrow the complete architecture or verification
requirements in that specification.

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
    "scalarProjections": "preserve",
    "cooperativeEffects": "preserve",
    "interfaceDispatch": "open-structural"
  }
}
```

An executable assembled as one closed program may select `"closed-direct"`
for each family. The backend builds every whole-program plan before changing
any source, then composes all selected rewrites in one post-order traversal of
each original TS-Go-contract AST. Every planned source and semantic fact must
be consumed exactly once before the transaction seals; otherwise printing is
not invoked and no artifact is published. A structural rewrite that rebuilds a
parent consumes the coordinator-recorded final child nodes after every selected
lowering, never one lowering family's partial child output.

Validation maps each selection to one versioned immutable profile identity.
Lowering then builds one target-program index containing exact source/node
membership, syntax-kind partitions, binding writes, and member dispatch needed
by the selected families. Every planner shares that index; disabled facets
perform no semantic queries. The optimization evidence records the profile
identity, exact source membership, index work, selected totals, and retained
reasons so a stale or differently configured result cannot masquerade as the
same target decision.

The checked source-file set is the current output membership. No executable
root or complete module-side-effect contract is supplied to this target, so it
does not perform dead-code or module pruning. Likewise, GoToTS runtime classes
for interfaces, slices, maps, defer/recover, reflection, and initialization are
ordinary checked TypeScript here; their names and shapes do not authorize a
target optimization. New families require finalized exact-node facts and a
closed profile field before they can enter this pipeline.

`optimizations.cooperativeEffects: "closed-direct"` removes cooperative
`Promise` transport only from a complete, exact call component with no
provider, escaping-callable, promise-forwarding, thenable, or unresolved
boundary. In addition to direct calls, the plan can close an indirect call
through an exact callable-storage component. That component may contain
constructor properties, callable parameters, immutable aliases, and explicitly
typed mutable locals only when every construction, write, forwarding edge,
call, and presence check resolves to its checked declaration and no value
escapes. Return contracts across the connected component narrow atomically. A
missing or spread argument, open constructor, untracked assignment, exported
value, inheritance boundary, or one suspending producer preserves the affected
component. A non-static method is eligible only when checked
member-dispatch evidence proves that it neither overrides a base member nor has
a derived override; override families remain canonical as one unit. The plan
resolves calls through checked
signatures, settles recursive components together, and rewrites each selected
declaration, return contract, and dependent `await` in one transaction. For example,
`async function answer(): Promise<number> { return 42 }` becomes
`function answer(): number { return 42 }`, and an exact `await answer()` use
becomes `answer()`. A same-spelled local, callback escape, `Promise.resolve`
return, or provider call remains unchanged.

`optimizations.interfaceDispatch: "declared-closed"` is a separate producer
contract used by cooperative-effect lowering. It asserts that every runtime
implementation entering a selected project interface has an exact declared
project heritage path to that interface. The target then joins interface calls
to those declarations and settles the complete implementation family
atomically. The default `"open-structural"` mode never infers closure from
TypeScript structural compatibility, class names, or same-spelled members.

Generic callable parameters participate in that flow even when their result is
a type parameter and therefore has no declaration-local return rewrite. Flow
eligibility and signature rewriting are separate decisions: exact call-site
arguments settle the former, while only an exact awaitable annotation creates
the latter. That annotation must contain its direct value branch; a
Promise-only callback remains canonical. Exact plain assignments such as
`create = undefined` add new input
values to the same parameter flow; compound writes and unresolved assignments
retain it. A shared generic kernel settles atomically across all concrete uses,
so one open callback preserves every connected wrapper and consumer.

Generated-shaped public mutable callable fields are eligible only when their
nominal owner is closed across every constructor use, field access, carrier,
and call. For example, a class holding `callback: () => Awaitable<T>` may
settle through its exact zero/copy constructors and through pointer
`address-of`, `load`, and `store` operations whose facts were validated by the
pointer plan. Aliasing the constructor, deriving a runtime subclass, widening
or exporting the owner, sourcing it from an ambient function, or exporting the
field value retains the original async contract. No class, field, runtime
function, or pointer operation is selected by name.

The candidate denominator includes every async function, method, function
expression, and arrow, including inferred-return, generator, bodyless, and
open-dispatch forms that must be retained. A closed callback may also settle
through a private synchronous forwarder such as
`invoke(callback) { return callback(); }` when every invocation result is
awaited or continues through another certified return edge. Exporting the
forwarder, escaping it through an alias, or observing one returned Promise
retains the original callable contract. Multiple blocking facts still produce
one retained row under the canonical reason-catalog order.

A checked direct scalar return and a freshly constructed array or object may
also settle without requiring identical source and result type identities. The
constructed value must expose no callable `then`; object literals containing a
spread, computed property, `then`, or `__proto__` remain canonical. This keeps
covariant and aggregate Go-shaped returns simple while preserving JavaScript's
thenable assimilation boundary.

A mutable field return may settle only when its complete storage flow is
closed. The field owner and every nominal value carried through it must be
project classes with private construction and nominal private or protected
state; every construction, write, parameter transport, owner containment, and
callable use must resolve inside the selected program. Provider crossings,
open or structural carriers, widening or assertion erasure, inheritance,
decorators, computed fields, spread arguments, and callable `then` preserve the
canonical async return. This restriction is intentional: a structurally typed
value may hide a runtime `then` member that JavaScript assimilates even when its
declared interface does not expose one.

The selected TypeScript runtime contract also certifies the fresh location and
raw-pointer constructors that the target itself owns. Calls join through the
exact import binding for the pinned runtime package; a same-spelled local,
another package, an unknown runtime export, or a checked thenable result does
not qualify. Project return forwarding may consume that fact, but arbitrary
provider calls remain open.

Composed lowerings exchange result facts before rewriting rather than inspect
one another's output. Pointer and scalar planning supply the cooperative-effect
planner with one exact-node lowered-value contract. Thus canonical
`addressOf(record.value)` is known to become a fresh non-thenable `Location`,
while `loadPointer(pointer)` remains open when the pointee may itself be
thenable. An eliminated `new Width(value).value` projection is known to produce
its selected scalar value. Direct pointer representations delegate the proof
to the exact operand they preserve. The bridge consumes finalized facts and
whole-program plans; it never recognizes a marker or wrapper by spelling.

## Scalar projections

`optimizations.scalarProjections: "closed-direct"` classifies every immediate
construction projection such as `new Width(value).value`. When the exact class
binding is immutable, construction is behavior-free, the selected property is
its one readonly scalar constructor parameter, and the call/property evidence
joins exactly, the target emits the equivalent scalar expression while still
evaluating the constructor target before the argument. Same-file authored
types are preserved; cross-file projections use only exact portable primitive
types.

Every candidate has one optimized or retained decision. Canonical-profile,
open target, mutable binding, observable construction, mutable field,
non-scalar value, nonportable cross-module type, and open semantic evidence are
the complete retention reasons. Other class uses remain unchanged because the
optimization owns only the closed immediate projection occurrence.

## Pointer representations

Canonical pointer lowering is `Location<T>`. It remains the default and the
complete fallback for open, escaping, unsafe, indirect, or otherwise unproved
flows.

The target optimization `optimizations.pointerFlows: "closed-direct"` lets the
backend create one whole-program plan from the checked source and its stable
target-relative document identities, then supply that plan while lowering every
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
  does not replace the pointee through the pointer.

Representation boundaries are flow-local. A generic callable contract,
provider binding, or projection keeps its exact connected pointer component on
`Location<T>`; it does not force disconnected pointers with the same pointee
class onto that representation. A whole-family decision is used only when the
entire family is closed. Otherwise independently closed components retain their
own exact direct decision.

An identity-observing class family can still use the object itself only when
every pointer producer receives a value proven fresh. The proof accepts an
exact `new ExactClass(...)` or an exact resolved call to a stable static method
on that class whose sole statement returns another proven-fresh value. Factory
proofs may compose recursively, but cycles fail closed; names such as `make` or
`create` have no meaning. Addressed storage, allocating an existing object,
shared or branching factory returns, factory/class binding writes, inheritance,
decorators, and a constructor that can return a replacement object all retain
`Location<T>`.
Within that proven bijection, pointer equality is object `===` and pointer
hashing uses the runtime's stable object-identity hash. A nullable hash input is
captured once before its nil branch, so lowering cannot duplicate evaluation.

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
