# Architecture

## Mission

The TypeScript target converts one checked Tsonic program into fast, readable,
ordinary strict ESM TypeScript. It changes representation, not source meaning.
For every complete flow it chooses the simplest representation proved exact;
when proof is incomplete, the same family retains its canonical representation
with a typed reason.

Performance and human-shaped source are correctness requirements. A special
case may retain necessary machinery, but it must not force that machinery into
ordinary proved-simple cases.

## Authority And Boundaries

TSTS owns:

- the immutable source documents;
- the checked TS-Go-contract AST;
- exact node and symbol identity;
- canonical marker selection; and
- finalized semantic facts.

The TypeScript target owns:

- validated target configuration;
- complete-flow executable representations;
- fact-driven transformations of that same AST;
- target runtime selection;
- printer transaction planning; and
- executable TypeScript artifacts.

The target never reparses source, builds a second AST, joins by source range,
rereads files, re-enters a checker, recognizes marker spelling, patches text,
or invents Go semantics. It never changes a source-facing signature merely to
make one implementation convenient.

## One Target Pipeline

```text
immutable checked TS-Go AST + finalized exact-node facts
                         |
                         v
validated target profile and complete source membership
                         |
                         v
one immutable target-program index
  (exact nodes/source files, syntax-kind partitions, shared flow answers)
                         |
                         v
family plans over complete connected flows
  (currently effects, pointers, and scalar projections)
                         |
                         v
one composed post-order AST rewrite transaction
                         |
                         v
sealed external-AST batches -> configured printer -> strict ESM TypeScript
```

There is one current path. A family planner records a selected representation
or one closed typed retention reason. It does not fork into optimized and
legacy compilers.

## Program Index

Whole-program families consume one immutable index built once from the
original checked tree. It contains only target-side coordination needed by
more than one family. The current shared denominator is exact node/source-file
membership in source preorder, immutable syntax-kind partitions, canonical
binding-write joins, and canonical project-member dispatch. Optional facets
are built only when the selected profile has a consumer.

The index is coordination state, not a second semantic model. TSTS facts remain
the semantic authority. Canonical declaration, reference, import, signature,
call, and alias queries remain at their existing navigation owner unless more
than one family needs one materialized answer. Family-specific facts stay in
their family. A query whose answer is needed once remains local instead of
expanding the index.

Index construction and family planning must be proportional to nodes plus
relevant edges. Repeated whole-program scans, per-candidate hierarchy walks,
per-candidate import expansion, and output-cardinality proxies are forbidden.

The supplied source-file membership is also the current publication
membership. The target input does not currently carry executable declaration
roots or a complete module-side-effect contract, so the target retains every
selected source file and declaration. It must not infer roots from exports,
entrypoint spelling, imports, or generated-runtime shape. A future pruning
profile is admissible only after the shared checked-source contract supplies
exact roots and side-effect edges; that profile must then exact-join every
retained and removed member before rewriting.

## Representation Decision

Every optimization is selected explicitly by the validated target profile.
Omitting a field selects canonical open-world-safe behavior. A closed-program
profile may change an exported representation only after every affected
definition, reference, caller, alias, and observable operation is joined.

### Canonical Pointer Input Contract

Pointer lowering consumes one frozen canonical contract; it does not infer Go
meaning or recognize marker spelling. `Pointer<T> | undefined` and the exact
`address-of`, `allocate`, `load`, `store`, `equal-pointer`, `hash-pointer`,
`bind-pointer`, and `project-pointer` facts preserve the source pointee type,
nil shape, storage/location identity, provider read/write binding,
representation projections, and operands.
Every pointer-bearing definition, parameter, result, reference, caller, alias,
and storage occurrence belongs to one exact connected component before a
representation is selected.
Operation shape is settled in that plan as well: for example, a reference hash
records whether its operand may be undefined and reserves any required
single-evaluation binding before rewriting. The AST rewrite consumes that
settled operation plan; it does not rerun checker queries after another source
has been transformed.

The target may select plain `T`, one `{ value: T }` cell, or the represented
class object only by rewriting that complete component atomically. Escaping,
nullable, identity-observed, unsafe, indirect, lifetime-sensitive, provider,
or unresolved components retain canonical `Pointer<T>`. Hash, provider bind,
and pointee projection occurrences join the component and retain canonical
representation unless their complete observations are independently proved
exact. A changed source
signature or marker/fact contract is rejected upstream; this target has no
adapter, allowlist, spelling rule, or alternate signature store.

