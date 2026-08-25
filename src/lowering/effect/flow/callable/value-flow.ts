import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { CallableReturnRewrite } from "../../model/callable-contract.js";
import {
  createGraphCallableInterfaceEvidence,
  createGraphCallableValueFlow,
  type GraphCallableValueAnalysisRequest,
} from "./provenance-flow.js";
import type { CallableValueResolution } from "./value-resolution.js";
import type { ExactCallableBodyInspection } from "./result-inputs.js";
import type { CallableInterfaceEvidence } from "./provenance/interface-evidence.js";
import type { TypeScriptPlanningObserver } from "../../../planning-observer.js";
import {
  collectCallableProjectionCandidates,
} from "./projection-candidates.js";

export interface CallableValueCensus {
  readonly projectionCandidates: readonly Node[];
}

export type CallableValueFlowRequest = Omit<
  GraphCallableValueAnalysisRequest,
  "projectionCandidates"
> & {
  readonly census: CallableValueCensus;
};

export type { CallableValueResolution } from "./value-resolution.js";

export interface CallableValueFlow {
  readonly signatureFamilies: readonly (readonly Node[])[];
  forEachCall(
    visitor: (call: Node, resolution: CallableValueResolution) => void,
  ): void;
  resolutionFor(call: Node | undefined): CallableValueResolution | undefined;
  resolutionForExpression(
    expression: Node | undefined,
  ): CallableValueResolution | undefined;
  resolutionForDeclaration(
    declaration: Node | undefined,
  ): CallableValueResolution | undefined;
  callReturnsCallableValue(call: Node): boolean;
  contractForCall(call: Node): CallableValueResolution | undefined;
  allowsCallableReference(node: Node): boolean;
  settledReturnTypes(
    optimized: ReadonlySet<Node>,
  ): readonly CallableReturnRewrite[];
}

export function collectCallableValueCensus(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  planningObserver?: TypeScriptPlanningObserver,
  bodyInspectionIsCertified?: ExactCallableBodyInspection,
): CallableValueCensus {
  return Object.freeze({
    projectionCandidates: collectCallableProjectionCandidates(
      source,
      program,
      planningObserver,
      bodyInspectionIsCertified,
    ),
  });
}

export function createCallableValueFlow(
  request: CallableValueFlowRequest,
): CallableValueFlow {
  return createGraphCallableValueFlow(graphRequest(request));
}

export function createCallableInterfaceEvidence(
  request: CallableValueFlowRequest,
): CallableInterfaceEvidence {
  return createGraphCallableInterfaceEvidence(graphRequest(request));
}

function graphRequest(
  request: CallableValueFlowRequest,
): GraphCallableValueAnalysisRequest {
  const { census, ...analysis } = request;
  return Object.freeze({
    ...analysis,
    projectionCandidates: census.projectionCandidates,
  });
}
