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

## Project Structure

- `src/config/` owns target-specific external configuration validation.
- `src/lowering/<semantic-family>/` owns one fact-driven AST transformation.
- `src/print/` owns the stable external-AST printer protocol client.
- `src/backend/` assembles lowered ASTs, printing, and target artifacts.
- `src/descriptor/` owns plugin integration.
- `src/index.ts` exports only the supported public target surface.

Nest by semantic owner as the project grows. Do not create `util`, `helper`,
`common`, `legacy`, `compat`, `fallback`, or version-suffixed paths.

## Verification

Each capability begins with a failing focused test and closes with exact source
examples, exact-node fact consumption, TS-Go-AST shape inspection, pinned
printer output, strict output typechecking, executable differential behavior,
source/output size and runtime cost, and broad deletion searches.

Keep maintained files focused and below 600 physical lines. Use `apply_patch`
for edits, never `git stash`, never force-push, and never delete remote branches
or tags. Work on feature branches and use `.temp/` only for ignored scratch
evidence. Only the coordinator runs heavy suites.
