import type { Node } from "@tsonic/tsts";

import type { CallableReturnRewrite } from "../../../model/callable-contract.js";
import {
  allCallableDependenciesAreOptimized,
  createCallableValueResolution,
  type CallableValueResolution,
} from "../value-resolution.js";
import type {
  CallableCallContractRequirement,
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
  resolutionForExpression(
    expression: Node | undefined,
  ): CallableValueResolution | undefined;
  contractForCall(call: Node): CallableValueResolution | undefined;
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
  callContractRequirements: ReadonlyMap<Node, CallableCallContractRequirement>,
  expressionResolution: (
    expression: Node,
  ) => CallableValueResolution | undefined,
  inheritedCallableReferenceIsClosed:
    ((reference: Node) => boolean) | undefined,
): GraphCallableValueFlow {
  const returnContracts = finalizeReturnContracts(settledReturnContracts);
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
    resolutionForExpression(
      expression: Node | undefined,
    ): CallableValueResolution | undefined {
      return expression === undefined
        ? undefined
        : expressionResolution(expression);
    },
    contractForCall(call: Node): CallableValueResolution | undefined {
      const requirement = callContractRequirements.get(call);
      if (requirement === undefined) {
        return undefined;
      }
      if (!requirement.resolvable) {
        return unresolvedContract;
      }
      const contract = returnContracts.resolutionFor(
        requirement.contractDependencies,
      );
      return contract.closed
        ? createCallableValueResolution(
            true,
            [
              ...requirement.candidateDependencies,
              ...contract.dependencyNodes(),
            ],
            [],
          )
        : unresolvedContract;
    },
    allowsCallableReference(node: Node): boolean {
      return inheritedCallableReferenceIsClosed?.(node) === true ||
        closedCallableReferences.has(node);
    },
    settledReturnTypes(
      optimized: ReadonlySet<Node>,
    ): readonly CallableReturnRewrite[] {
      return Object.freeze(returnContracts.rewrites.filter((rewrite) => {
        const resolution = returnContracts.resolutionFor([rewrite.target]);
        return resolution.closed &&
          allCallableDependenciesAreOptimized(resolution, optimized);
      }));
    },
  });
}

interface FinalizedReturnContracts {
  readonly rewrites: readonly CallableReturnRewrite[];
  resolutionFor(targets: readonly Node[]): CallableValueResolution;
}

function finalizeReturnContracts(
  contracts: readonly SettledCallableReturnContract[],
): FinalizedReturnContracts {
  const byTarget = new Map(contracts.map((contract) => [
    contract.rewrite.target,
    contract,
  ]));
  const settled = new Set<Node>(contracts.flatMap((contract) =>
    contract.resolutions.every((resolution) =>
        resolution.closed
      ) &&
      contract.sourceRequirements.every((requirement) =>
        requirement.resolvable
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
  const resolutions = new Map<Node, CallableValueResolution>();
  const resolutionForTarget = (target: Node): CallableValueResolution => {
    const existing = resolutions.get(target);
    if (existing !== undefined) {
      return existing;
    }
    if (!settled.has(target)) {
      return unresolvedContract;
    }
    const dependencies = new Set<Node>();
    const visited = new Set<Node>();
    const pending = [target];
    while (pending.length !== 0) {
      const current = pending.pop();
      if (current === undefined || visited.has(current)) {
        continue;
      }
      visited.add(current);
      const contract = byTarget.get(current);
      if (contract === undefined || !settled.has(current)) {
        return unresolvedContract;
      }
      for (const resolution of contract.resolutions) {
        for (const dependency of resolution.dependencyNodes()) {
          dependencies.add(dependency);
        }
      }
      for (const requirement of contract.sourceRequirements) {
        for (const dependency of requirement.candidateDependencies) {
          dependencies.add(dependency);
        }
        pending.push(...requirement.contractDependencies);
      }
    }
    const result = createCallableValueResolution(true, dependencies, []);
    resolutions.set(target, result);
    return result;
  };
  return Object.freeze({
    rewrites: Object.freeze(contracts.flatMap((contract) =>
      settled.has(contract.rewrite.target) ? [contract.rewrite] : []
    )),
    resolutionFor(targets: readonly Node[]): CallableValueResolution {
      if (targets.length === 0) {
        return resolvedContract;
      }
      const dependencies = new Set<Node>();
      for (const target of targets) {
        const resolution = resolutionForTarget(target);
        if (!resolution.closed) {
          return unresolvedContract;
        }
        for (const dependency of resolution.dependencyNodes()) {
          dependencies.add(dependency);
        }
      }
      return createCallableValueResolution(true, dependencies, []);
    },
  });
}

const resolvedContract = createCallableValueResolution(true, [], []);
const unresolvedContract = createCallableValueResolution(false, [], []);