The pointer decision also publishes whether an exact value occurrence is the
pointer itself or its loaded pointee. Canonical locations, mutable cells, and
direct scalar snapshots are definitely non-thenable pointer values; a load is
not. Cooperative-effect return analysis may consume that immutable distinction
before either family rewrites the tree. It may not infer the distinction from
the `Pointer` spelling, object shape, or component membership alone.
The canonical representation map is the sole value-membership owner; no second
pointer-value index or retained checker-node set may duplicate it.
Lookup checks that map first and resolves only an exact identifier reference
when needed; unrelated return syntax may not trigger broad checker navigation.

The decision order is:

1. identify the complete connected semantic flow;
2. prove which behavior is observable at its boundary;
3. select the smallest ordinary TypeScript representation preserving it;
4. rewrite every affected producer and consumer atomically; and
5. record selected and retained totals with exact reasons.

No package/function allowlist, name heuristic, local override, unchecked cast,
or generated-text inspection may select a representation.

## Admitted Families

The profile grows by closed semantic family, not by corpus exception. A family
is admitted only when its complete semantic denominator is available from
finalized shared facts or from ordinary checked-TypeScript semantics that do
not depend on source-language meaning. The current executable families are:

- **cooperative effects:** remove `async`, `Promise<T>`, and `await` from every
  complete component that cannot suspend; retain transport for a real open,
  escaping, thenable, provider, or suspending boundary;
- **typed pointers:** use a scalar snapshot for a closed read-only flow, one
  shared `{ value: T }` cell for a closed mutable scalar alias flow, and the
  represented class object for a proved bijective object flow; retain canonical
  location semantics for open or observable identity/alias/nil/lifetime cases;
- **scalar projections:** erase representation-only scalar wrappers when all
  uses preserve the same selected value behavior;

Value copying/storage, generic operation selection, interfaces, source-language
containers, panic/recovery, reflection, and package initialization remain in
their canonical source form unless a separately versioned shared fact contract
is added for that family. In particular, a GoToTS runtime import, generated
class shape, method name, or support-module path is ordinary TypeScript input;
it is not semantic evidence. The target must not recognize `RuntimeSlice`,
`GoMap`, interface adapters, defer machinery, or similar declarations by
spelling or structure and then infer Go behavior.

A future admitted family may optimize those forms only after its fact owner
defines the complete observations needed for the decision (for example slice
nilness, capacity, backing aliases, reslicing and element addresses), finalizes
those facts on exact nodes, and exposes the closed configuration choice. Until
then, doing nothing is canonical retention by ownership, not an unreported
target decision row.

Each family has one decision owner and one transformation owner. Cross-family
coordination exchanges immutable result facts before rewriting; one family may
not inspect another family's partially rewritten tree.

### Scalar Projection Closure

The scalar owner classifies every exact immediate construction projection such
as `new Width(value).value`. It either removes the allocation while preserving
constructor-target-before-argument evaluation, precedence, and the selected
result type, or retains the canonical expression under one closed reason:

- the canonical profile explicitly preserves it;
- the constructor target is open or not an exact class binding;
- the class binding is mutable;
- construction has observable class, base, decorator, initializer, or body
  behavior;
- the selected field is not one exact readonly constructor parameter;
- the projected value is not a supported scalar;
- a cross-module result type has no exact portable spelling; or
- call/property evidence does not exact-join the selected declarations and
  types.

The decision is per exact source occurrence. Other uses of the same class do
not prevent elimination of a closed immediate projection, and they are not
silently rewritten. Every syntactic candidate appears exactly once in the
decision denominator; no unsupported or unknown residual category exists.

An eliminated scalar projection publishes an immutable lowered-value result
fact on its original node identity. Cooperative-effect planning may consume
that fact together with pointer-result facts before either family rewrites the
tree. The shared contract answers only properties of the final value, such as
definite non-thenability; it does not expose another family's representation or
partially transformed nodes.

### Cooperative-Effect Closure

The effect owner inventories every authored async function declaration,
method, function expression, and arrow before eligibility is tested. Each
candidate receives exactly one settled decision or one retained decision from
the closed reason catalog. Inferred or incompatible return contracts,
generators, bodyless forms, and open method dispatch remain visible retained
rows; an early eligibility filter may not erase them from the denominator.

One callable-flow component includes exact direct and indirect calls,
recursive dependencies, method values, immutable aliases, closed callback
parameters and storage, their callable return contracts, and every call-result
consumer. A private synchronous forwarder may carry a settled callback result
only when every reference is an exact indexed call and every result is awaited,
discarded, returned by a settling callable, or passed through another such
private forwarder. Export, alias escape, ordinary Promise observation, open
dispatch, provider behavior, or unresolved transport retains the component.

