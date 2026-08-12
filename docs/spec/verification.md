# Verification

## Proof Principle

An optimization is accepted only when its complete semantic class, decision
denominator, transformed AST, behavior, cost, and retained boundary are proven
at one clean revision. A faster sample is not architectural proof.

## Family Gate

Every representation family must provide:

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
input and profile reproduce byte-identical source and evidence.

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
