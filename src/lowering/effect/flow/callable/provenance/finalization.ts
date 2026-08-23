import type { Node } from "@tsonic/tsts";

import type { CallableReturnRewrite } from "../../../model/callable-contract.js";
import {
  allCallableDependenciesAreOptimized,
  type CallableValueResolution,
} from "../value-resolution.js";
import type {
  CallableContractSourceRequirement,
} from "./contract-settlement.js";

export interface SettledCallableReturnContract {
  readonly rewrite: CallableReturnRewrite;
  readonly resolutions: readonly CallableValueResolution[];
  readonly sourceRequirements: readonly CallableContractSourceRequirement[];
}

export interface GraphCallableValueFlow {
  readonly signatureFamilies: readonly (readonly Node[])[];
  forEachCall(
    visitor: (call: Node, resolution: CallableValueResolution) => void,
  ): void;
  resolutionFor(call: Node | undefined): CallableValueResolution | undefined;
  allowsCallableReference(node: Node): boolean;
  settledReturnTypes(
    optimized: ReadonlySet<Node>,
  ): readonly CallableReturnRewrite[];
}

export function finalizeGraphCallableValueFlow(
  signatureFamilies: readonly (readonly Node[])[],
  callResolutions: ReadonlyMap<Node, CallableValueResolution>,
  closedCallableReferences: ReadonlySet<Node>,
  settledReturnContracts: readonly SettledCallableReturnContract[],
  inheritedCallableReferenceIsClosed:
    ((reference: Node) => boolean) | undefined,
): GraphCallableValueFlow {
  return Object.freeze({
    signatureFamilies,
    forEachCall(
      visitor: (call: Node, resolution: CallableValueResolution) => void,
    ): void {
      for (const [call, resolution] of callResolutions) {
        visitor(call, resolution);
      }
    },
    resolutionFor(call: Node | undefined): CallableValueResolution | undefined {
      return call === undefined ? undefined : callResolutions.get(call);
    },
    allowsCallableReference(node: Node): boolean {
      return inheritedCallableReferenceIsClosed?.(node) === true ||
        closedCallableReferences.has(node);
    },
    settledReturnTypes(
      optimized: ReadonlySet<Node>,
    ): readonly CallableReturnRewrite[] {
      return settleReturnContracts(settledReturnContracts, optimized);
    },
  });
}

function settleReturnContracts(
  contracts: readonly SettledCallableReturnContract[],
  optimized: ReadonlySet<Node>,
): readonly CallableReturnRewrite[] {
  const settled = new Set<Node>(contracts.flatMap((contract) =>
    contract.resolutions.every((resolution) =>
        resolution.closed &&
        allCallableDependenciesAreOptimized(resolution, optimized)
      ) &&
      contract.sourceRequirements.every((requirement) =>
        requirement.resolvable &&
        requirement.candidateDependencies.every((candidate) =>
          optimized.has(candidate)
        )
      )
      ? [contract.rewrite.target]
      : []
  ));
  let changed = true;
  while (changed) {
    changed = false;
    for (const contract of contracts) {
      if (
        settled.has(contract.rewrite.target) &&
        contract.sourceRequirements.some((requirement) =>
          requirement.contractDependencies.some((dependency) =>
            !settled.has(dependency)
          )
        )
      ) {
        settled.delete(contract.rewrite.target);
        changed = true;
      }
    }
  }
  return Object.freeze(contracts.flatMap((contract) =>
    settled.has(contract.rewrite.target) ? [contract.rewrite] : []
  ));
}
