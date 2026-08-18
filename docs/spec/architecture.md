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
  (exact nodes/source files, syntax-kind partitions, references, shared flow answers)
                         |
                         v
family plans over complete connected flows
  (effects, pointers, scalar wrappers, and exact representation projections)
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
declaration-reference joins, canonical binding-write joins, and canonical
project-member dispatch. The declaration-reference join is materialized once
from exact checked-node identities and is the only reverse-reference graph used
by target families. Optional facets are built only when the selected profile
has a consumer.

The index is coordination state, not a second semantic model. TSTS facts remain
the semantic authority. Canonical declaration, reference, import, signature,
call, and alias queries remain at their existing navigation owner unless more
than one family needs one materialized answer. Family-specific facts stay in
their family. A query whose answer is needed once remains local instead of
expanding the index.

Index construction and family planning must be proportional to nodes plus
relevant edges. Repeated whole-program scans, per-candidate hierarchy walks,
per-candidate import expansion, and output-cardinality proxies are forbidden.
Temporary candidate arrays used to construct an index facet are released when
that facet seals; they are not retained alongside the finished index.

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
not. A direct-object pointer value is definitely non-thenable only when its
exact pointee type satisfies the target-language nominal non-thenability
contract. Cooperative-effect return analysis may consume that immutable
distinction before either family rewrites the tree. It may not infer the
distinction from the `Pointer` spelling, object shape, or component membership
alone.

One closed pointer-value evidence map is the sole value-membership owner. It is
built once from canonical representation decisions and exact pointer-type
facts, and records the representation plus pointee contract for each exact
value node. It may also index the checker's exact selected declaration for an
identifier, property access, or element access when every pointer annotation
owned by that declaration agrees on both representation and pointee identity.
Conflicting annotations leave that declaration unclassified. No second
pointer-value index, type-wide approximation, or retained checker-node set may
duplicate this map. Lookup checks the exact value node first and then only its
checker-selected declaration; unrelated return syntax may not trigger broad
checker navigation.

The decision order is:

1. identify the complete connected semantic flow;
2. prove which behavior is observable at its boundary;
3. select the smallest ordinary TypeScript representation preserving it;
4. rewrite every affected producer and consumer atomically; and
5. record selected and retained totals with exact reasons.

No package/function allowlist, name heuristic, local override, unchecked cast,
or generated-text inspection may select a representation.

TS-Go `IsX` predicates are the sole syntax-kind authority. An `AsX` operation
projects fields only after the node kind is proved by `IsX`, a closed kind
inventory, or an already validated plan entry; it never classifies an
uncertain node. A failed kind proof retains the complete flow rather than
probing another projected layout.

## Admitted Families

The profile grows by closed semantic family, not corpus exception. Admission
requires a complete denominator from finalized facts or ordinary checked-TypeScript semantics:

- **cooperative effects:** remove `async`, `Promise<T>`, and `await` from a complete
  non-suspending component; retain real open, escaping, thenable, provider, or suspending boundaries;
- **typed pointers:** use a scalar snapshot for a closed read-only flow, one shared
  `{ value: T }` cell for mutable scalar aliases, and a represented class for a
  proved bijection; retain canonical locations for observable identity/alias/nil/lifetime;
- **scalar projections:** erase representation-only scalar wrappers when all
  uses preserve the same selected value behavior;
- **representation projections:** erase an exact identity call, immediate inverse
  pair, or immutable local wrapper used only by exact projectors, and specialize
  identity-only callable parameters when every eliminated observation is proved absent.
  Callable specialization additionally requires one exact unary endomorphic target
  contract: its checked input and selected result are the identical type. The selected
  result may differ from the checked source result only through the cooperative-effect
  plan's exact return-type projection. Identity implementations at all call sites do not
  erase a converter contract such as `Storage<T> -> T`, `T -> uint32`, or
  `Bytes -> RuntimeSlice<byte>`.

Value copying/storage, generic operations, source-language containers, panic/recovery,
reflection, and package initialization remain canonical without a versioned fact contract.
A GoToTS import, generated shape, name, or support path is ordinary TypeScript, not
semantic evidence; `RuntimeSlice`, `GoMap`, adapters, and defer machinery are never inferred by spelling.

