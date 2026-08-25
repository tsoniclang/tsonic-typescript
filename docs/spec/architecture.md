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
    -> one immutable selected program index
    -> selected source-execution contract validation
    -> complete pointer plan
    -> complete scalar plan
    -> complete representation plan
    -> prepare every source rewrite
    -> one AST traversal per source
         pointer -> scalar -> representation
    -> exact plan-consumption joins
    -> bounded external-AST encoding batches
    -> configured printer
    -> atomic artifact publication
```

No source artifact is printed until every source plan succeeds. A planning,
rewrite, encoding, printer, count, or ordering failure publishes no partial
target result.

## Selected Program Index

One immutable owner may census selected nodes, syntax kinds, authored visible
names, and binding writes required by enabled representation families. It is
not an intermediate language representation and carries no target-independent
semantics. A family may request only the indexes it consumes. No family builds
a second whole-program node census or source-reference graph.

Source references, selected declarations, types, and operations come from the
canonical Tsonic source API. The target does not retain a duplicate reference
index.

## Representation Families

### Pointers

Canonical pointer lowering remains the exact fallback for open, escaping,
nullable, identity-observed, unsafe, indirect, or unresolved flows. A complete
closed component may select:

- a scalar snapshot when no write can be observed;
- one mutable cell when scalar alias mutation is required; or
- the represented object when replacement, nilness, and pointer identity are
  unobservable.

Every definition, reference, assignment, argument, result, and storage member
in the component changes atomically. A local exception invalidates the
optimization and retains the canonical pointer representation.

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
source membership, and representation-family denominators. It contains no
cooperative-effect schema.

## Deleted Architecture

The synchronous target contains no effect graph, interface-effect solver,
callable/return/storage effect provenance, provider or source effect manifest,
thenability proof, Promise-boundary rewrite, or runtime return-effect facts.
Those paths are not compatibility options.
