# Verification

## Proof Principle

An optimization is accepted only when its complete semantic class, decision
denominator, transformed AST, behavior, cost, and retained boundary are proven
at one clean revision. A faster sample is not architectural proof.

## Family Gate

Every admitted representation family must provide:

1. ordinary, boundary, adversarial, recursive, aliased, and cross-file source
   fixtures where applicable;
2. exact selected, optimized, and retained denominators;
3. closed typed reasons for every retained component;
4. exact-node fact and program-index consumption, with zero missing/duplicate
   rows;
5. TS-Go-contract AST shape inspection before printing;
6. strict output typechecking with `skipLibCheck: false`;
7. executable differential behavior against canonical output or the pinned
   source oracle;
8. a production-path mutation that fails at the family owner;
9. deterministic work counts plus bounded timing/RSS corroboration; and
10. broad searches proving the superseded scan, wrapper, helper, and alternate
    route are absent.

Admission itself is verified. The configured family set must exact-match the
implemented planners and evidence schema. Unsupported keys fail validation;
they do not create empty planners. Tests also prove that GoToTS runtime imports,
support paths, and declaration spellings select no target semantics. Source
membership is retained exactly while the shared input has no executable-root
and side-effect contract; a mutation that prunes an unrooted-looking file must
fail the membership transaction.

## Planner Proof

The shared target-program index is independently reconciled against the
original checked tree. Tests delete and duplicate census rows, mis-parent a
node into another source-file partition, misclassify kind partitions, omit or
duplicate binding-write rows, and alter dispatch answers. Dispatch tests
cover cross-file base/derived overrides, static and instance members, private
members, computed names, properties, accessors, overload declarations,
declaration-only members, and external heritage. Binding-write tests cover
assignment, compound assignment, update, destructuring, iteration, property,
and read-only occurrences.

Source-reference ownership tests prove target index construction performs zero
direct or reverse-reference queries, exposes no forwarding reference facade,
and records the exact source-owned graph statistics in evidence. Target flow
tests mutate the supplied source-navigation result and must retain the complete
affected flow. Shared Tsonic owns independent omission, duplication,
re-parenting, and foreign-node mutations for the graph itself. Broad searches
prove that no target family constructs a second whole-program reverse-reference
index or retains a target-owned reference row. A structural mutation gate also
requires declaration-bounded callable and storage consumers to query the
source-owned reverse graph directly and rejects restoration of identifier or
mixed-reference bucket scans at those owners.

A scaling fixture doubles nodes and edges while keeping shape constant. Actual
index/planner operation counts must grow proportionally; a quadratic control
must be distinguishable. Wall time is supporting evidence only.
The provenance-origin fixture additionally grows an accumulating dependency
chain in which each component contributes one new exact origin. It asserts the
final origin multiset and near-linear persistent-set construction work for the
shared callable/return mechanism. Restoring eager transitive arrays must exceed
the frozen work ratio even when the final exact origin count remains correct. A
component-dependency gate proves the shared index consumes resolver-owned
component identities and edges rather than re-deriving SCCs or edge
orientation; structural inspection rejects callable or return consumers that
flatten transitive origin arrays, duplicate vertex-to-component identity, or
allocate empty origin/dependency rows for every component.
The condensation mutation gate rejects one empty array/set per vertex or
component and requires compact typed adjacency plus sparse component evidence.
A mostly-isolated graph fixture preserves exact component counts and a bounded
work ratio while querying only selected roots.
A shared-tail boundary fixture exact-checks independent reason reachability and
the full diagnostic evidence. Structural inspection requires interface-origin
decisions to use the compact reason query and rejects restoration of
transitive-boundary array filtering at that owner.
The return-local fixture proves both directions of an exact alias component and
contrasts awaited, returned, captured, and escaped reads. A structural gate
requires demand-driven source-reference traversal and rejects restoration of a
whole-program variable-declaration inventory. Unrelated-local scaling must not
change the number of analyzed return-local components.
Return finalization tests create deep shared provenance tails and assert that
only inventoried call/await/return roots remain queryable after construction.
Those roots retain only their canonical provenance vertex; immutable component
resolutions are materialized on first consumer query and shared thereafter.
A structural mutation that eagerly resolves every inventoried root, restores a
second expression-resolution map, or omits transient-map clearing must fail.
Retention-evidence scaling separately grows negative decisions while asserting
exact counts, deterministic ordering, and a fixed eight-occurrence maximum.
Restoring raw retained-node or per-candidate decision ledgers must fail the
structural gate or the guarded whole-product memory bound.

## Effect Structure Gate

A mechanical source-tree gate exact-checks the cooperative-effect directory
taxonomy, requires every module to live below a semantic owner, and forbids
loose files at the effect and flow roots. It rejects catch-all, compatibility,
legacy, helper, utility, and version-suffixed directories and enforces the
maintained-file line limit.

The same gate resolves every relative production import and checks the closed
dependency graph: model and provenance foundations, closure, inventory, flow,
planning, then rewrite. It also rejects production consumers outside the family that
reach past the documented narrow surface. Test-support modules must retain the
`.test-support.ts` suffix so they cannot enter the published package. Build and
broad-search proofs must find no old flat path or compatibility re-export.

