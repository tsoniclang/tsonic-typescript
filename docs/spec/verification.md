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

A scaling fixture doubles nodes and edges while keeping shape constant. Actual
index/planner operation counts must grow proportionally; a quadratic control
must be distinguishable. Wall time is supporting evidence only.

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
declared-closed profile covers multiple implementations, inherited
interfaces, distinct same-shaped interfaces, generic heritage, cross-file
edges, synchronous plus settling implementations, and calls sharing one line.
It also transports one exact declaration-file synchronous interface into a
project Awaitable interface and contrasts declaration-file Awaitable/Promise,
generic-unresolved, and implementation-file ambient counterparts; only the
fully synchronous external contract may settle.
Nested-transport fixtures contrast two exact project carriers preserving the
same contract identity with a carrier changing contract identity and an
ambient consumer. Only the exact project-body transport may settle; mutating
either side to the unmatched or ambient form must retain the family.
One-way erasure fixtures pass a fresh array literal to an opaque callable, then
contrast that case with a shared typed array and with a fresh literal assigned
to erased storage and later recovered directly or through an opaque identity.
The outbound-only literal may settle; every recovered path must retain. Ingress
fixtures independently cover an opaque result, a user refinement, ambient
property and element access, an inferred ambient alias, and a project function
returning ambient storage. A paired exact project object/property path must
still settle. Mutations that replace the project root with any ambient source,
remove the re-entry check, or classify the selected property without its owner
must fail at the interface-origin gate. These proofs establish that freshness
is never a general storage or alias exemption.
The generated-storage fixture initializes an optional interface to undefined,
then assigns one exact project implementation and reads it through a certified
pointer load guarded by `pointer ?? neverReturningFailure()`. The family must
settle. Mutations add one ambient interface write or replace the never-returning
fallback with an open pointer; each must retain the family with its exact cause.
It exact-joins each selected member to every project implementation and consumes
each interface return annotation once. Mutations omit the profile, remove or
change one exact heritage edge, substitute a structurally matching class or
same-named member, substitute a foreign checker node with the same source
identity, leave one implementation genuinely suspending, or omit the interface
return rewrite; each retains the family or fails its exact join before querying
foreign semantics.
Evidence reports contract, implementation-edge, settled-family, retained-family,
settled-callable, and settled-await counts separately. The family denominator
must exact-partition into settled and retained rows, including rejected
families. Every retained row carries all contract occurrence identities, its
call count, and one closed typed owner reason; a mutation that drops rejected
families from the retained denominator or erases one reason fails the evidence
gate. Every interface-boundary cause is independently source-located; replacing
the cause ledger with a boolean set or dropping one cause fails the same gate.
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
An interface-bearing pointer-load fixture must settle only when the exact
pointer plan supplies the storage-owner transport and every certified
result-input origin is closed. Running the identical checked source without
that transport must retain the interface family and its cooperative effects;
this mutation proves that declaration shape and marker spelling cannot grant
permission.
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

Exact representation-projection fixtures include a generic identity function
and a stable static constructor/projector pair. It also includes one generic
kernel whose callable parameter is invoked directly and supplied only exact
identity functions across multiple files and callers. The selected profile
must emit the argument once and no identity call/allocation/parameter/argument;
the canonical profile must remain byte-stable. Mutations add a constructor
statement, change the selected field, write the class or static method,
introduce an optional/spread call, separate the projector from its constructor,
alias or mutate the callable parameter/owner, or supply one non-identity
function. Each mutation retains the complete candidate at the representation
owner. Evidence exact-joins expression and callable candidate totals to
optimized plus retained rows and records one closed reason for every retained
candidate. Same-spelled helpers and unrelated wrapper classes are negative
controls.

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
