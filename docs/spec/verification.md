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

Declaration-reference tests independently exact-join every materialized
project declaration against canonical navigation. Mutations omit or re-parent
one reference and must retain the complete affected flow. Broad searches prove
that no family invokes a second whole-program reverse-reference index.

A scaling fixture doubles nodes and edges while keeping shape constant. Actual
index/planner operation counts must grow proportionally; a quadratic control
must be distinguishable. Wall time is supporting evidence only.
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
dependency graph: model and closure foundations, inventory, flow, planning,
then rewrite. It also rejects production consumers outside the family that
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
The whole-product memory guard also distinguishes one canonical synchronous
call closure from a dense contract-to-call reverse graph; retrying with a larger
heap is not an accepted repair.
Mutations that add a producer-binding write or a derived override retain the
complete flow. The AST proof separately distinguishes a fresh returned
function expression from an existing function-valued reference, so freshness
cannot become a structural-type shortcut.
The whole-product guarded run additionally bounds peak RSS while exercising the
real checker graph. A mutation that restores a mutable owner set or retained
negative membership per queried checker type must exceed that bound or fail a
structural representation assertion; increasing the memory guard is not an
accepted repair.

Callable-resolution sealing proves ownership transfer directly: finalized
resolution interfaces expose neither backing collection, the former mutable
owner rejects all later mutation and a second seal, and its finalized iterators
remain exact. A mutation that restores per-resolution result objects, set
facades, array copies, or object-freezing passes must also fail the guarded
whole-product memory gate at the committed Node heap limit.

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

Focused semantic fixtures also run one test file per guarded process so a
single failed shape cannot retain every checker graph in the batch. Assertions
over semantic evidence report closed identities, reason names, and bounded
counts; they never ask the test framework to render raw TS-Go nodes or checker
objects, whose cyclic graphs can turn one ordinary mismatch into an
out-of-memory failure.

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