Callable-flow admission and callable-signature rewriting are distinct facts.
An explicitly authored function-type parameter is eligible for exact flow even
when its return is a type parameter: all concrete arguments and forwarding
edges determine whether that result suspends. Only an exact awaitable return
annotation containing its direct value branch creates a type-node rewrite; a
Promise-only contract remains canonical. Plain `=` writes to such a parameter
contribute their right-hand values to the same flow; compound writes,
destructuring, unresolved destinations, or any other write shape retain the
component. Every instantiation of one generic callable shares its declaration,
so settlement is atomic across all connected concrete calls rather than
specialized by spelling or inferred type argument.

An exact checked project callable may also produce a callable value. The value
flow may inspect all of its direct return expressions only when the invoked
binding is unchanged, method dispatch is closed, the implementation body is
present, and an async producer is consumed through its exact await. Every
returned function value then joins the same component. A binding write, open
override, bodyless declaration, unresolved alias, or unawaited async producer
retains the flow. A fresh function or arrow expression is non-thenable at its
creation site under the same standard-built-in integrity envelope used for
fresh arrays and objects; a later reference to a function is not fresh proof.

Settlement of a produced callable is atomic with its authored result contract.
After the producer's outer async contract is selected, every non-nullish result
branch must be a direct function-type node whose return is already definitely
non-suspending or has one exact awaitable rewrite. Type aliases, object
wrappers, and any other indirect shape retain the flow until their own complete
contract exists. The effect owner canonicalizes rewrites by original type-node
identity, merges every collection, storage, and producer-flow obligation for
that identity, and rewrites it only when the combined dependency closure
settles. It may not settle a returned implementation while leaving its
producer or consumer signature awaitable.

Synchronous-call dependency closure is computed once over the canonical call
resolutions. Collection, storage, and returned-callable contracts project from
those already-closed resolutions and retain references to their own immutable
evidence; they do not create a second reverse dependency graph or copy merged
dependency sets per contract. This keeps contract evidence proportional to
authored contracts plus canonical calls even when many contracts share one
forwarder.

Resolution finalization seals its existing dependency storage in place and
permanently invalidates every construction operation. The finalized interface
exposes only counts and iterators, never its backing sets, and finalization
creates neither a second resolution object nor copied dependency collections.
This is one lifecycle boundary, not a mutable owner plus a defensive view or
array copy. Per-resolution object freezing is also forbidden: the sealed state
and capability boundary provide immutability without forcing a whole-graph
hidden-class transition after the checker graph is already resident.

Callable storage may be a public mutable constructor field when the nominal
class remains a closed project-owned value family. The owner proof inventories
every exact construction, class-value reference, field write/read/transfer,
carrier, invocation, and escape before settlement. A project class may carry
that owner through an exact field or instantiated type argument; the carrier's
own escape then closes the original owner. Constructor aliases, runtime
inheritance, ambient introduction or escape, widening, unresolved writes, and
field-value escape retain the complete callable component. Public visibility
alone is neither permission nor a blocker: closure of the observable owner
flow is the decision.

Nominal carrier closure is one finite graph over project class storage
declarations and nested nominal type arguments. It is built once and propagated
from candidate owners through reverse carrier edges. Per-occurrence analysis
may query that index; it may not recursively enumerate arbitrary object
property graphs. This keeps carrier work proportional to declared carrier
edges rather than the transitive checker graph.

The index retains only positive owner memberships as immutable sparse rows.
All negative queries share one immutable empty result, and no per-type mutable
set or negative-result ledger is retained. Recursive type-cycle state is local
and allocated only while a nested nominal type is being inspected. The target
must not trade bounded graph traversal for a dense checker-type-by-owner table.

The pointer family may certify owner transport for validated `address-of`,
`allocate`, `load`, `store`, pointer-equality, and pointer-hash facts. The effect
owner consumes those exact-node facts through an immutable transport contract;
it does not recognize imports or calls by spelling. Bind/project operations
remain open owner boundaries until their callback and projection flows have a
separate complete proof. An external call with the same signature or name
therefore cannot inherit this permission.

Canonical pointer boundaries attach to the exact affected node and propagate
through its connected component. Generic contracts record the affected
concrete family but do not taint a disconnected component merely because its
pointee has the same class declaration. Provider and projection operations
likewise retain their own component. Family-wide representation is admitted
only when every family occurrence is closed; a declined family decision does
not erase a stronger independently complete component proof.

