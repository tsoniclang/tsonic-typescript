import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { LoweredValueContract } from "../../../value-contract.js";
import type { TypeScriptPlanningObserver } from "../../../planning-observer.js";
import type { TypeScriptActiveCooperativeEffectProfile } from "../../../profile.js";
import type { TargetProgramIndex } from "../../../program-index.js";
import type { InvocationTransportContract } from "../../../invocation-transport.js";
import type { ExactAggregateProjectionIndex } from "../aggregate/projection.js";
import type { ExactInvocationInputIndex } from "../invocation/inputs.js";
import type { ExactObjectPropertyProjectionIndex } from "../object/projection.js";
import {
  createReturnProvenanceFlow,
  type ReturnProvenanceResolution,
} from "./provenance.js";
import type { ClosedStorageOwnerAnalysis } from "../storage/analysis.js";
import type { ReturnFlowQueries } from "./queries.js";

export interface ReturnValueFlow {
  resolutionFor(expression: Node): ReturnProvenanceResolution;
  isDefinitelyNonThenable(expression: Node): boolean;
  callResultIsDefinitelyNonThenable(
    call: Node,
    declarations: Iterable<Node>,
    settledDeclarations?: ReadonlySet<Node>,
  ): boolean;
}

export function createReturnValueFlow(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  projections: ExactAggregateProjectionIndex,
  candidates: ReadonlySet<Node>,
  directCallDeclaration: (call: Node) => Node | undefined,
  invocationInputs: ExactInvocationInputIndex,
  objectProjections: ExactObjectPropertyProjectionIndex,
  storageOwners: ClosedStorageOwnerAnalysis,
  queries: ReturnFlowQueries,
  loweredValues?: LoweredValueContract,
  callDeclarations: (call: Node) => Iterable<Node> = () => [],
  transports?: InvocationTransportContract,
  callableReferenceIsClosed?: (reference: Node) => boolean,
  cooperativeEffects: TypeScriptActiveCooperativeEffectProfile = "closed-direct",
  planningObserver?: TypeScriptPlanningObserver,
): ReturnValueFlow {
  const provenance = createReturnProvenanceFlow(
    source,
    program,
    projections,
    candidates,
    directCallDeclaration,
    invocationInputs,
    objectProjections,
    storageOwners,
    queries,
    loweredValues,
    callDeclarations,
    transports,
    callableReferenceIsClosed,
    cooperativeEffects,
    planningObserver,
  );
  return Object.freeze({
    resolutionFor(expression: Node): ReturnProvenanceResolution {
      return provenance.resolutionFor(expression);
    },
    isDefinitelyNonThenable(expression: Node): boolean {
      const resolution = provenance.resolutionFor(expression);
      return resolution.closed && resolution.dependencyCount === 0;
    },
    callResultIsDefinitelyNonThenable(
      call: Node,
      declarations: Iterable<Node>,
      settledDeclarations?: ReadonlySet<Node>,
    ): boolean {
      for (const declaration of declarations) {
        if (
          candidates.has(declaration) &&
          settledDeclarations?.has(declaration) !== true
        ) {
          return false;
        }
      }
      const resolution = provenance.callResolution(call);
      if (!resolution.closed) {
        return false;
      }
      for (const dependency of resolution.dependencyNodes()) {
        if (settledDeclarations?.has(dependency) !== true) {
          return false;
        }
      }
      return true;
    },
  });
}
