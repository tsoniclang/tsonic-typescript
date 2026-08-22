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
rereads files, recognizes marker spelling, patches text, or invents Go
semantics. It never changes a source-facing signature merely to make one
implementation convenient.

The target may contribute a versioned source compiler extension before TSTS
seals the checked program. That extension runs inside the one source-checking
transaction and may use exact checker-selected declarations to attach closed
target-runtime or provider facts. It may recognize only an explicit package
identity and a closed exported-API contract; a local same-spelled declaration
or the same export from another package remains ordinary source. Once source
checking seals, target planning and lowering consume only finalized facts and
navigation and never re-enter the checker.

## One Target Pipeline

```text
TSTS source check + versioned target source extensions
                         |
                         v
immutable checked TS-Go AST + finalized exact-node facts
                         |
                         v
validated target profile and complete source membership
                         |
                         v
one immutable target-program index
  (nodes/files, syntax kinds, binding writes, dispatch, source-graph statistics)
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

## Cooperative Effect Module Structure

The cooperative-effect implementation is physically partitioned by semantic
owner under `src/lowering/effect/`:

```text
architecture/                 structural dependency gates
closure/                      blocker propagation and retention decisions
flow/
  aggregate/                  exact aggregate bindings and fixed projections
  callable/                   callable values, aliases, and inputs
  collection/                 collection-carried callable values
  interface/                  contract ingress, implementations, and dispatch
  invocation/                 exact project-call argument and result bindings
  object/                     exact named-property projections
  provider/                   certified provider-call transport
  return/                     return values, callables, and result consumers
  storage/                    fields, owners, and storage transports
  value/                      shared binding and selected-value projections
