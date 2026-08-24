import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import { connectCooperativeEffectDependency } from "../../closure/dependency.js";
import { blockCooperativeEffect } from "../../closure/retention.js";
import type { CallableValueFlow } from "../../flow/callable/value-flow.js";
import type { DeclaredInterfaceDispatch } from "../../flow/interface/dispatch.js";
import type { ReturnValueFlow } from "../../flow/return/value.js";
import type { CooperativeEffectCandidate } from "../../inventory/candidates.js";
import { exactReturnedCall } from "../../model/syntax.js";
import {
  resolvedCallProducesDefinitelySynchronousValue,
  sameSelectedType,
} from "../../model/synchronous.js";
import type { ExactSourceBodyInspection } from "../../model/source-membership.js";

const noDependencies: readonly Node[] = Object.freeze([]);

export function classifyReturnedExpression(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  calls: ReadonlyMap<Node, CooperativeEffectCandidate>,
  interfaces: DeclaredInterfaceDispatch,
  valueFlow: CallableValueFlow,
  returnFlow: ReturnValueFlow,
  conditionalSettlements: (dependencies: Iterable<Node>) =>
    ReadonlySet<Node> | undefined,
  bodyInspectionIsCertified: ExactSourceBodyInspection | undefined,
  owner: CooperativeEffectCandidate,
  expression: Node,
): void {
  const returnedCall = exactReturnedCall(source, expression);
  const dependency = returnedCall === undefined
    ? undefined
    : calls.get(returnedCall);
  if (returnedCall !== undefined && dependency !== undefined) {
    connectCooperativeEffectDependency(
      owner,
      dependency,
      "return",
      returnedCall,
    );
    return;
  }
  const family = returnedCall === undefined
    ? undefined
    : interfaces.calls.get(returnedCall);
  if (returnedCall !== undefined && family !== undefined) {
    interfaces.addDependencies(owner, family, "return", returnedCall);
    return;
  }
  if (
    returnedCall !== undefined &&
    interfaces.callIsRejected(returnedCall)
  ) {
    blockCooperativeEffect(owner, "unresolved-call", returnedCall);
    return;
  }
  if (
    returnedCall !== undefined &&
    resolvedCallProducesDefinitelySynchronousValue(
      source,
      returnedCall,
      bodyInspectionIsCertified,
    ) &&
    callResultMatchesCandidateReturn(source, returnedCall, owner)
  ) {
    return;
  }
  if (returnedCall !== undefined) {
    const resolution = valueFlow.resolutionFor(returnedCall);
    if (resolution !== undefined && resolution.closed) {
      const contract = valueFlow.contractForCall(returnedCall);
      const directResultIsNonThenable =
        resolution.synchronousDeclarationCount !== 0 &&
        returnFlow.callResultIsDefinitelyNonThenable(
          returnedCall,
          resolution.synchronousDeclarationNodes(),
          conditionalSettlements([
            ...resolution.dependencyNodes(),
            ...(contract?.dependencyNodes() ?? noDependencies),
          ]),
        );
      if (
        (contract === undefined || !contract.closed) &&
        !(directResultIsNonThenable && callResultMatchesCandidateReturn(
          source,
          returnedCall,
          owner,
        ))
      ) {
        blockCooperativeEffect(owner, "unresolved-call", returnedCall);
        return;
      }
      for (const declaration of resolution.dependencyNodes()) {
        const candidate = candidates.get(declaration);
        if (candidate === undefined) {
          blockCooperativeEffect(owner, "unresolved-call", returnedCall);
          return;
        }
        connectCooperativeEffectDependency(
          owner,
          candidate,
          "return",
          returnedCall,
        );
      }
      for (const declaration of contract?.dependencyNodes() ?? noDependencies) {
        const candidate = candidates.get(declaration);
        if (candidate === undefined) {
          blockCooperativeEffect(owner, "unresolved-call", returnedCall);
          return;
        }
        connectCooperativeEffectDependency(
          owner,
          candidate,
          "return",
          returnedCall,
        );
      }
      if (
        resolution.synchronousDeclarationCount === 0 ||
        directResultIsNonThenable
      ) {
        return;
      }
    }
  }
  const returned = returnFlow.resolutionFor(expression);
  if (!returned.closed) {
    blockCooperativeEffect(owner, "promise-producing-return", expression);
    return;
  }
  for (const declaration of returned.dependencyNodes()) {
    const dependency = candidates.get(declaration);
    if (dependency === undefined) {
      blockCooperativeEffect(owner, "promise-producing-return", expression);
      return;
    }
    connectCooperativeEffectDependency(
      owner,
      dependency,
      "return",
      expression,
    );
  }
}

function callResultMatchesCandidateReturn(
  source: TargetSourceProgram,
  call: Node,
  owner: CooperativeEffectCandidate,
): boolean {
  const semantics = source.semantics.forNode(call);
  return sameSelectedType(
    semantics,
    semantics.types.expressionType(call),
    owner.innerType,
  );
}
