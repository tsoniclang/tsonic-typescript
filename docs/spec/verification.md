# TypeScript Target Verification

## Focused Family Proof

Each representation family begins with a failing source example and closes
with:

1. exact source-node and semantic-fact consumption;
2. transformed TS-Go-contract AST inspection;
3. pinned-printer output inspection;
4. strict TypeScript checking;
5. executable differential behavior;
6. optimized and retained denominators;
7. bounded construction-operation counts; and
8. broad searches proving no sibling decision path survives.

Pointer mutations must cover an unproved snapshot, missed mutation, exact
in-place object replacement, an omitted mutable field, a same-named generated
member, nullable nil-guard retention, identity observation, marker-spelling
foil, and generated-name collision. Canonical root-allocation proof must also
exact-join every retained allocate fact to one construction, assert one helper
class per allocation-bearing file and none elsewhere, inspect self identity,
and distinguish aliases from independent allocations through equality,
hashing, mutation, nesting, and projection. Scalar and representation mutations must cover an
open consumer, observable nominal identity, missed store, mismatched AST kind,
duplicate plan consumption, and omitted call-site rewrite.

Source-primitive proof must cover every runtime base, renamed named type-only
imports, a same-spelled local alias foil, and exact type/binding consumption.
A namespace import without exact binding-reference evidence, value import, external
primitive re-export, missing planned rewrite, or fabricated primitive fact must
fail before printing. Strict output must contain neither a selected primitive
marker import nor a marker-branded type.
The immutable optimization artifact must report exact primitive-reference and
removable-binding counts. Mutating either count, skipping a rewrite, or letting
one semantic family erase a shared binding before another consumes it must
fail its owning join.

Replacement proof must also combine two disconnected flows of one exact class:
one unstable component remains canonical while one stable addressed component
uses the replacement. Suppressing the stable component because of its sibling,
or optimizing the unstable sibling, must fail at the focused planner gate.

Representation-transport proof must compare the canonical external boundary
with one certified generic kernel. The exact module, export, declaration,
selected signature, and generic-owned parameter become transparent while a
concrete pointer parameter on that same callable remains canonical. Wrong
module, wrong export, local same-spelled callable, duplicate contract entry,
noncanonical order, absent type parameter, and ambiguous ownership mutations
must fail or retain the boundary. The sealed contract digest, callable count,
and nonzero selected-call count are independently joined by product assembly.

## Layout-Backed Memory Proof

Real source-core facts, rather than a locally restated marker union, must drive
raw-memory tests. Cover typed-to-raw-to-typed writes, independent aliases,
exact number and bigint offsets, both byte orders, nil, alignment, bounds,
property locations, projected locations, and equality/hash agreement with
ordinary typed locations. A write through a byte view must change the original
integer (for example, writing 7 at offset 1 of little-endian uint32 value 1
produces 1793).

Delete a selected call's fact and require rejection before printing. Prove
same-spelled ordinary calls are untouched; closed immutable ABI aliases lower
but observable ABI comparisons cannot be erased. Unsupported native addresses,
unproven aggregate storage, conflicting primitive facts, and mismatched scalar dimensions
must fail instead of acquiring an approximate codec. Ordinary number/bigint
and zero-size leaf descriptors have identity-only proofs: independent addresses,
nil and stable equality/hash, plus byte-read/write rejection without source
mutation. A same-spelled scalar alias must not select a scalar byte codec.
Inspect printed output,
strict-typecheck it, and execute it under both canonical and optimized pointer
profiles. A scalar proof never certifies whole-allocation or aggregate views.

Record proofs require exact schema/field facts, complete mutable field coverage,
and strict printed execution. Exercise nested records, aliases acquired before
raw conversion, record and zero-offset-field raw equality, typed-root hashing,
field addresses obtained through independent record views, padding, both byte
orders, conflicting layouts, and generated-name collisions. Delete the schema
fact and require rejection; a plain object type, missing field, readonly field,
index signature or schema used as a runtime value must not gain a byte codec.
These proofs do not certify pointer-bearing fields or descriptor transport.
Prove that a field view can address a sibling through its retained allocation.
A deterministic wide-record control must distinguish narrow access from
serializing every field; output cardinality is not a construction-cost proof.