inventory/                    authored candidate and call census
model/                        shared immutable contracts and AST navigation
planning/                     composition, summaries, file plans, and lifecycle
provenance/                   finite graph, SCC, and closed-origin resolution
rewrite/                      exact consumption of immutable AST plans
test-support/                 test-only checked-source fixture construction
```

Production dependencies point toward semantic prerequisites: `model` and
`provenance` are foundational; `closure` may consume the finite provenance
algebra; `inventory` may consume `model`, `provenance`, and `closure`; `flow`
may consume inventory and those foundations; `planning` composes every domain; and
`rewrite` consumes only finalized planning and model contracts. Reverse edges
are forbidden. Tests are colocated with their owner. The effect root and the
`flow` root contain no loose modules, and catch-all, compatibility, legacy,
helper, utility, or version-suffixed directories are forbidden.

Production consumers outside the family may import only its deliberate narrow
surface: retention reason types, interface evidence, planning contracts and
summaries, and the rewrite transaction. There is no barrel or compatibility
facade exposing internal flow construction. Moving a concern requires deleting
its old path and updating every consumer in the same transaction.

## Program Index

Whole-program families consume one immutable index built once from the
original checked tree. It contains only target-side coordination needed by
more than one family. The current shared denominator is exact node/source-file
membership in source preorder, immutable syntax-kind partitions, canonical
binding-write joins, canonical project-member dispatch, and the source-owned
reference-index statistics copied into optimization evidence. Optional
target-owned facets are built only when the selected profile has a consumer.

Declaration and reverse-reference facts are not a target-program-index facet.
Every target family consumes them directly from the exact
`TargetSourceProgram.navigation` graph supplied by shared Tsonic. The target
must not census reference candidates, construct symbol/declaration reverse
maps, expose a forwarding reference facade, or retain target-owned reference
rows. This source graph is the one semantic owner and the one consumption path.

The index is coordination state, not a second semantic model. TSTS facts remain
the semantic authority. Canonical declaration, reference, import, signature,
call, and alias queries remain at their source-semantic or source-navigation
owner. Reuse by multiple target families does not transfer ownership or justify
a second materialized answer. Family-specific facts stay in their family. A
query whose answer is needed once remains local instead of expanding the index.

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
contract. An expression outside every pointer-rewrite component remains a
canonical location when its checker-selected type resolves to the exact symbol
owned by a certified pointer fact. This covers an inferred result such as a
generic runtime collection returning `Pointer<T>` without treating an ordinary
same-shaped type as a pointer. Cooperative-effect return analysis may consume
these immutable distinctions before either family rewrites the tree. It may
not infer them from the `Pointer` spelling, object shape, or component
membership alone.

One closed pointer-value evidence map is the sole value-membership owner. It is
built once from canonical representation decisions and exact pointer-type
facts, and records the representation plus pointee contract for each exact
value node. It may also index the checker's exact selected declaration for an
identifier, property access, or element access when every pointer annotation
owned by that declaration agrees on both representation and pointee identity.
Conflicting annotations leave that declaration unclassified. For an expression
with no representation entry, that same owner may compare the checker-selected
type symbol against the symbols selected by canonical pointer facts; equality
means the expression is unrewritten canonical location transport. No second
pointer-value index, structural type approximation, retained checker-node set,
or marker-name lookup may duplicate this map.

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
returned by a settling callable, or passed through another such private
forwarder. A discarded invocation retains its async producer because changing
a rejected Promise into a synchronous throw is observable without a separate
exact non-throwing fact. Export, alias escape, ordinary Promise observation,
open dispatch, provider behavior, or unresolved transport retains the
component.

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
signature parameter. Rest and spread calls are admitted only when checked call
evidence exact-joins every authored argument to one contiguous effective
argument sequence and then to the selected ordinary parameter, rest element,
or rest sequence. Missing, duplicated, reordered, unresolved, or internally
inconsistent bindings retain every exposed project contract as an
`inexact-call-bindings` boundary; syntax is never reconstructed heuristically.
Direct project interface/class surfaces enter one recursive structural join.
That join pairs unions by exact selected member, tuple and array elements,
matching generic arguments, callable parameters/results, readable properties,
optional properties, and string/number indexes. An optional source member may
be absent only when the selected target member also accepts absence. An
optional named property may be paired with an exact compatible index domain,
and an index may be supplied by every exact named property in its domain.
Missing, ambiguous, or incompatible children retain only the reached contract
under the closed member or callable reason. The owner distinguishes a
value-bearing contract from a callable capability whose parameter or result
type merely mentions that contract.
Callable result transport compares the direct effect payload, not incidental
`Promise` packaging: `() => Promise<T>` and `() => T | PromiseLike<T>` pair as
`T` only when both types expose one exact fulfillment type and every direct
union member is that same type. Ambiguous thenables, multiple call signatures,
type variables, `any`, and `unknown` retain the reached contract.
Callable parameters are paired contravariantly. Consequently the exact
concrete implementation may occur on either side of a nested member pair; the
single implementation ledger records the checker-selected concrete type in
both orientations instead of treating the reverse orientation as an untrusted
callable member.
Readable fields, indexes, tuple elements, array elements, unions, and
intersections carry values. A call or construct signature does not carry one
of its parameter or result values until that operation occurs; every project
invocation is checked independently. An opaque call that returns only such a
capability therefore does not fabricate a nested interface value, while an
opaque result with a readable interface-bearing field or element remains open.
Passing a project callable outward records each exact project implementation
parameter as a potential opaque input before any value-origin decision runs.
That root retains only a contract actually reached from the parameter through
an interface call, project forwarding call, or writable project storage; an
unused parameter or a use that cannot observe interface behavior does not
retain an unrelated contract. A callback without one exact project body, an
inexact argument binding, or an ambiguous callable shape remains conservative.
Opaque calls are directional rather than globally opaque: return values,
reached provider-invoked callback inputs, and externally writable shared
properties, indexes, or sequence elements are ingress and remain open; a fresh
outbound aggregate or an exact shared readonly projection cannot receive a
replacement value and may remain closed. Exact project-body transport may
preserve a shared nested contract identity. Unmatched value-bearing contracts
and any ambiguous opaque direction remain open.
The value-bearing walk is cycle-safe and finite; exceeding its fixed type
budget falls back to the broader relevant-contract set rather than granting
settlement.
One-way outbound erasure is also closed for an exact fresh array or object
literal when the selected target type carries no matching contract. Parentheses
and authored type operators around that literal do not change freshness.
Conditional, nullish/logical, comma, simple-assignment, array-element, and
object-member value origins are closed only when every value-producing branch
recursively proves the same reached contract; method/accessor declarations do
not fabricate stored values. This is one-way permission, not an alias or
storage assumption. Every later static re-entry into a project interface is
checked independently through exact resolved-call argument bindings and exact
value origin. Assertions, user refinements, opaque call results, ambient
identifiers, ambient properties or elements, aliases initialized from them,
and project results sourced from them retain the reached component. An exact
project class declaration used as a value is analyzed through its checked
static-side type; constructing that class is analyzed separately through its
instance type. Project properties and elements remain closed only when both
their checker-selected declaration and their owning value have exact project
provenance. A declaration-file concrete
type or interface may enter only when its selected callable member has one or
more exact declaration-file signatures, every instantiated result is
definitely non-thenable, and the checked source type exact-joins that member to
the reached project contract. Shared writable values passed outward remain
open; shared readonly and fresh values are analyzed by the directional rule
above. Root-pair memoization separates fresh and shared observations so one
safe observation cannot hide a later open transport.
An exact awaited project call has the same value provenance as that call: its
body-to-result transport is independently analyzed before family admission.
Await does not make an ambient, bodyless, unresolved, or non-call expression
transparent.

The owner compares only bounded relevant-contract sets and does not
recursively retain an arbitrary checker object graph. When one direct checked
transport depends on corresponding project interface members, those method
contracts form one atomic component;
same-shaped interfaces with no such transport remain unrelated. Contracts that
share one exact concrete project implementation also form one component. A
declared class admits implementation evidence independently for each reached
member contract. One unresolved sibling contract remains open but does not
erase an exact implementation for another member; a union-valued source still
requires every selected union member to resolve for that one contract. A
project contract transported against an external or otherwise non-rewritable
type is an open boundary unless the counterpart callable has one or more exact
declaration-file signatures and every instantiated result is definitely
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

Fixed aggregate projection has one shared structural owner for callable and
return-value flow. It admits a direct array/tuple source, or a `const`
identifier initialized from one exact array/tuple-producing call, only when
every reference to that identifier is a non-optional fixed numeric element
read. An aggregate escape, element write, update, dynamic index, spread slot,
or unresolved producer invalidates the complete binding. For an admitted
projection such as `const pair = await choose(); pair[0]`, consumers follow
that exact slot through every direct array return, conditional branch, and
closed project forwarder. Callable flow also rewrites the callable contract at
that same tuple slot for every traversed producer; it never treats another
slot, a same-shaped aggregate, or a result type alone as value-origin proof.
The callable transport is bidirectionally closed: every invocation of each
traversed producer must participate in that same selected slot, and every
projected consumer must be an immediate call target or enter callable storage
that the ordinary storage closure has already admitted. One escaped producer
result or projected callable retains the complete affected flow. Projection
discovery uses indexed linear joins and is not reimplemented by either
consumer. Its root domain contains exact invoked targets and expressions whose
checked type contains a call signature; unrelated scalar expressions never
enter the value-slot graph. A call already resolved to one exact project
implementation belongs to the project-invocation owner and does not enter
callable-projection discovery, including when that target is a property or
element access. A same-shaped access used as a method value remains in the
projection domain; exclusion is by exact call-target node identity, never by
member spelling or type shape. The invoked-target admission keeps unresolved
checker-selected calls whose apparent type is open, while the graph still fails
those calls closed when their provenance is not exact.
After graph resolution, only closed value-slot roots materialize their exact
origins and contract steps. An open root publishes the closed bit and no
positive evidence; expanding transitive origins for a root that cannot be
consumed is forbidden work, not conservative analysis.
Each semantic consumer supplies that root domain from its own positive facts.
Callable flow uses checked callable projection candidates, interface flow uses
the exact values in its origin-requirement ledger, and return/result-consumer
flow uses the aggregate projection owner's exact positive read roots. An empty
default root set is never treated as completed analysis, and restoring every
identifier as a root is forbidden whole-program work. The selected graph is
expanded by an explicit worklist. Authored alias, call-result, and binding depth
may increase graph size but may never consume the JavaScript call stack.
If one active provenance ancestry revisits the same occurrence and state kind
with a strictly longer path ending in the prior path, no finite slot origin has
been proven. That state records a `recursive-slot` boundary and stops; an
independent root or sibling path is not recurrence evidence.

Within one callable-flow construction, call-result projection is the sole
value-slot graph owner. Certified invocation-transport result origins enter
that owner's call-source lookup before the graph is sealed, so a projected
transport result and an ordinary project result use the same graph and
completeness audit. Callable provenance consumes the finalized result lookup;
it may not construct a second graph over the same candidate domain.

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

Every cyclic effect-flow problem uses one finite provenance algebra. A semantic
owner creates exact node-identity vertices, typed dependency edges carrying the
authored occurrence that established each edge, explicit origins, and explicit
closed boundary reasons. The graph builder is mutable only during that owner's
single construction transaction. Sealing copies and freezes its compact
ledgers and permanently rejects another seal or mutation. Consumers cannot
reach builder storage.

Resolution condenses strongly connected components once, then propagates
origins and boundaries over the acyclic component graph. A value is closed only
when its complete dependency closure contains at least one exact origin and no
boundary. Cycles therefore neither recurse nor become proof by themselves.
Callable, return, result-consumer, selected-value-slot, and blocker flows share
this algebra but remain separate semantic graphs with separate owners and
reason catalogs; there is no universal effect IR and no flow may read another
flow's mutable construction state.

Condensation stores graph adjacency and vertex-to-component identity in compact
typed arrays. Component dependencies and direct evidence are sparse: a
component with no edge, origin, or boundary allocates no collection object.
The public capability exposes only the component count and exact vertex lookup,
not mutable arrays or one retained vertex array per component. Dense empty
adjacency/evidence tables are forbidden because source-sized mostly-acyclic
graphs would otherwise consume object memory proportional to several full ASTs.

Semantic origin classes are projected from that sealed component graph through
one provenance-owned persistent-set index. Callable candidate,
definitely-synchronous, and return-dependency counts are constant-time facts,
equal sets share structure, and enumeration remains lazy until a consumer
requests the exact nodes. An accumulating dependency chain must add logarithmic
structural work per new origin; eagerly flattening the complete transitive
origin array for every intermediate component, expression, or call is forbidden
quadratic work. The provenance resolver remains the sole owner of component
identity and component dependencies; semantic projections consume its
read-only component and dependency capabilities and may not reconstruct another
SCC or component graph.

An origin class selects its value from the exact origin record rather than only
from the authored occurrence. Node-valued consumers select the occurrence;
value-slot consumers select the origin vertex so two path states attached to
the same authored call remain distinct. The persistent index is generic over
that selected value. A consumer may not recover vertex-sensitive evidence by
deduplicating authored nodes or by reading the resolver's flattened
`originEvidence` capability.

The origin index is sparse by component as well as persistent by value. Direct
and propagated rows exist only for components carrying at least one selected
origin, while dependency adjacency exists only for components with edges. It
queries the resolver's canonical component identity instead of retaining a
second vertex-to-component array. One empty set or array per component is a
forbidden dense shadow of the resolver.

Every published effect-flow capability is finalized across a lexical lifecycle
boundary. Its closure is created by a dedicated finalizer that receives only
the sealed maps and sets the capability needs. Census counts, reference audits,
temporary candidate ledgers, construction worklists, and graph builders remain
in the caller and cannot be retained accidentally by a JavaScript function
context. Returning methods directly from the construction function is forbidden
when that function also owns source-sized transient state.

An indirect-invocation analysis has two explicit lifetimes. Its refinable
construction capability may retain the candidate domain only while closure is
being settled. Before interface, callable, or return flow consumes the result,
it must project through a finalizer into immutable invocation-input,
implementation, and admitted-reference query facts. Callable provenance follows
the same rule: graph construction and resolution end before a separate
finalizer publishes call resolution, admitted-reference, signature-family, and
settled-return queries. A finalized query may not close over the source program,
the refinable analysis, its candidate domain, or a graph builder.

Return-local identity flow is demand-driven. Starting from a local reference
actually reached by return provenance, it walks initializers, exact binding
writes, and the source-owned reverse-reference graph in both directions to
close that local identity component. It then audits every read in the component
before admitting any member. Unrelated variable declarations allocate no
return-flow topology. A whole-program variable inventory, one empty adjacency
set per local, or a scan over unrelated locals is forbidden work; exported,
cross-scope, captured, or otherwise unaccounted references still fail the
reached component closed.

Return provenance distinguishes query roots from recursively discovered
construction states. Finalization retains only each query root's canonical
component vertex, clears every transient expression and declaration
construction map, and materializes a component-shared immutable resolution on
first consumer query. Eagerly resolving every query root, building a second
all-expression resolution map, retaining recursive construction states, or
publishing a resolution for an expression outside the inventoried query domain
is forbidden.

Synchronous-call dependency closure is computed from those graph resolutions.
Collection, storage, interface, and returned-callable contracts project from
canonical resolutions and exact invocation/value projections; they do not
reimplement recursive resolution or maintain a sibling compatibility graph.
Finalized callable-value resolutions are immutable snapshots exposing only
closed state, counts, and iterators over deduplicated exact origins. Changing an
input collection after construction cannot change a resolution.

Blocker propagation uses the same typed-edge vocabulary. Every candidate
dependency must exact-join a non-empty edge-kind/occurrence ledger before SCC
condensation. Every propagated retained reason has one deterministic nearest
direct root and a typed occurrence path to that root. A dependency without
evidence, a foreign candidate, an originless cycle, or an unaccounted boundary
fails closed rather than falling back to an untyped recursive walk.

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

That inventory is one immutable, positive-only owner topology for the complete
effect-planning transaction. It stores only nodes and edges that carry an
owner; it never records negative membership decisions. Preliminary indirect
closure, interface-seeded closure, and final callable flow consume the same
topology. Rebuilding its whole-program type and invocation scan per closure
round or per consumer is forbidden.

All effect flows share one exact project-invocation owner. It validates the
checker-selected call, selected signature declaration, sole project
implementation, authored arguments, and every effective argument binding
before exposing any parameter input. Overload contracts map to their one
checker-backed implementation through source navigation; consumers never pair
arguments and parameters independently by array position. A non-rest
implementation parameter may retain its exact value input even when a separate
rest, spread, omitted, or defaulted slot cannot be represented. The unresolved
slot alone remains open. Missing, ambiguous, inapplicable, or corrupt evidence
grants no transport permission.

Indirect project invocation is a separate exact extension of that owner. The
callable target is resolved from one node-identity provenance graph over local
bindings, closed project storage, object and aggregate projections, exact
project returns, and certified invocation transports. A call is admitted only
when its complete implementation closure is non-empty and every callable
origin is one dispatch-closed project body. Exact `undefined` or nullish reset
origins close optional callable storage but are never implementation origins;
every other non-callable origin remains open. Admitted implementation calls
extend the same invocation-input index through the canonical selected-call
binding owner. The extension is recomputed to a stable exact call-to-
implementation relation so a callback forwarded through an already resolved
indirect call can resolve a later indirect call. Each round also supplies the
prior exact implementation relation to project-return and storage projection,
allowing a callable returned by one indirect call to become a later target. A
repeated non-stable relation, an originless cycle, or an open origin discards
the indirect extension rather than retaining a partial guess.

The stable state also contains the exact reference paths contributing to every
closed indirect target. Those paths come from the same closed provenance
component, not from a second reference walk. The next round may use them to
close callable parameters, locals, fields, readonly constructor properties,
collection extraction, and storage-owner aliases while continuing to audit
every sibling reference. A reference admitted by one closed call does not
excuse a separate export, mutation, construction, property observation, or
otherwise open use. The relation and its reference paths stabilize together;
neither may be published from a partially stable round.

Indirect implementation origins use the same persistent component-indexed
origin algebra as callable and return flow. Nullish reset evidence remains a
terminal origin for closure but is outside the callable-origin class. A round
may iterate only the exact callable class selected for a closed root; it may
not flatten or deduplicate the complete transitive origin evidence per call.

Fact-owned transport is available to the first indirect closure. Declared
interface ingress consumes that closure and contributes its exact invocation
inputs, call implementations, closed reference paths, and derived transports.
Its call-result and value-slot owners therefore inspect a preliminary indirect
implementation exactly as they inspect a direct implementation. The final
indirect closure refines that stable relation on the same immutable projection
root domain, seeded by admitted interface call and declaration implementations
and consuming the complete input and transport set. It does not restart from an
empty relation or reconstruct the source-sized candidate census. This closes
callbacks returned by an interface call without a spelling join. Extracted
interface method values remain open unless a separate exact receiver-binding
fact owns their method-value semantics. Every later callable, return, storage,
and result-consumer flow consumes that final immutable invocation-input index,
implementation relation, and reference closure. No consumer may reconstruct an
indirect binding, use a preliminary index after the final closure exists, or
treat an open callable resolution as an exact implementation list.

Each callable-value census has a separate collection and finalization
lifecycle. Source-sized reference counts, constructor ledgers, and mutable
admission state die with the collection frame. Only sealed value, contract,
closed-declaration, and exact-reference indexes enter the final capability
object. A finalizer may not close over a collection frame or retain its
transient maps across an indirect-closure round.

Callable-reference closure is likewise one finalized fact of callable
provenance. Removing `async` preserves function-object identity, nullishness,
truthiness, `typeof`, discarded `void`/expression uses, and strict identity
comparisons; those observations do not constitute an escape. Calls, exact
aliases, and certified transports remain governed by their existing owners.
Properties, construction, coercion, reflection, export, or any other
observation remain open. Storage ingress and reverse-caller analysis may
consume the finalized callable-reference fact; they may not re-walk aliases or
admit a reference merely because it occurs near a call.

Return-value provenance follows exact direct, interface, and closed indirect
implementations, final invocation inputs, local writes, closed nominal
storage, projections, and certified result origins through the finite
provenance algebra. A closed uninitialized local or field contributes the
exact JavaScript `undefined` origin. A generic return is not rejected merely
because its declaration contains a type parameter: its complete closed call
inputs and return flow decide whether the selected instantiations can contain
a thenable. An ambient or externally callable declaration contributes open
input even when the selected project has internal calls. Any open use or
thenable origin retains the complete affected component.

Promise-result consumer closure is directional. An exact await, private
reverse-call chain, exact binding, closed storage transfer, or right-hand
conditional/logical value flow may consume a result without observing Promise
packaging. A discarded invocation remains a boundary because rejection versus
synchronous throw is observable. A Promise-valued left logical operand,
callable or constructor target, public/open forwarder, exported storage,
property or identity observation, or opaque argument also remains a boundary.
Reverse-call closure consumes only final closed callable-reference and
implementation facts, including exact indirect calls.

Result-consumer provenance is rooted only at calls for which call-use
classification can request consumer proof: direct cooperative calls, exact
interface calls, and closed callable-value calls that are neither awaited,
discarded, nor returned by an enclosing cooperative candidate. Unrelated calls
may contribute to reverse-call or projection facts only when reached from one
of those roots; they are never independent graph roots. Consumer flow consumes
the planning transaction's one closed-storage-owner set and runs before return
flow, publishing only immutable call decisions and bounded evidence. Rooting
every call expression, rebuilding storage ownership, or retaining its transient
graph alongside return provenance is forbidden duplicate whole-program work.

An abstract project member is the one intentional multi-implementation form of
that contract. The declared-closed profile may expose it as invocation
transport only after the existing checked value-flow owner proves the receiver
has a closed origin, every reached implementation is one exact project body,
and the complete contract component has no ambient input, output, override, or
unresolved member. Every authored argument is then an exact internal input and
the receiver is the result carrier; ordinary parameter, return, assignment,
and escape analysis still verifies every value entering or leaving that
carrier. This permits a nominal project container such as `Carrier<T>` to move
`T` through its abstract `replace` and `current` members without making either
call opaque. It does not recognize the carrier or member by spelling, scan all
structurally similar classes, or grant permission to an external subclass,
ambient result, bodyless implementation, unrelated same-shaped member, or
open receiver. The derived transport is composed with fact-owned transports
through one conflict-rejecting owner before callable, storage, and return flow
consume it.

Certified provider invocation transport enters through one target option that
selects sealed provider manifests relative to the project root. A source
extension validates each manifest digest and its independently versioned
invocation-transport section. That section names one declaration root and the
exact normalized `.d.ts` path certified from the provider package's
`exports.types` target. The extension selects exactly one exported class and
one static method in that file, verifies its checked callable type, indexes its
declaration-node identity, and attaches the immutable transport record only
when a call's selected declaration is that exact node. Lowering never matches
provider or member spelling in authored source. A local same-shaped API,
another declaration file, overload ambiguity, stale callable type, duplicate
semantic owner, absent declaration, or unresolved call receives no fact.
Generic callable flow may query a referenced declaration only when the checked
semantic program contains that exact source-file object. Resolving a project
implementation additionally requires navigation-owned project identity; an
included declaration-file callable contributes only its exact trusted
non-thenable contract. A provider or other foreign declaration excluded from
the semantic program and lacking certified transport remains opaque; generic
flow must not query its declaration semantics as an alternate cross-boundary
route.
All fact-owned invocation transports are composed before interface ingress,
callable flow, storage flow, or return flow begins. No consumer may observe a
partially assembled transport set. Interface dispatch may subsequently add
closed abstract-dispatch transport; that derived transport is composed once
with the already complete fact-owned set for later consumers, without
re-running interface ingress.

Direct records identify exact argument ingress and result-origin parameters.
State records additionally identify carrier creation, transparent carrier
aliasing, and reads or writes on one carrier parameter. The effect owner grants
state transport only when every checked reference to a project carrier is an
accounted creation, alias, access, or transparent project storage edge. Every
read then receives every write value in that exact carrier component as a
possible origin. Any ambient carrier, unknown assignment, unsupported provider
operation, or escape retains the complete component. Thus a certified
`Map.Store(cache, key, callback)` followed by `Map.Load(cache, key)` can preserve
the callback's exact origin without turning provider storage into a global
semantic exception.

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

The complete closed-owner set and its positive topology are one plan-owned
analysis. Callable storage consumes an exact owner subset view of that same
topology; return storage consumes the complete view. Subset audits must ignore
unselected owners while preserving every selected-owner boundary and
dependency. Neither consumer may reconstruct the carrier or occurrence
topology, and no round may retain a second copy.

The pointer family may certify owner transport for validated `address-of`,
`allocate`, `load`, `store`, pointer-equality, and pointer-hash facts. The effect
owner consumes those exact-node facts through an immutable transport contract;
it does not recognize imports or calls by spelling. A selected `bind-pointer`
or `project-pointer` fact also proves that the marker invocation itself does
not hand its callbacks to an opaque external consumer. It does not prove a
result origin: bind/project results remain open until a separate exact value
flow supplies one. Thus transport presence and result provenance are distinct,
and an external call with the same signature or name cannot inherit either
permission.

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
variables, and open structural members remain retained when they own or can
alter the `then` contract. An unrelated generic argument does not invalidate a
nominal exclusion: `RuntimeSlice<T>` remains non-thenable when the selected
class itself declares private readonly `then?: never`, regardless of `T`.
This is target-language Promise-assimilation evidence, not marker or
source-language recognition.
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
set, call count, one closed typed owner reason, and the closed boundary reasons
that apply to that family; aggregate admitted/rejected counts are projections
of those decisions, never a substitute for them. One boundary ledger assigns
each exact authored occurrence a compact identity once and joins it only to the
contracts reachable from the checked transported value. Budget exhaustion
reselects those exact relevant contracts from the root; it never poisons every
project contract. For each closed boundary reason, evidence reports the exact
unique occurrence count and at most eight canonical occurrences. A boolean
boundary flag is only a projection of that ledger.

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
canonical source occurrences per reason. Family rows may reference the same
bounded reason evidence but may not copy its complete occurrence set. A family
plan must not retain every negative candidate or its AST node merely to
construct evidence. The bounded examples are diagnostics; the exact counts
remain the conservation proof.

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