Pointer contract tests exact-join canonical pointer types and operation facts
to the complete target component. They cover pointer-bearing parameters,
results, direct calls, aliases, fresh allocations, repeated addresses, nil,
load, mutation through two aliases, equality, hash, provider binding,
projection, and canonical retention. Mutations change a pointee, operation
kind, location identity, nil union, provider read/write binding, projection,
definition/reference edge, caller mapping, or settled hash-nullability row;
each fails before rewriting.
Boundary fixtures pair a generic contract or projection with a disconnected
pointer flow over the same pointee class. They prove the boundary component
remains canonical while the independently closed component stays direct; a
mutation that spreads one boundary across the whole pointee family must fail.
Target tests must not use marker spelling, a scalar authored signature, or a
GoToTS-specific configuration key as proof.

Scalar contract tests independently enumerate immediate construction
projections and exact-join every original node to one optimized or retained
decision. The retained counts and examples are partitioned by the closed
reasons in the architecture specification. Fixtures cover same-file and
cross-file declarations, imports, aliases, binding writes, observable
construction, readonly and mutable fields, scalar and non-scalar values,
portable and nonportable result types, exact call/property identity,
evaluation order, precedence, and target-before-argument failure behavior.
Mutations omit a decision, change selected field identity, substitute a
foreign plan, and claim a retained result as lowered; each fails at the scalar
owner or shared lowered-value boundary before rewriting.
Scalar-class tests exact-partition every transparent-class candidate into one
eliminated or retained row. They prove cross-file imports remain runtime
imports, the same-position sentinel preserves constructor-target evaluation,
portable type references are rewritten, immutable local construction/field
flows become direct primitive bindings, and no class, construction, or field
projection survives an admitted component. Boundary cases export or mutate a
stored value, compare instance identity, expose the constructor value, add an
observable member, or make the result type nonportable. Mutations omit one
rewrite or change the exact stored declaration/reference join; each retains
the whole class or fails at exact rewrite consumption.

Cooperative-effect tests independently count every async callable syntax form
before selection and exact-partition the count into settled and retained rows.
They cover direct calls, recursion, exact methods and method values, immutable
aliases, callbacks, storage, return projections, cross-file flow, private
synchronous result forwarders, provider and open boundaries, inferred and
incompatible contracts, and overlapping blockers. AST inspection proves that
settlement consumes each async modifier, await, Promise/awaitable return node,
and dependent callable contract exactly once. Mutations restore the early
candidate filter, omit a call/result edge, open one consumer, change one union
member, or count one blocked candidate under multiple reasons; each must fail
at the effect inventory, closure, transform-consumption, or evidence gate.
The return-boundary matrix contrasts an open structural result, a public
`readonly then?: never` result, and a nominal
`private readonly then?: never` result: only the nominal contract settles.

Target-runtime return facts are attached during the source-checking
transaction from the exact selected declaration of a closed runtime export.
Fixtures cover namespace imports, aliased named imports, nested project
forwarders, a local same-spelled function, an uncertified runtime export, the
same export from another package, and a certified operation whose actual
result remains thenable. Lowering must consume only the finalized call fact;
removing the source extension or substituting another declaration retains the
cooperative boundary.