An exact TypeScript identity is not source-language inference. The closed profile may
replace a stable one-argument project callable that returns its parameter. It may also
replace `project(construct(value))` when exact signatures prove one stable class, a sole
`new Class(value)`, one constructor parameter-property store, and projection of that field.
Every identity is joined. Writes, decorators, inheritance, optional/spread/unresolved calls,
constructor statements, different fields, open targets, and unpaired calls retain; names never select the rule.

The inverse pair may cross one local `const` with no annotation, write, export,
identity observation, alias, or non-projector use. Its initializer is the exact
transparent constructor and every reference is a matching projector over the same
field. Binding references and projector arguments join both ways. Rewriting preserves
target-before-argument evaluation; one missing or foreign reference retains all.

The owner may remove a callable parameter only when every parameter reference is one
direct single-argument call, every owner reference is one exact call, and every input is
a proved synchronous identity. Parameter, invocation, and all caller arguments change
atomically. Aliases, writes, optional/spread calls, generators, overloads, class escape,
non-identity inputs, unresolved signatures, or overlapping rewrites retain the candidate.

A future family requires its owner to define every observation (for example slice nilness,
capacity, backing aliases, reslicing, and element addresses), finalize exact-node facts,
and expose a closed profile choice. Until then, canonical retention is the only decision.

Each family has one decision and transformation owner. Families exchange immutable
results before rewriting and never inspect another family's partially rewritten tree.

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

The same owner may eliminate a transparent scalar class declaration only when
every construction and selected-field read belongs to one closed component.
A component may contain an admitted immediate projection or a non-exported
immutable local binding initialized by one exact construction when every
reference to that binding is an exact read of the selected readonly field.
Every remaining class reference must be an exact import, export, or ordinary
type reference, the scalar must have one portable primitive target type, and
neither the class value nor any instance identity may otherwise escape. The
declaration is replaced at the same statement position by one exported or
local `const` sentinel, every type reference becomes the primitive type,
stored constructions become the primitive value, stored field reads become
direct binding reads, and imports remain value imports. Construction lowering
still evaluates the sentinel before the argument. This preserves module
execution, cyclic-import and temporal-dead-zone behavior while removing the
class and every proved instance allocation. Mutable or exported bindings,
identity comparisons, open constructions or projections, default exports,
class-value uses, observable members, and nonportable types retain the complete
class under a closed reason; partial class rewriting is forbidden.

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

Calls selected through an interface member remain canonical under the default
`interfaceDispatch: "open-structural"` profile. The independent
`interfaceDispatch: "declared-closed"` profile is an explicit complete-flow
contract: every runtime implementation that can enter a selected project
interface must resolve to one exact project declaration through a checked value
transport. An authored `implements` edge is one such transport, but is not
required; languages with implicit interfaces produce structurally assignable
values without TypeScript heritage. Structural similarity by itself never
establishes the contract. Under the selected contract, the effect owner creates
one transient family for each reached interface member and exact-joins every
concrete implementation observed at a checker-proven source-type to
target-interface transport. Inside that selected type pair, the checked member
symbol must resolve to one exact project callable declaration. Cooperative
implementations form one bounded bidirectional star and callers depend on its
coordinator; there is no synthetic graph vertex and no implementer clique. The
effect owner also consumes the checker's exact selected signature, authored
argument types, parameter types, and contextual-value types at transport sites.
An ordinary positional call pairs each argument with the corresponding selected
signature parameter. Rest, spread, unresolved signatures, or a parameter-map
mismatch are never approximated: every exposed project contract is an open
boundary. Direct project interface/class surfaces enter the exact structural
member join. Contracts nested inside a container, tuple, union, intersection,
or callable contract remain open unless a separately certified transport
reaches them. An exact project-body transport may preserve a shared nested
contract identity; unmatched nested contracts and nested contracts crossing a
bodyless, ambient, provider, unresolved, rest, or spread boundary remain open.
One narrower outbound case is also closed: an array or object literal may erase
a source-only nested contract when the selected target type carries no matching
contract. Parentheses and authored type operators around that same literal do
not change freshness. This is one-way permission, not an alias or storage
assumption. Every later static re-entry into a project interface is checked
independently through exact resolved-call argument bindings and exact value
origin. Assertions, refinements, opaque call results, ambient identifiers,
ambient properties or elements, aliases initialized from them, and project
results sourced from them retain the reached component. Project properties and
elements remain closed only when both their checker-selected declaration and
their owning value have exact project provenance. A declaration-file interface
may enter only through the separately proved all-synchronous structural
transport described below. Shared values passed outward remain open when their
source contract is still statically visible. Root-pair memoization includes
both opacity and freshness so one safe observation cannot hide a later open
transport.