Ordinary checked TypeScript may close a result boundary when every union member
is intrinsically non-thenable or carries an optional readonly private `then`
member whose selected value type cannot be callable (for example
`declare private readonly then?: never`). The private member makes the contract
nominal. The same proof applies to direct construction and to derived classes
that inherit that exact nominal member; inheritance without the member remains
open. Absence of `then`, or a public structural declaration of it, is not proof
because width subtyping permits a hidden thenable. `any`, `unknown`, type
variables, and open structural members remain retained. This is target-language
Promise-assimilation evidence, not marker or source-language recognition.

Settlement reconstructs the complete component atomically: async modifiers,
Promise or exact awaitable-union return members, awaits, and dependent callable
contracts are consumed once by original node identity. Retained candidates may
accumulate several blocking facts, but evidence assigns one canonical reason
using the pinned reason-catalog order. Direct causes remain separately counted
and source-located; their sum is not the retained denominator.

## Human-Shaped Output

Generated TypeScript should look like a careful human translation whenever the
proved semantics permit it:

- preserve source-facing parameter order and cardinality;
- prefer direct calls, methods, loops, switches, tuples, rest parameters, and
  structured returns;
- omit unnecessary wrappers, policy/capability parameters, closure adapters,
  temporaries, checks, copies, and runtime imports;
- preserve GoToTS-owned source-derived declaration and module names, and use
  the same rule for target-created private declarations;
- add a readable semantic qualifier only for a real collision; and
- reserve every target-created lexical binding against every authored and
  generated binding visible at its insertion point, including parameters of
  synthetic closures; and
- keep digests and internal identities in manifests/evidence, never ordinary
  declaration names or module paths. A canonical naming violation is reported
  to GoToTS rather than hidden by a target rename.

For example, a closed synchronous component:

```ts
async function SortFunc$concrete_02fd(values: Value[]): Promise<void> {
  return await sortKernel(async (left, right) => await compare(left, right));
}
```

must become the equivalent ordinary shape:

```ts
function SortFunc(
  values: Value[],
  compare: (left: Value, right: Value) => number,
): void {
  sort(values, compare);
}
```

only when the exact call, effect, value, and container flows prove that shape.
An unresolved component retains the canonical form; it does not weaken proof
for a neighboring component.

## Signatures And Callers

A representation change may alter a target-internal type, but source-facing
value-parameter order and cardinality remain equivalent to the source
contract. Receiver-as-`this`, pointer-receiver-first, and idiomatic variadic
rest are the only general shape mappings.

Every changed callable signature reconstructs all exact callers, method values,
callbacks, adapters, exports, and dependent signatures through one reverse
dependency owner. If the observable signature is structurally unchanged, no
consumer is reprocessed. Oscillation fails.

## Rewrite And Publication Transaction

All family plans complete before the first source is rewritten. The coordinator
then visits each original node once in post-order, supplies already-final child
nodes to the parent rewrite, and consumes every planned fact exactly once. A
source's rewrite sessions and final-node journal are removed from the
transaction as soon as that source is consumed; completed per-source state may
not accumulate behind the whole-program plans.

After planning, sources are rewritten and encoded one at a time into immutable
ordered batches under one finite payload budget. A full batch may be sent to
the pure printer service before later sources are encoded, but its returned
text remains staged inside the backend. Zero/multiple output matches,
oversized frames, reordered members, missing output, an encoding failure, or
any later-batch failure aborts the whole target and returns no artifacts.
Encoded ASTs and rewrite journals for the complete project are never retained
as a prerequisite for atomic publication.

## Configuration

External configuration enters only `src/config/`, may initially be `unknown`,
and becomes one closed immutable profile before compilation. Every semantic
switch has one JSON owner and one normalized identity. Product configuration,
CLI resolution, and target defaults must converge on that same typed profile;
ambient environment state does not select an optimization.

The immutable evidence artifact binds the canonical profile identity, exact
source membership, selected/retained decisions, typed reasons, index and
planner work counts, runtime contract, and target output membership. Input
semantic and output-membership digests are added only at the layer that owns
those canonical values; they are not fabricated by lowering.

## Complexity And Failure

Target planning and rewriting must be linear or `O((N + E) log N)` in checked
nodes and relevant flow edges. Output and support growth must be proportional
to selected source and genuinely distinct representations, not call count,
implementer count, candidate count squared, or incidental identity strings.

Missing facts, an open flow, or an unsupported optimization retains the exact
canonical representation when that representation is executable. A missing
canonical capability is a typed compilation error. There is no dynamic
recovery, approximate match, silent partial optimization, threshold increase,
or source-text fallback.