Declared-interface fixtures run under both interface-dispatch profiles. The
open profile preserves the interface signature, interface calls, their callers,
and their awaits; independently closed concrete methods may still settle. The
declared-closed profile covers explicit and implicit implementations, multiple
implementations, inherited interfaces and implementations, distinct
same-shaped interfaces, generic transports, cross-file edges, synchronous plus
settling implementations, and calls sharing one line. A same-shaped class with
no checked value transport into the interface must not join the family.
It also transports exact declaration-file synchronous concrete and interface
types into a project Awaitable interface and contrasts declaration-file
Awaitable/Promise, generic-unresolved, and implementation-file ambient
counterparts; only a fully synchronous exact external contract may settle.
Nested-transport fixtures contrast two exact project carriers preserving the
same contract identity with a carrier changing contract identity and an
ambient consumer. Only the exact project-body transport may settle; mutating
either side to the unmatched or ambient form must retain the family.
The nested matrix recursively covers exact union members, tuples, arrays,
matching generic arguments, callable parameters/results, optional properties,
and string/number index signatures. Mutations drop or duplicate one selected
union member, alter one type argument, make an optional target required,
remove a property provider, substitute an incompatible index domain, or make a
callable result thenable; each must retain the reached contract at the nested
member/callable owner rather than flattening the type to a mention set.
Callable-result fixtures additionally pair `Promise<T>` with
`T | PromiseLike<T>` through the one exact direct payload. Mutations introduce
a second fulfillment payload, an ambiguous thenable signature, `any`,
`unknown`, or an unresolved type variable; each must retain rather than erase
effect packaging approximately.
The nested callable matrix includes a contravariant member whose interface is
on the source side and exact concrete implementation is on the target side. A
mutation that records implementations only in the forward orientation must
retain that family as `untrusted-callable-member` and fail.
Capability fixtures pass an immediate adapter resolver whose external factory
result exposes the project type only through call and construct signatures;
that mention must not become value ingress. A mutation that restores generic-
argument-as-value classification retains the family. Counter-fixtures place an
interface in a readable provider result and in a parameter of an outward
project callback. The callback case pre-collects exact project parameter roots
and retains only when that parameter reaches interface dispatch, project
forwarding, or writable storage; a no-use callback must settle, while direct
and forwarded dispatch must retain independently of source order. A mutation
that restores whole-signature poisoning makes the no-use case fail; a mutation
that drops opaque-root propagation makes the dispatch cases fail. A bodyless,
overloaded-ambiguous, or inexactly bound callback remains conservative.
Directional
fixtures contrast fresh outbound literals and shared readonly aggregates with
shared writable properties, indexes, and sequences. The first two cannot
receive a replacement interface value and may settle; every writable or
provider-invoked path must retain. Mutations reverse one direction, drop
readonly evidence, reuse fresh memoization for a shared value, or treat
callable input as capability-only; each must settle or retain incorrectly and
fail.
One-way erasure fixtures pass a fresh array literal to an opaque callable, then
contrast that case with a shared typed array and with a fresh literal assigned
to erased storage and later recovered directly or through an opaque identity.
The outbound-only literal may settle; every recovered path must retain. Ingress
fixtures independently cover an opaque result, a user refinement, ambient
property and element access, an inferred ambient alias, and a project function
returning ambient storage. A paired exact project object/property path must
still settle. A project class value entering an interface exercises its checked
static side independently from `new` and its instance side. Mutations that
replace the project root with any ambient source, trust a user refinement,
confuse class static and instance types, remove the re-entry check, or classify
the selected property without its owner must fail at the interface-origin
gate. These proofs establish that freshness and control-flow narrowing are
never general storage or alias exemptions.
Composite-origin fixtures additionally cover conditional, nullish/logical,
comma and simple-assignment expressions, array elements, object properties,
shorthand properties, and object spread. Every value-producing branch must
prove the same reached contract. Replacing one branch with an ambient value,
dropping one object value, or treating a method/accessor declaration as stored
data must fail at `unproven-value-origin`.

Resolved-call fixtures exact-join ordinary arguments, fixed tuple spreads,
variadic tuple spreads, and open sequence spreads into rest parameters. The
authored argument set, effective argument ordinals, spread-element ordinals,
parameter indexes, and parameter forms are all consumed. Mutations omit,
duplicate, reorder, or retarget one binding and must retain the affected
contract as `inexact-call-bindings`; no syntax-derived fallback may pass.
The generated-storage fixture initializes an optional interface to undefined,
then assigns one exact project implementation and reads it through a certified
pointer load guarded by `pointer ?? neverReturningFailure()`. The family must
settle. Mutations add one ambient interface write or replace the never-returning
fallback with an open pointer; each must retain the family with its exact cause.
It exact-joins each selected member to every reached project implementation and consumes
each interface return annotation once. Mutations omit the profile, remove or
change one exact implementation edge, substitute an unrelated same-shaped class or
same-named member, substitute a foreign checker node with the same source
identity, leave one implementation genuinely suspending, or omit the interface
return rewrite; each retains the family or fails its exact join before querying
foreign semantics.
A declared class implementing two project contracts, one through an exact
project body and one through an ambient base member, must admit only the exact
contract. A mutation that restores class-wide all-or-nothing admission must
retain both and fail the per-contract implementation count.
An awaited exact project result whose body returns one exact implementation
must settle the same interface family as the unawaited project result. Replacing
its producer with an ambient declaration must retain the family, proving await
itself grants no provenance.
Evidence reports contract, implementation-edge, settled-family, retained-family,
settled-callable, and settled-await counts separately. The family denominator
must exact-partition into settled and retained rows, including rejected
families. Every retained row carries all contract occurrence identities, its
call count, one closed typed owner reason, and its closed boundary-reason set; a
mutation that drops rejected families from the retained denominator or erases
one reason fails the evidence gate. The boundary ledger independently counts
every unique source occurrence per reason while retaining at most eight
canonical examples. Mutations that replace the ledger with a boolean, spread
one root boundary to an unrelated contract, duplicate one occurrence across
families, drop a cause, change an exact count, retain raw occurrence nodes, or
exceed the example bound fail the same gate.
Every product checkpoint also reports family and occurrence counts for
`unproven-value-origin`, `unmatched-nested-contract`,
`opaque-call-transport`, `untrusted-callable-member`,
`missing-transport-member`, and `inexact-call-bindings`, plus generated
`async` and `await` syntax counts, against the frozen parent artifact. A
reduction is accepted only with the focused positive and adversarial proofs
above; a retained residual is evidence, not a reason to remove `Promise`
syntax heuristically.
The construction matrix repeats that proof through inheritance and contrasts a
derived nominal result with public-structural and unmarked bases. Callable
`then`, `any`, `unknown`, generic, union, intersection, and hidden-thenable
assignments prevent a false proof.

