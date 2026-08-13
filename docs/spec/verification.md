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
definition/reference edge, or caller mapping; each fails before rewriting.
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

## Composition And Transaction Proof

Tests overlap effect, pointer, scalar, and structural rewrites at one parent.
Every family plans from original identities, exchanges immutable result facts,
and the composed parent receives only final child nodes. Mutations keyed to a
cloned node, an intermediate child, or another family's output must fail.

All files are planned before printing. Mutations fail atomically for a source
planning error, encoding error, oversized frame, duplicate member, reordered
batch, missing result, extra result, and failure in a later batch. The output
directory remains untouched in every failure.

## Human-Source Gate

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
