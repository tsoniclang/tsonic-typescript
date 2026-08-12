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
  (effects, pointers, scalars, values, containers, interfaces, control)
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

The target may select plain `T`, one `{ value: T }` cell, or the represented
class object only by rewriting that complete component atomically. Escaping,
nullable, identity-observed, unsafe, indirect, lifetime-sensitive, provider,
or unresolved components retain canonical `Pointer<T>`. Hash, provider bind,
and pointee projection occurrences join the component and retain canonical
representation unless their complete observations are independently proved
exact. A changed source
signature or marker/fact contract is rejected upstream; this target has no
adapter, allowlist, spelling rule, or alternate signature store.

The decision order is:

1. identify the complete connected semantic flow;
2. prove which behavior is observable at its boundary;
3. select the smallest ordinary TypeScript representation preserving it;
4. rewrite every affected producer and consumer atomically; and
5. record selected and retained totals with exact reasons.

No package/function allowlist, name heuristic, local override, unchecked cast,
or generated-text inspection may select a representation.

## Required Families

The profile grows by closed semantic family, not by corpus exception:

- **cooperative effects:** remove `async`, `Promise<T>`, and `await` from every
  complete component that cannot suspend; retain transport for a real open,
  escaping, thenable, provider, or suspending boundary;
- **typed pointers:** use a scalar snapshot for a closed read-only flow, one
  shared `{ value: T }` cell for a closed mutable scalar alias flow, and the
  represented class object for a proved bijective object flow; retain canonical
  location semantics for open or observable identity/alias/nil/lifetime cases;
- **scalar projections:** erase representation-only scalar wrappers when all
  uses preserve the same selected value behavior;
- **values and construction:** request copying, zeroing, storage, equality, and
  hashing only where selected occurrences observe them; prefer named ordinary
  construction over positional compiler scaffolding;
- **generics and operations:** retain an open direct generic body when ordinary
  TypeScript expresses it; otherwise generate only reached exact
  concretizations with direct operations and readable source-derived names;
- **interfaces and dynamic values:** devirtualize exact finite target sets and
  retain carriers only where assertion, switch, reflection, equality, provider,
  or open-consumer behavior observes them;
- **slices, maps, and strings:** select native containers/operations only when
  nil, alias, capacity, reslicing, overlap, equality, copy, iteration, and byte
  behavior at the complete boundary permit them;
- **control and initialization:** remove unnecessary temporaries, checks,
  deferred stacks, recovery state, metadata, and initialization only after the
  corresponding order, panic, recover, reflection, and side-effect proofs.

Each family has one decision owner and one transformation owner. Cross-family
coordination exchanges immutable result facts before rewriting; one family may
not inspect another family's partially rewritten tree.

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
nodes to the parent rewrite, and consumes every planned fact exactly once.

Every source is planned, rewritten, encoded, and budget-validated before the
printer is invoked. Printing uses immutable ordered batches under one finite
payload budget. Zero/multiple output matches, oversized frames, reordered
members, missing output, or any later-batch failure aborts the whole target;
partial output is never published.

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