Callable-storage fixtures include generated-shaped public mutable constructor
fields, nested project carriers, and exact pointer transport. Positive proofs
settle construction, copy, write, read, indirect invocation, and
`address-of`/`load`/`store` as one component. Negative mutations introduce a
constructor alias, derived class, ambient owner source or sink, widening,
provider callable write, field-value escape, or unselected pointer-like call;
each preserves every affected async callable. A project carrier that later
escapes must invalidate the enclosed owner, while the same carrier wholly
inside the checked program remains eligible. Pointer transport permission
comes from validated operation facts, never marker spelling.
Resolved-call fixtures exact-join ordinary, overloaded, rest-bearing, tuple-
spread, and sequence-spread calls to the selected contract. A callback bound
to one ordinary implementation parameter must remain provable when a separate
rest slot is unresolved. Mutations change the selected declaration, source or
effective argument index, parameter index, spread form, spread element index,
binding order, or call identity; each must fail closed at the shared call-
binding owner. Broad searches must find no effect consumer reconstructing an
argument-to-parameter relation by positional array indexing.
An interface-bearing pointer-load fixture must settle only when the exact
pointer plan supplies the storage-owner transport and every certified
result-input origin is closed. Running the identical checked source without
that transport must retain the interface family and its cooperative effects;
this mutation proves that declaration shape and marker spelling cannot grant
permission.
Pointer bind/project fixtures additionally prove both halves of the contract:
their exact callbacks are not opaque escapes, while their results acquire no
fabricated origin. Removing the selected pointer fact must restore opaque
retention; adding a callback as a result origin must fail the negative result-
provenance fixture.
Closed abstract-dispatch fixtures use a nominal generic carrier with one
abstract write and one abstract read. Exact checked heritage, receiver origin,
implementation membership, argument ingress, implementation return flow, and
result-carrier provenance must settle the enclosed callable and its caller.
Mutations replace the implementation return with ambient input, source the
receiver externally, remove one project body, add an unresolved subclass, or
substitute an unrelated same-shaped concrete member; every mutation retains
the complete component. Artifact inspection also requires transport on exactly
the selected abstract calls and none on the same-spelled control. No runtime or
generated declaration name may participate in selection.
Provider-transport fixtures load a sealed provider manifest through the public
target option, bind an ordinary installed-package declaration through the
checker, and inspect facts on exact selected call declarations. Direct callback
ingress and result origins must settle while a same-spelled local declaration
and the same member named in another declaration file remain opaque. Stateful
fixtures store two callable values through one project carrier and read them
back through multiple calls; both origins must be conserved. Mutations change
the manifest digest, section schema, declaration path, or target type; duplicate
an owner; use an unrecognized carrier operation; reassign or escape the carrier;
or substitute an ambient carrier. Each mutation must retain or fail before
rewriting, with no partial output.
A provider-boundary mutation removes the selected declaration file from the
semantic program while preserving the exact checked call and an incomplete
provider record. The generic callable owner must retain the flow without ever
querying that excluded declaration, proving certified provider transport is
the sole cross-boundary route. The paired included declaration-file fixture
must continue settling an exact bodyless non-thenable callable widened into
awaitable local storage; this proves boundary exclusion does not erase the
separate trusted-contract path.
A generic provider callback whose checked concrete input implements a project
interface must settle the callback, interface implementation, and interface
call only when its exact provider invocation record is present before
interface ingress. Removing that record must retain all three at
`opaque-call-transport`. This mutation proves plan assembly cannot defer
fact-owned transport until after interface-family admission.
Indirect-call closure fixtures form a three-level chain in which an exact
outer indirect invocation supplies a callback parameter that is invoked by an
inner indirect call. They repeat the chain through interface-derived inputs,
an object property, an aggregate slot, and a project-returned callable. Every
call-to-implementation multiset and effective argument binding must exact-join
the final invocation-input index. Mutations add one ambient origin, change one
selected implementation, create an originless cycle, or force a non-stable
relation; each must retain the affected component without exposing a partial
indirect implementation list. A gate also proves all downstream flow owners
receive the final index rather than the preliminary pre-interface index.
An invocation-input fixture selects `closed-program`, exports a callback and an
exact forwarding owner, re-exports the callback through a second module,
imports both into the root, and requires complete settlement. The same source
under `closed-direct` retains both exported callables. Replacing the project
call with an ambient consumer also retains the callback under `closed-program`.
This proves linkage references are neutral only under the executable boundary
and do not fabricate a call or erase an actual external ingress.
Structural inspection proves interface implementation-input closure consumes
that same selected profile and rejects restoration of an unconditional module-
forwarding boundary.
The same gate requires source-file-keyed relevance caches and rejects the
single-current-file cache that recomputes identical type closures across
kind-major passes. Whole-product phase evidence reports contracts, calls,
transport scans, implementation inputs, value slots, origins, and components
separately before the interface transaction seals.
The object and aggregate forms additionally route the implementation through a
callable owner whose parameter carries another callback. The closed provenance
path must admit that exact owner reference and settle the nested callback;
adding a second exported or property-observing reference must retain it. An
interface method returning a callable must feed the final indirect round,
while removing the preliminary implementation relation must retain it; an
extracted interface method remains open without exact receiver-binding
evidence. The preliminary and interface-refined closures must execute one
shared candidate census; the later callable-value flow owns its separate
census, while restarting candidate discovery during interface refinement fails
the lifecycle gate. Callable-value collection and finalization
must be distinct frames, and a structural mutation that creates the final
capability inside the transient census frame fails. Round-state mutations
change only a reference path while leaving implementation sets equal and must
still prevent publication until both dimensions stabilize.
An optional callable fixture includes an exact `undefined` reset behind its
nullish guard; the absence closes storage but never appears in the resolved
implementation multiset. Replacing it with any non-nullish non-callable value
must retain the call.