Reference-word proofs must distinguish replacing a pointer field from mutating
its pointee, retain copied references and nil, and reject wrong-domain decoding
and partial/native-bit observations. Repeated descriptors must share only an
exact domain. Independently authored descriptors in different files require
strict printed execution, including import cycles and name collisions; a
single-file success or checker-local Type equality does not certify that join.
Masking the shared memory-type fact must fail before printing. Equivalent
imported/aliased layouts must reuse a codec; signed, unsigned, nested and closed
generic pointer domains must remain distinct where source-core distinguishes
them. A shared source domain never erases ABI or child-layout differences.
Reject a nullable record that merely contains a pointer, and reject `null`
where the selected executable nil representation requires `undefined`.

Lifetime proofs must include a file whose only selected operation is
`keepAlive`: inspect a value-phase runtime import and strictly execute the
printed file. Another pointer operation must not mask a missing import.

Closed-array proof must include every independently obtained element address,
alias equality and hashes observed before conversion, cross-element byte writes,
retained padding, both byte orders, and a work-count control comparing small and
large allocations. Reject escaped, resized, sparsely written, or reassigned
arrays before printing. Exercise actual printed, strictly checked output; AST
shape counts alone do not prove storage aliasing.

Boolean and floating codecs require actual byte and alias proofs, not only
factory names. Compare float32/float64 finite values, signed zeros, subnormals
and infinities against independent IEEE constants and Go. Test both byte
orders, float32 rounding and ABI32 alignment of a 64-bit field. Invalid boolean
bytes and signaling/quiet NaN payloads must reject rather than coerce or
normalize. Ordinary number aliases and wrong widths must fail admission.

Address facts must retain the unsigned ABI32/number or ABI64/bigint domain,
including values beyond number's exact-integer range. Removing the selected
ABI must fail at evidence consumption, before the physical-address boundary.
Removing a raw conversion's layout or an observation's layout must likewise
fail before printing. Nested descriptor validation belongs to the shared
selector, including every required child layout; a parent fact is not a
substitute for independently finalized child evidence.

## Transaction Proof

The backend must prove:

- every checked source is planned exactly once before printing;
- independently plannable failures are deterministic;
- a failed source, rewrite, encoding, printer batch, file count, or order emits
  zero artifacts;
- successful sources are encoded and printed under one finite batch budget;
- the production budget admits a 96 MiB single official-AST frame, rejects one
  byte above 128 MiB without allocating that payload, and never exceeds the
  256 MiB request ceiling;
- source-to-artifact order and membership exact-join; and
- every planned fact and generated name is consumed exactly once.

## Synchronous Product Proof

The TSTS product selects GoToTS concurrency `disabled`. A direct-call fixture
must contain no generated `async`, `await`, or Promise-bearing callable ABI.
Channel receive/send, goroutines, blocking `select`, and every unsupported
suspension root must fail at an exact typed source identity. A selected
provider must expose one package-atomic, signature-certified synchronous
implementation.

The target's `synchronous` source contract independently rejects every
authored suspension node from the exact checked tree before planning and must
invoke the printer zero times on failure. Its sealed evidence must exact-join
the selected execution contract and source membership. This gate detects a
source-owner regression; it never removes or repairs suspension syntax.

Mutating the product profile to `cooperative` must fail the synchronous output
gate before publication. The target must have no effect directory, effect
profile option, effect manifest, Promise-removal rewrite, or import of an
archived implementation.

## Product Checkpoint

A product checkpoint runs serially through the guarded TSTS owner and records:

1. clean exact submodule pins;
2. GoToTS build and complete generation;
3. target planning and printing;
4. strict typecheck before JavaScript emission;
5. valid, syntax-error, and semantic-error replay;
6. exact exit status, stdout, and stderr against pinned native TS-Go;
7. generated artifact and implementation replacement inspection; and
8. generation, planning, printing, typecheck, runtime, RSS, and size totals.

Failed artifacts are preserved. An OOM is never retried with the same
unbounded command. Whole-product output and profiler payloads remain in
ignored scratch; agent output contains only bounded summaries.
