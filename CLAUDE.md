# Agent Notes (Tsonic TypeScript Target)

`AGENTS.md` and `CLAUDE.md` must remain byte-identical. Apply every change to
both and verify with `cmp`.

## Begin With WCBUBWHB

Every task begins by identifying the observed artifact, complete semantic
class, sole truth owner, highest correct fix, superseded path to delete,
simplest exact output, staticness/size/runtime consequences, source-to-output
example, independent proof, and broad deletion search.

Do not patch a reproduction and justify it afterward. A repeated workaround
reopens its shared owner.

## Governing Architecture

`docs/spec/` is authoritative for target architecture, performance selection,
human-shaped output, and verification.

TSTS owns source checking, the exact TS-Go-contract AST, canonical marker
selection, and finalized semantic facts. This target consumes those exact node
identities and transforms the same tree into another TS-Go-contract AST.

There is no second parser, second AST, source-range join, source-text patch,
filesystem reread, checker re-entry, marker-spelling recognition, or target
semantic side store. A local same-spelled declaration remains ordinary source
unless TSTS selected it.

The target owns fact-driven lowering and target runtime selection. Output is
encoded through the generated TS-Go external-AST protocol and sent to one
configured printer service. The bootstrap printer uses pinned TS-Go; a future
TSTS printer may replace it without changing target lowering or the protocol.

The TypeScript compiler may strict-typecheck and execute the printed result. It
does not parse or transform source for this target.

External project configuration may enter one dedicated validator as
`unknown`; it must become a closed typed value before compilation. Semantic
facts and compiler values may never be recovered through `any`, `unknown`,
unchecked casts, reflection, source spelling, or dynamic shape dispatch.

Target optimization is complete-flow and fact-driven. It may change
representation only when every affected definition and reference is rewritten
and observable source behavior remains exact. An optimization that needs a
local exception instead reopens its representation owner.

The selected TSTS product expresses synchronous execution in GoToTS before
this target runs. This target owns pointer, scalar, and representation
projection only. It must not add an effect graph, infer callable synchrony,
consume effect manifests, or remove `Promise`, `async`, or `await` after
generation. Reached suspension semantics fail at their source or provider
owner.

Every target-created lexical binding is reserved by the canonical source-file
name owner against all authored and previously generated bindings visible at
its insertion point. This includes parameters inside synthetic closures; a
counter or supposedly private prefix is not collision proof.

## Coordinated Repository Scope

This workstream may modify only GoToTS and the TypeScript target. Any change to
TSTS, Tsonic core, another Tsonic target, or any other repository requires the
user's explicit approval before editing. Read-only inspection may establish a
published contract; it does not grant change ownership.

## Project Structure

- `src/config/` owns target-specific external configuration validation.
- `src/lowering/<semantic-family>/` owns one fact-driven AST transformation.
- `src/print/` owns the stable external-AST printer protocol client.
- `src/backend/` assembles lowered ASTs, printing, and target artifacts.
- `src/descriptor/` owns plugin integration.
- `src/index.ts` exports only the supported public target surface.

Nest by semantic owner as the project grows. Do not create `util`, `helper`,
`common`, `legacy`, `compat`, catch-all fallback, or version-suffixed paths.
Typed canonical-retention evidence belongs to the semantic family that made
the decision; it is not a second lowering route.

## Verification

Each capability begins with a failing focused test and closes with exact source
examples, exact-node fact consumption, TS-Go-AST shape inspection, pinned
printer output, strict output typechecking, executable differential behavior,
source/output size and runtime cost, and broad deletion searches.

Keep maintained files focused and below 600 physical lines. Use `apply_patch`
for edits, never `git stash`, never force-push, and never delete remote branches
or tags. Work on feature branches and use `.temp/` only for ignored scratch
evidence. Only the coordinator runs heavy suites.

Run checker-backed test files as separate bounded Node processes, serially.
Combining many compiler fixtures into one process retains checker graphs across
files and is not an accepted memory-test strategy.
"Bounded" means a kernel-enforced process-group memory and swap limit plus a
timeout; a V8 old-space option alone is not an RSS limit. Never structurally
deep-compare raw AST nodes, checker objects, or collections containing them;
compare canonical identities, scalar facts, and bounded counts instead.

Parallel agents are forbidden unless the user explicitly authorizes them for
the specific task. When authorized, every worker uses a separate worktree; the
coordinator reviews and integrates every change and alone runs combined and
heavy verification.