Callable-reference fixtures compare the same settling function through
truthiness, `typeof`, `void`, expression discard, strict identity, nullish
equality, comma, and logical forwarding and require settlement without a
runtime helper. Paired mutations read `.constructor` or another property,
coerce the function, construct through it, export it, or introduce an open
alias; each must retain. Storage ingress and reverse-caller fixtures route one
exact function alias to a closed indirect call and mutate that alias to an
unaccounted use, proving those owners consume the finalized callable-reference
fact instead of a local syntax rule.

Return-provenance fixtures include uninitialized locals and class fields,
plain writes, cyclic aliases with and without a terminal origin, closed
indirect storage ingress, and one generic identity instantiated at multiple
non-thenable call sites. The zero-input bindings must resolve to `undefined`,
an originless cycle must remain open, and adding one Promise-like generic input
or one outward call must retain the complete component. Broad search must find
no declaration-level blanket generic-result rejection and no separate return-
parameter recursion.

Promise-result consumer fixtures distinguish both sides of `&&`, `||`, and
`??`, both sides of comma, an invocation argument from an invocation target,
and a private direct/indirect reverse-call chain from an exported or otherwise
open forwarder. Only the exact non-observing cases settle. A mutation that
supplies implementations from an open callable-value resolution must fail the
consumer or return-flow gate; exact implementation consumers may never ignore
the resolution's closed bit.
An unrelated-call scaling fixture grows ordinary synchronous calls while
holding the cooperative call and consumer graph fixed. Total call inventory
must grow exactly while consumer-owner and edge counts remain unchanged. A
structural mutation gate rejects restoring every call expression as a consumer
graph root or rebuilding the shared closed-storage-owner set.
Direct and indirect discarded invocations retain their async producer so a
rejected Promise cannot become a synchronous throw. Removing either retention
edge must fail its owning fixture.
Exact call-contract fixtures cover direct calls, immutable callable aliases,
closed object-member projections, and declared-closed interface dispatch.
Settlement must remove the selected direct-value union, every connected
implementation return union, and the corresponding `async`/`await` syntax in
one transaction. Mutations omit one implementation, return expression, or
return-contract rewrite; each must retain the whole family. A provider-selected
signature is a non-rewritable boundary and must be planned without querying it
through project semantic evidence. Broad search must find no separate
projection-only contract path.
An inferred-return forwarder fixture routes an immutable callable alias through
an exact project implementation and then through an async caller. Its body
projection, callable contract, both candidates, both return contracts, and both
awaits settle atomically. Passing the alias to an ambient consumer or replacing
the projected result with an ambient or Promise-producing value retains the
affected family.
Generic-callable fixtures pass concrete callbacks through a generic kernel, a
concrete wrapper, and nominal callable storage. The kernel includes callable
parameters returning a type parameter and an exact reset assignment such as
`create = undefined`; both must join the same flow without fabricating a
return-type rewrite. A paired mutation supplies one provider callback to a
second call of the shared kernel and requires every connected use to remain
canonical. Further mutations replace the reset with a compound or unresolved
write and must fail at callable-storage closure.
A Promise-only parameter supplied by an otherwise settling async callback is a
separate atomicity mutation: the callback, enclosing caller, both awaits, and
the Promise-only annotation must all remain canonical. Narrowing only the
implementation or only the calls must fail strict output typechecking.
The carrier cost fixture doubles a deep nominal chain and requires the recorded
class/member/type-edge/propagation work to remain linear; arbitrary checker
property-graph expansion is outside the admitted algorithm.
An indirect-chain fixture requiring multiple closure rounds, the final
callable flow, and return flow record exactly one shared storage-owner topology
construction. Restoring per-round or per-consumer topology construction must
increase that count and fail. A paired storage fixture proves that a complete
topology can serve an exact owner subset without admitting an unselected owner,
contains only positive owner rows, and does not retain unrelated negative
decisions.
An exact returned-pointer fixture distinguishes the pointer binding from its
loaded pointee, passes the pointer through a settling project call, and removes
both cooperative callables. A mutation that drops the pointer-value result
contract must retain the returning callable while the pointee remains
unclassified.
An exact pointer-valued property projection must resolve through the checker's
selected declaration and settle only when that declaration has one canonical
representation/pointee contract and the pointee is nominally non-thenable.
Paired mutations use an ordinary same-shaped property, a callable-`then`
pointee, and one declaration with conflicting pointer pointees; each must
retain the callable. The test must inspect the canonical pointer-value evidence
decision as well as the final async syntax so a missing or bypassed cross-family
contract cannot pass accidentally.
An ambient generic runtime contract returning an inferred canonical pointer
must settle through exact pointer-fact symbol identity when no pointer rewrite
owns the call. Replacing that result with an ordinary structurally identical
generic type must retain the callable. This pair proves the path uses neither
marker spelling nor structural compatibility.
Returned-callable verification covers one exact awaited producer whose direct
returns are a synchronous function and a settling async function. The producer,
both returned callables, their consumer, and every await must settle together.
It also covers a synchronous producer and explicit producer/consumer callable
annotations. AST inspection requires every nested awaitable return node in both
contracts to be consumed exactly once, and strict product typechecking proves
the rewritten producer remains assignable to every rewritten consumer. A
mutation that omits only the producer's nested return rewrite must fail that
proof rather than ship a partially settled flow.
Callable-contract atomicity also has two fail-closed carrier fixtures. One
reads an awaitable callable through an unresolved generic carrier before
assigning it to a local callable contract; the other returns an awaitable
callable through a generic identity result. In both cases runtime origins may
be exact, but the carrier's checked static type remains awaitable, so every
dependent annotation, async modifier, and await must remain unchanged. Paired
positive fixtures use a direct synchronous value and an exact producer
contract that settles in the same plan. Mutations that ignore source-contract
requirements, accept a missing dependency target, or compute a one-pass rather
than cyclic fixed point must either fail AST inspection or strict output
typechecking. The concrete generic-kernel fixture additionally returns
`copy<T>(value): T` from a callable narrowed to `T`. It settles only when the
checker-selected call result exactly matches that direct return and complete
result provenance is non-thenable. Changing either type edge or introducing
one suspending origin must retain the whole callable. A reverse-atomicity
mutation that retains an awaitable call contract while removing its await must
fail the focused AST count and strict output typecheck.
Fixed-slot callable projection fixtures cover a direct tuple literal, an
awaited tuple-producing call, conditional and checked-call forwarding, and two
different callable slots where only the selected slot can settle. A local-alias
fixture proves that the invoked alias consumes its exact projected input,
rewrites every return contract on that path, and leaves zero authored
`Awaitable` references. A mutation that registers the selected signature with
no projected sources must fail the authored-type count even if async and await
counts happen to reach zero. The paired
mutations expose the aggregate, write one element, use a dynamic index, replace
one direct return with a spread slot, or leave one producer contract
unrewritten; each must retain the complete affected callable component. The
bidirectional foils add an unprojected invocation of the same producer and an
exported projected callable beside an otherwise closed invocation; both must
retain the shared origin rather than let one closed use hide an escape. The
same shared projection owner must continue to pass the return-value projection
matrix, proving that callable flow did not introduce a second binding audit.
A provider-call fixture selects a signature from the standard declaration
surface whose return type is absent from the checked project tree. Planning
must retain its async modifier and awaits without asking project semantics to
interpret that foreign type node. A mutation that removes exact-source
membership admission must fail this focused fixture before a whole-product
run can reach the same boundary.
A candidate-domain gate adds hundreds of unrelated scalar bindings without
changing the callable projection denominator. It also proves that a narrowed
callable union and an invoked open target remain candidates, while an exact
direct project invocation does not enter projection flow. Removing either open
admission or restoring direct invocations must fail while admitting the scalar
siblings must fail the bounded candidate count.
A paired method fixture places one exact project property access in direct call
position and an equal-spelled sibling in method-value position. The direct
target must be absent while the method value remains; excluding by spelling or
re-admitting property-call targets must fail the candidate-domain gate.
Root-ownership fixtures separately prove a tuple/array read supplied by the
aggregate projection index, an interface origin supplied by the requirement
ledger, and a callable projection supplied by the callable candidate owner.
Each exact root must settle its positive case, while an unrelated identifier
scaling control must not enter any value-slot graph. Omitting one owner's roots
must fail its semantic fixture; restoring all identifiers must fail the bounded
candidate and guarded product gates.
An exact fixed-slot result forwarded through at least two thousand checked
callables must settle under the ordinary guarded test stack. Replacing the
explicit value-slot worklist with recursive expansion must exhaust that stack
and fail the gate.
A recursive checked producer whose return selects progressively deeper slots
must terminate with its async contract and awaits retained. Removing the active
ancestry check must make that fixture grow without bound, while applying the
same rule across independent roots must fail the positive projection matrix.
The whole-product phase ledger must show value-slot graph condensation
completing independently from positive-evidence materialization. A dense set of
open callable property roots may increase the root denominator but must not
increase the materialized positive-evidence denominator; a mutation that reads
origins before checking `closed` must exceed the guarded planning bound.
The value-slot materializer must consume the persistent origin index and never
the resolver's flattened `originEvidence`. A same-authored-occurrence fixture
places two distinct value-slot origin vertices behind one root and requires
both exact vertices; occurrence-only deduplication must fail.
One provider fixture transports an exact tuple argument as its result and then
invokes the callable selected from one fixed slot. The callable must settle
through the canonical result-projection graph. A structural mutation that
restores a second `createExactValueSlotFlow` call in callable provenance fails,
and the guarded product phase ledger must contain no unowned duplicate graph
between callable-value finalization and callable provenance.
Generic nominal-result fixtures return `RuntimeSlice<T>`,
`RuntimeSlice<T> | undefined`, and a derived generic class whose inherited
private readonly `then?: never` is independent of `T`; all must settle. Paired
callable-`then` type-parameter and public structural `then?: never` mutations
must retain. A bare type parameter settles only when its complete invocation
and return provenance is closed over non-thenable inputs; an exported call
surface under `closed-direct` or one Promise-like input retains. This proves
generic containment is
not a blanket boundary and that no generic member can forge nominal exclusion.
The whole-product memory guard also distinguishes one canonical synchronous
call closure from a dense contract-to-call reverse graph; retrying with a larger
heap is not an accepted repair.
The callable-value capability gate structurally requires a separate lexical
finalizer and excludes its reference-count, class, property, and census maps
from that finalizer's source. The guarded product bound is the non-vacuous proof:
inlining the returned methods into the source-sized construction function must
retain its transient lexical environment and exceed the bound.
The indirect-invocation gate likewise requires the refinable construction
analysis to cross an explicit `finalize` boundary before any downstream flow
receives it. The finalizer accepts only settled invocation-input,
implementation, and admitted-reference collections; importing the source
program, round/domain model, candidate ledger, or refinement function into that
finalizer fails structurally. A mutation that passes the refinable analysis
downstream, or that restores callable query methods inside graph construction,
must fail this gate and the guarded whole-product memory bound.
Return-projection fixtures pair a thenable-capable aggregate slot with a numeric
slot from the same exact source and add an unrelated thenable-capable sibling.
Only the queried thenable-capable slot may enter the value-slot root domain. An
alias fixture reaches that slot through an exact local initializer so the domain
proof is not a syntax-ancestor shortcut. A structural gate requires projection
and return-provenance query
methods to come from dedicated finalizers that contain no source program,
value-slot flow, return construction context, or graph builder. Mutations that
feed every aggregate root or every program call/return into return projection,
retain the slot flow, or publish return queries directly from construction must
fail the candidate, structure, and guarded whole-product memory gates.
Mutations that add a producer-binding write or a derived override retain the
complete flow. The AST proof separately distinguishes a fresh returned
function expression from an existing function-valued reference, so freshness
cannot become a structural-type shortcut.
The whole-product guarded run additionally bounds peak RSS while exercising the
real checker graph. A mutation that restores a mutable owner set or retained
negative membership per queried checker type must exceed that bound or fail a
structural representation assertion; increasing the memory guard is not an
accepted repair.

