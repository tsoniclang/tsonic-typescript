# TypeScript Target Architecture

## Boundary

TSTS owns source parsing, checking, exact nodes, marker selection, and
finalized semantic facts. The TypeScript target consumes those identities and
transforms the same TS-Go-contract AST. It does not parse source again, join by
text range, reread files, re-enter a checker, recognize marker spelling, or
patch printed text.

GoToTS owns Go execution semantics. In the selected synchronous product,
`semantics.concurrency` is `disabled`; GoToTS emits synchronous callable
signatures and direct calls. This target does not reconstruct call effects,
infer interface synchrony, or remove `Promise`, `async`, or `await`. A source
construct that requires suspension is rejected by its source or provider
owner before target publication.

The generic target accepts an explicit `execution` contract. `unrestricted`
performs no execution validation. `synchronous` validates the already-built
checked-node index and rejects every authored suspension form before any
representation plan or printer request exists. This is a source-contract gate,
not effect inference or a rewrite.

## Lowering Transaction

The target performs one bounded transaction:

```text
checked source and facts
    -> exact finalized source-attribute selection
    -> one immutable selected program index excluding attribute subtrees
    -> selected source-execution contract validation
    -> complete pointer plan
    -> complete scalar plan
    -> complete representation plan
    -> prepare every source rewrite
    -> one AST traversal per source
         pointer -> scalar -> representation -> nil checks
         -> source-attribute erasure
    -> exact plan-consumption joins
    -> bounded external-AST encoding batches
    -> configured printer
    -> atomic artifact publication
```

No source artifact is printed until every source plan succeeds. A planning,
rewrite, encoding, printer, count, or ordering failure publishes no partial
target result.

The printer transport admits at most 128 MiB for one official external-AST
file and 256 MiB for one complete request. The single-file ceiling is global,
path-independent, and no larger than half the request ceiling; batching remains
the only aggregate-growth mechanism. It is calibrated above the largest
selected full-product frame while preserving a finite fail-closed boundary.
A larger source file is rejected before that frame is sent rather than split
by text, assigned a privileged path, or sent through an unbounded request.

## Selected Program Index

One immutable owner may census selected nodes, syntax kinds, authored visible
names, and binding writes required by enabled representation families. It is
not an intermediate language representation and carries no target-independent
semantics. A family may request only the indexes it consumes. No family builds
a second whole-program node census or source-reference graph.

Source references, selected declarations, types, and operations come from the
canonical Tsonic source API. The target does not retain a duplicate reference
index.

## Finalized Source Attributes

A finalized source attribute is compile-time metadata. Selection uses only the
canonical attribute-builder fact attached to the exact checked call node. The
target does not recognize an attribute function, fact type, schema, generated
helper, or payload by spelling and does not interpret Go-specific payloads.

Every selected application must be a standalone expression statement. Its
complete subtree is excluded from the selected program index, so execution,
pointer, scalar, representation, nil-check, and generated-name analysis cannot
treat metadata as executable source. The composed traversal consumes every
planned statement exactly once after executable lowering. A duplicate,
nested, missing, or unconsumed application fails before printing.

An imported attribute/fact binding or project-local fact declaration is
removed only when canonical source navigation proves every exact reference is
inside selected metadata or the binding/declaration itself. A declaration is
removed only when its exact AST shape is runtime-inert: no heritage, decorator,
computed name, initializer, static block, or executable member is admitted.
When removing the last binding, the import becomes a bare side-effect import
unless the binding is the exact compile-time provider marker or its complete
project module consists only of removable inert declarations. A live reference,
live declaration, and module initialization remain ordinary source. Empty
containers that are actually disposable are pruned by one shared structural
owner. A local same-spelled function or class has no finalized fact and remains
ordinary source.

## Certified Representation Transport

A selected product may provide one immutable, versioned set of certified
generic-kernel callable identities. Selection exact-joins the import module,
export, resolved declaration, and selected signature from the checked tree.
The certificate admits only a parameter whose authored type structurally
refers to a type parameter owned by that same selected kernel declaration.
Concrete parameters on the same callable remain external boundaries.

This contract says only that the generic-owned shape transports the caller's
already-selected representation through its caller-owned operation facets. It
does not grant the kernel authority to choose a representation, expose a
concrete provider carrier, or make an arbitrary external call transparent.
Missing, stale, duplicate, ambiguously imported, same-spelled, or non-generic
evidence retains canonical lowering. No kernel body, path suffix, or spelling
heuristic is inspected by the target.

## Representation Families

### Pointers

Canonical pointer lowering remains the exact fallback for open, escaping,
nullable, identity-observed, unsafe, indirect, or unresolved flows. A complete
closed component may select:

- a scalar snapshot when no write can be observed;
- one mutable cell when scalar alias mutation is required; or
- the represented object when the complete flow is closed. Whole-pointee
  replacement is allowed only when one exact class-shape proof accounts for
  every mutable instance field as a public constructor property. The target
  then adds one collision-free instance replacement method and rewrites every
  admitted store to that method, preserving object identity for all aliases.
  The shape capability is class-owned while admission is component-owned: a
  blocker in one disconnected component retains that component canonically but
  cannot erase the proved capability for another component of the same class.

Every definition, reference, assignment, argument, result, and storage member
in the component changes atomically. A local exception invalidates the
optimization and retains the canonical pointer representation.

A fact-selected allocation that retains the canonical representation is one
root `Location<T>` object. The root is its own `storageIdentity`, its
`storageKey` is `undefined`, and its mutable `value` is the allocated value.
The target emits one collision-safe root-location class in each source file
that owns such allocations and rewrites every exact allocate fact in that file
to a construction of that class. The shared runtime remains the sole owner of
location equality, hashing, binding, property addressing, nesting, and
projection. A retained allocation never calls a second constructor that adds
a redundant identity object, and a source file with no retained allocation
receives no root-location class.

The replacement proof rejects inheritance, heritage consumers, decorators,
accessors, computed or private state, nonempty constructors, omitted mutable
fields, declaration boundaries, and mutable class bindings. Ambient readonly
type sentinels carry no runtime state and are excluded explicitly. Nullable
pointer operands retain their source nil guard; only a checked non-nullable
left operand permits guard contraction.

### Scalars

An imported or nominal scalar wrapper becomes a primitive only when every
construction, use, store, return, and consumer in its complete component has
the same observable behavior. Otherwise the wrapper remains.

### Representation Projections

Identity callables and stored wrappers may be removed only when the complete
owner/call/argument/parameter or storage component is exact. The plan records
every expected rewrite, and finalization exact-joins each record to one
consumed original node.

## Generated Names

One program-scoped name owner selects every target-generated binding. A name
must not collide with any authored identifier visible where it is introduced,
another generated name, an import, parameter, type parameter, local, member,
or declaration. Names are deterministic and semantic; random or hash-only
suffixes are forbidden.

## Evidence

Every enabled family reports exact optimized and retained denominators.
Retained entries carry bounded typed reasons and authored occurrence identity.
Evidence is immutable and emitted only after the complete lowering
transaction seals. It records the selected source-execution contract, exact
source membership, representation-family denominators, and the selected
representation-transport contract digest, denominator, and selected-call
count. Per-file results report exact erased source-attribute, import-binding,
and declaration counts. Evidence contains no cooperative-effect schema.

## Deleted Architecture

The synchronous target contains no effect graph, interface-effect solver,
callable/return/storage effect provenance, provider or source effect manifest,
thenability proof, Promise-boundary rewrite, or runtime return-effect facts.
Those paths are not compatibility options.
