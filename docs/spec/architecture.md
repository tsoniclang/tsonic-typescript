# TypeScript Target Architecture

## Boundary

### Layout-Backed Pointers

Raw-memory and layout semantics come from the public finalized source-core
facts, not from marker names or Go source. The target exact-joins each fact to
its call, type, selected field, and registered source ABI before printing.
The retired object-only raw binding is rejected, never adapted.

Raw/typed location selection uses the shared finalized selector, including
the complete selected child-layout graph. Layout observations likewise use
the shared validated observation query; a descriptor embedded in another fact
does not substitute for its own finalized child/ABI evidence. Address/integer
facts carry an exact unsigned 32/number or 64/bigint domain matching their
selected ABI. This target validates that evidence before rejecting physical
address execution; it never coerces a 64-bit address through number.

`toRawPointer(addressOf(count), layout)` retains writable storage. A matching
`reinterpretRawPointer(raw, layout)` produces a view whose writes update that
same storage. Byte offsets preserve exact integer values, byte order, bounds,
and alignment. The one TypeScript runtime owns these locations and their
equality/hash identity; the emitter does not create another pointer runtime.

Managed memory is not physical native address emulation. Physical
pointer/integer conversions and layouts lacking an exact executable
representation fail before publication. Scalar codec support does not imply
support for aggregate padding, floating NaN payloads, or arbitrary object
projection. Pointer flow optimization must retain any component whose raw
storage observation has not been proved equivalent. All selected layout,
ABI-token, and memory-operation uses have an explicit lowering or diagnostic;
dropping an import is never sufficient semantic consumption.

An executable record additionally requires finalized `struct`/`field` evidence
and complete mutable data-property coverage. Each selected field declaration
must join its exact schema, property type and child layout. A plain reference
record with matching offsets is not sufficient. The target consumes a
standalone immutable, type-only schema as a private type literal, rewrites its
local type queries and retains the authored public type alias. Runtime uses of
the schema are rejected rather than silently erased. Same-spelled ordinary
functions are unaffected.

Record layouts generate statically typed field lenses and a live accessor view;
the runtime never discovers fields by reflection. Raw writes mutate existing
record fields in place, including nested records, so pre-existing field
locations remain live. Selected byte order, padding, field identity and typed
root identity survive independently obtained aliases. Record codecs are
demand-driven and recursive over admitted child codecs. Field addresses
obtained through a raw record view retain its containing allocation. Narrow
byte accesses select only intersected fields, with logarithmic index lookup
rather than a whole-record refresh. Integer-record support
does not certify pointer leaves, descriptors, reference-record codecs or a
containing allocation inferred from a standalone property location.

Managed-reference words require exact pointer facts and a closed typed codec
domain. The selected outer type must itself be a pointer; a record containing
a pointer is not a pointer word. Opaque relocation tokens may preserve pointer values and complete-word
copies; they must not masquerade as native address integers or pointer bits.
Source-core owns cross-file memory-domain identity. Raw conversions consume
`selectTsonicRawLocationOperation(...).memoryType`; independently authored
layouts share a codec only when `readTsonicMemoryType(...).identity`, exact ABI
provider identity, fingerprint, byte order, address width, size, alignment,
stride and child layouts agree. Checker-local Type objects and target-derived
primitive strings are not codec-domain keys. Never repeat source-core's
pointee/layout agreement by comparing foreign checker types. The target still
owns representation admission, static imports, cyclic initialization safety
and exact alias preservation; missing shared evidence fails before printing.

Scalar width selects the codec, not the alignment or stride. Those dimensions
come independently from the finalized source layout. For example,
`memoryLayout<uint64>(abi32, 8, 4, 8)` lowers to an eight-byte codec with
four-byte alignment, not a target-host eight-byte alignment. Runtime factory
calls receive byte order, alignment, and stride explicitly; no default or
host-ABI inference is allowed. The declared pointee extent is not evidence of
a containing array or struct allocation.

A closed, dense, non-reassigned local array can supply its complete allocation
when the shared pointer-origin and array-storage queries prove that extent.
The target plans all addressed elements together: `addressOf(values[0])` and
`addressOf(values[1])` then share one typed allocation, so advancing the first
raw address by one stride reaches the second. The runtime reads and writes
only the touched byte window and preserves pre-existing typed-pointer identity.
Escapes, resizing, unproved element writes, reassignable bindings, conflicting
layouts, and non-scalar element codecs reject before printing. This does not
infer a backing array through an arbitrary source wrapper or certify Go slice
descriptors. Ordinary pointers outside this proved class keep their existing
location representation.

An exact shared `keepAlive(value)` fact lowers to the runtime's lexical
managed-reachability barrier, with the operand evaluated once at the same
position. The call, operand, argument type, and result exact-join finalized
selection evidence. A discarded read (`void value`) is not a lifetime proof.
The selected Node representation uses ECMAScript's current-job kept-object
rule; it is neither native pinning nor permission for foreign asynchronous
use after that job. No generic marker erasure may drop this obligation.

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
    -> complete source-primitive plan
    -> complete pointer plan
    -> complete scalar plan
    -> complete representation plan
    -> prepare every source rewrite
    -> one AST traversal per source
         source primitive -> pointer -> scalar -> representation
         -> nil-check contraction -> module-binding finalization
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

Target-neutral source primitives are required lowering, not an optimization.
Every exact finalized `sourcePrimitive` fact becomes its declared TypeScript
runtime base (`boolean`, `number`, `bigint`, `string`, or `object`), and its
explicit type-only import binding is erased. Selection comes only from the
TSTS fact attached to the checked node; local aliases with the same spelling
are ordinary TypeScript. Every planned type and binding exact-joins one
consumed original node. A value import, unsupported fact location, or external
primitive re-export fails before printing rather than retaining a marker-module
dependency or guessing from text.

Named type imports are the admitted binding form. The finalized navigation
contract does not currently expose exact namespace-receiver-to-import edges,
so a namespace-selected primitive fails before printing. The target does not
reconstruct that missing edge from local spelling or source text.

Semantic families consume their own exact marker bindings, while the shared
module-binding finalizer owns physical removal and empty-container pruning.
This permits one namespace binding to serve multiple selected families without
one family hiding the original node from another family's consumption join.
The sealed optimization evidence reports the exact primitive type-reference
and removable-binding denominators independently of optional optimizations.

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

The one lowering source set includes all checked project implementations and
authored declaration files carrying selected neutral marker or primitive
facts. Virtual provider models and unmarked library declarations are not
target-owned outputs. Declaration trees use the same exact-fact planners,
generated-name owner, TS-Go AST rewrites, printer and consumption joins as
implementation trees. An omitted selected declaration fails membership before
printing. Consumers must install lowered declarations with their provider
package atomically; reinstalling the canonical surface afterward is invalid.

Every enabled family reports exact optimized and retained denominators.
Retained entries carry bounded typed reasons and authored occurrence identity.
Evidence is immutable and emitted only after the complete lowering
transaction seals. It records the selected source-execution contract, exact
source membership, representation-family denominators, and the selected
representation-transport contract digest, denominator, and selected-call
count. It contains no cooperative-effect schema.

## Deleted Architecture

The synchronous target contains no effect graph, interface-effect solver,
callable/return/storage effect provenance, provider or source effect manifest,
thenability proof, Promise-boundary rewrite, or runtime return-effect facts.
Those paths are not compatibility options.