Provenance-algebra tests exact-partition graph vertices, typed edges, origins,
boundaries, SCCs, and resolved components. They prove duplicate evidence is
deduplicated, a cycle without an origin remains unproved, a boundary reaches
every dependent, and a closed cyclic component receives all and only its exact
origins. Foreign vertices, mutation or a second seal after graph sealing,
missing dependency evidence, empty edge-kind evidence, and a dependency outside
the candidate set each fail at their owning gate.

Blocker-propagation tests independently construct a long dependency chain and a
cycle. They require deterministic nearest roots, exact edge kinds and authored
occurrences in every reported step, exact SCC/edge/vertex denominators, and
bounded construction work. A mutation that changes an edge kind, occurrence,
root reason, candidate identity, or dependency/evidence multiplicity must fail
or produce the exact one-sided discrepancy. Callable-resolution tests separately
prove immutable deduplicated snapshots: mutating input collections after
construction changes neither counts nor iterators, and settlement requires
every exact dependency origin.

## Composition And Transaction Proof

Tests overlap effect, pointer, scalar, and structural rewrites at one parent.
Every family plans from original identities, exchanges immutable result facts,
and the composed parent receives only final child nodes. Mutations keyed to a
cloned node, an intermediate child, or another family's output must fail.

All files are planned before rewriting or printing. A bounded-streaming proof
shows that the first full batch is printed before the complete encoded-source
iterable is materialized. Mutations fail atomically for a source planning
error, encoding error, oversized frame, duplicate member, reordered batch,
missing result, extra result, and failure in a later batch: the backend returns
no artifacts and the output directory remains untouched in every failure.

