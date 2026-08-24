import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { InvocationTransportContract } from "../../../invocation-transport.js";
import type { TypeScriptPlanningObserver } from "../../../planning-observer.js";
import type { ExactAggregateProjectionIndex } from "../aggregate/projection.js";
import { createExactValueSlotFlow } from "../value/slot/flow.js";
import { exactCallableReturnExpressions } from "../invocation/results.js";
import { callableDispatchIsClosed } from "../../model/syntax.js";
import type { ExactInvocationInputIndex } from "../invocation/inputs.js";
import type { ExactObjectPropertyProjectionIndex } from "../object/projection.js";
import type { ExactValueSlotCallSource } from "../value/slot/model.js";
import type { ReturnLocalFlow } from "./local.js";
import { collectReturnProjectionCandidates } from "./projection/candidates.js";
import {
  finalizeReturnProjectionFlow,
  type ReturnProjectionFlow,
} from "./projection/finalization.js";
import type { ReturnStorageFlow } from "./storage.js";
import type { ClosedStorageOwnerAnalysis } from "../storage/analysis.js";
import type { ExactCallableBodyInspection } from "../callable/result-inputs.js";
import { sourceBodyInspectionIsExact } from "../../model/source-membership.js";
import type { TypeScriptActiveCooperativeEffectProfile } from "../../../profile.js";

export type { ReturnProjectionFlow } from "./projection/finalization.js";

export function createReturnProjectionFlow(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  projections: ExactAggregateProjectionIndex,
  callDeclarations: (call: Node) => Iterable<Node>,
  invocationInputs: ExactInvocationInputIndex,
  queryRoots: readonly Node[],
  locals: ReturnLocalFlow,
  storage: ReturnStorageFlow,
  storageOwners: ClosedStorageOwnerAnalysis,
  objectProjections: ExactObjectPropertyProjectionIndex,
  transports?: InvocationTransportContract,
  planningObserver?: TypeScriptPlanningObserver,
  bodyInspectionIsCertified?: ExactCallableBodyInspection,
  cooperativeEffects: TypeScriptActiveCooperativeEffectProfile = "closed-direct",
): ReturnProjectionFlow {
  const returns = new Map<Node, readonly (Node | undefined)[] | null>();
  const sourceForCall = (
    call: Node,
  ): ExactValueSlotCallSource | undefined => {
    const transport = transports?.transportFor(call);
    if (transport?.resultOriginExpressions !== undefined) {
      return Object.freeze({
        resultOwner: call,
        contracts: Object.freeze([]),
        expressions: Object.freeze([...transport.resultOriginExpressions]),
      });
    }
    const declarations = [...new Set(callDeclarations(call))];
    if (declarations.length === 0) {
      return undefined;
    }
    const expressions: (Node | undefined)[] = [];
    for (const declaration of declarations) {
      if (
        !sourceBodyInspectionIsExact(
          source,
          declaration,
          bodyInspectionIsCertified,
        ) ||
        !callableDispatchIsClosed(source, program, declaration)
      ) {
        return undefined;
      }
      let selected = returns.get(declaration);
      if (selected === undefined) {
        selected = exactCallableReturnExpressions(source, declaration) ?? null;
        returns.set(declaration, selected);
      }
      if (selected === null) {
        return undefined;
      }
      expressions.push(...selected);
    }
    const declaration = declarations[0];
    return declaration === undefined
      ? undefined
      : Object.freeze({
          resultOwner: declarations.length === 1 ? declaration : call,
          contracts: Object.freeze(declarations),
          expressions: Object.freeze(expressions),
        });
  };
  const candidates = collectReturnProjectionCandidates({
    source,
    projections,
    queryRoots,
    locals,
    storage,
    objectProjections,
    invocationInputs,
    sourceForCall,
    ...(bodyInspectionIsCertified === undefined
      ? {}
      : { bodyInspectionIsCertified }),
  });
  planningObserver?.("effect-return-projections", {
    candidates: candidates.length,
    roots: projections.roots.length,
  });
  const slots = createExactValueSlotFlow(
    source,
    program,
    projections,
    sourceForCall,
    invocationInputs,
    candidates,
    planningObserver,
    storageOwners,
    undefined,
    undefined,
    undefined,
    cooperativeEffects,
  );
  const closedInputs = new Map<Node, readonly Node[]>();
  for (const expression of candidates) {
    const result = slots.resultFor(expression);
    if (result?.closed === true) {
      closedInputs.set(expression, result.expressions);
    }
  }
  return finalizeReturnProjectionFlow(closedInputs);
}