The owner compares only bounded relevant-contract sets and does not
recursively retain an arbitrary checker object graph. When one direct checked
transport depends on corresponding project interface members, those method
contracts form one atomic component;
same-shaped interfaces with no such transport remain unrelated. Contracts that
share one exact concrete project implementation also form one component. A
project contract transported against an external or otherwise non-rewritable
interface is an open boundary unless the counterpart callable has one or more
exact declaration-file signatures and every instantiated result is definitely
non-thenable. That closed external contract needs no target rewrite and joins
the family as a synchronous implementation obligation. An overload that may
suspend, an unresolved type variable, `any`, `unknown`, or an implementation-
file ambient declaration keeps the boundary open. Member spelling is used only
to join properties inside that exact checker-proven transport, never to
discover a transport or select semantics.
The component's return annotations and interface-call awaits settle only when
every cooperative implementation settles and every other implementation has an
exact synchronous body contract. A
retaining implementation preserves the complete family and every depending
caller. An unresolved value origin, a missing project implementation, or an
unprovable implementation contract prevents family admission.

Semantic queries for a selected member or implementation require the exact AST
object owned by the checked source program. A declaration from another checker
graph is foreign even when it has the same document identity and authored
range; it retains the family before any query. Document identity establishes
provenance, not checker-object membership.

The target does not infer this profile from `implements`, generated names,
runtime bases, or a Cartesian structural-compatibility scan. It adds no dispatch
table, policy parameter, wrapper, marker, or source-language rule. Exact
heritage and exact structural implementations are admitted only when an indexed
checked value transport selects both the source type and target interface. A
same-shaped class that never enters the interface is irrelevant and cannot join
the family.

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

That same immutable contract is the sole authority for interface-bearing values
crossing a certified storage-owner invocation. Its exact result-input edges let
interface ingress follow, for example, the value represented by a validated
pointer load instead of treating the marker declaration as an opaque external
call. Missing transport evidence, an empty result-input set, or an unselected
same-shaped call remains opaque. The interface owner does not duplicate pointer
operation classification or infer transport from a marker name.

Interface ingress follows the value that can exist after successful evaluation,
not a discarded nil branch. A missing/undefined-only or `never` source cannot
inject a dynamic implementation. In `value ?? fail()`, the left value is the
sole successful origin only when the checked fallback type is exactly `never`;
the emitted guard itself remains unchanged. A mutable local or property is
closed only when its initializer and every indexed simple assignment have
closed origins. Compound, iteration, unresolved, or ambient writes retain the
family. This is one complete write-set proof, not an initializer heuristic.

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
This rule has one target-language owner shared by ordinary effect results and
pointer-result projections; the pointer family does not carry a second copy of
the rule.

Settlement reconstructs the complete component atomically: async modifiers,
Promise or exact awaitable-union return members, awaits, and dependent callable
contracts are consumed once by original node identity. Retained candidates may
accumulate several blocking facts, but evidence assigns one canonical reason
using the pinned reason-catalog order. Direct causes remain separately counted
and source-located; their sum is not the retained denominator.

Interface evidence counts contract declarations, connected families, and calls
as separate denominators. Every considered family is exactly one settled or
retained row. Rejected families are retained rows, not omissions from the
denominator. Each retained row records its complete authored contract identity
set, call count, and one closed typed reason selected by the owning decision;
aggregate admitted/rejected counts are projections of those decisions, never a
substitute for them. Interface-boundary retention additionally records every
direct boundary cause with a closed reason and exact authored occurrence; a
boolean boundary flag is only a projection of that ledger.

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

The optimization profile independently selects `pointerFlows`,
`scalarProjections`, `representationProjections`, `cooperativeEffects`, and
`interfaceDispatch`. Omitting
`interfaceDispatch` selects `open-structural`; `declared-closed` is never
implied by cooperative-effect selection.

The immutable evidence artifact binds the canonical profile identity, exact
source membership, selected/retained decisions, typed reasons, index and
planner work counts, runtime contract, and target output membership. Input
semantic and output-membership digests are added only at the layer that owns
those canonical values; they are not fabricated by lowering.

Retained decisions are represented by exact per-reason counts and at most eight
canonical source occurrences per reason. A family plan must not retain every
negative candidate or its AST node merely to construct evidence. The bounded
examples are diagnostics; the exact counts remain the conservation proof.

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