## Human-Source Gate

Exact representation-projection fixtures include a generic identity function,
a stable static constructor/projector pair, and a transparent wrapper stored
in one non-exported immutable local before repeated projection. They also
include one generic kernel whose callable parameter is invoked directly and
supplied only exact identity functions across multiple files and callers. The
selected profile must emit the argument once and no identity call, wrapper
allocation, projector call, parameter, or argument; the canonical profile must
remain byte-stable. Mutations add a constructor statement, change the selected
field, write or reflect on the class or static method, introduce an
optional/spread call, separate the projector from its constructor, omit one
stored-flow reference from either side of the exact join, export/mutate/alias
or observe the stored wrapper, mutate the callable parameter/owner, or supply
one non-identity function. Each mutation retains the complete candidate at the
representation owner. Evidence exact-joins expression, stored-flow, and
callable candidate totals to optimized plus retained rows and records one
closed reason for every retained candidate. Same-spelled helpers and unrelated
wrapper classes are negative controls.

A callable supplied through a variable declaration is a required projection
foil: it must retain the complete callable flow without reading function-node
fields from that declaration. Stored-flow fixtures likewise place unrelated
node kinds at construction, declaration-list, and property-access boundaries.
These cases fail if an unchecked TS-Go `AsX` projection is restored as a kind
predicate.

The callable matrix includes a generic conditional storage contract whose
concrete caller supplies an exact identity function. The contract remains
because its checked input and result are not identical at the generic
declaration. A mutation changing that contract to `T -> T` admits
specialization, proving the boundary is semantic rather than a blanket
generic-function exclusion. A composition fixture separately proves that an
exact cooperative-effect projection from `Awaitable<T>` to `T` may make the
target contract endomorphic; the representation owner consumes that exact
projection rather than reimplementing awaitable recognition.

Representative generated artifacts and the twenty largest expansions are
inspected. The gate rejects, unless an exact typed necessity row owns it:

- digest/random declaration suffixes or module paths;
- source-facing compiler-mechanics parameters;
- redundant async-forwarding lambdas and method closures;
- avoidable `Promise`, pointer, copy, storage, capability, interface,
  container, reflection, or initialization machinery;
- positional field scaffolding where named construction is legal; and
- duplicated runtime/support definitions.

Collision fixtures prove readable deterministic semantic qualification. A
canonical declaration/module naming failure is attributed to GoToTS; a
target-created private naming failure is attributed to this target. The same
input and profile reproduce byte-identical source and evidence. A fixture
places each preferred target-private binding name in an enclosing authored
scope and proves that the target chooses a distinct deterministic name; this
includes bindings introduced inside synthetic closures.

## Product Performance Gate

The consuming product runs heavy jobs serially under its memory and timeout
guard. Evidence separates semantic checking, index construction, each family
planner, rewriting, encoding, printer transfer, strict typecheck, startup, and
runtime. It reports wall time, peak RSS, source/JavaScript bytes, module count,
allocations when available, and selected/retained denominators.
An explicit diagnostic profile may report one bounded scalar row after each
planning phase, containing only the closed phase identity, elapsed time, heap
use, RSS, and values from the closed scalar-measurement catalog. Graph rows may
report roots, vertices, edges, origins, boundaries, and components; semantic
finalization rows may report candidates, declarations, references, contracts,
closed members, values, and steps. Measurements iterate existing ledgers and
must not materialize compiler objects, duplicate collections, alter semantic
selection, or replace the immutable evidence artifact.
When planning fails before an artifact can be sealed, that same explicit
profile includes the bounded host stack on the fatal internal diagnostic; the
ordinary product diagnostic remains message-only.

Focused semantic fixtures also run one test file per guarded process so a
single failed shape cannot retain every checker graph in the batch. Assertions
over semantic evidence report closed identities, reason names, and bounded
counts; they never ask the test framework to render raw TS-Go nodes or checker
objects, whose cyclic graphs can turn one ordinary mismatch into an
out-of-memory failure.

The guard is enforced by the operating-system process group: it sets finite
memory, zero swap, and wall-time limits around the whole test process. A V8
old-space limit is supporting evidence only because native allocations and
recursive assertion machinery can increase RSS outside that heap budget. Raw
AST nodes, checker objects, and collections containing them are never passed to
structural deep-equality assertions; ordered identities or element-wise object
identity prove the intended join without traversing the compiler graph.

Performance comparisons use pinned tools, immutable fixtures, warmup policy,
and at least three isolated samples. The target reports absolute values and
parent deltas; aggregate improvement cannot hide a worsening major phase or
generated tail.

The current TSTS product goal is approximately three times pinned `tsc` or
better on the agreed compile fixture while preserving pinned TS-Go observable
behavior. That product goal does not license a corpus-specific target rule.

## Release Gate

At clean pushed dependency revisions:

1. run focused and complete target tests;
2. run package dry-run verification;
3. generate the complete consuming product under its guard;
4. strict-typecheck before JavaScript emission;
5. execute valid, syntax-error, and semantic-error fixtures;
6. exact-compare observable output with the pinned oracle;
7. inspect source, manifests, decisions, implementation replacement, and
   retained boundaries; and
8. verify no generated, `.temp`, `.analysis`, or local-log content is tracked.

A timeout, OOM, compile-only result, partial printer result, unexplained
retention row, or stale profile is a failed gate, not a successful checkpoint.
