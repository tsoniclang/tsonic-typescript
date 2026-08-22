import type { Node } from "@tsonic/tsts";

import type { CallableReturnRewrite } from "../../../model/callable-contract.js";
import {
  allCallableDependenciesAreOptimized,
  type CallableValueResolution,
} from "../value-resolution.js";

export interface SettledCallableReturnContract {
  readonly rewrite: CallableReturnRewrite;
  readonly resolutions: readonly CallableValueResolution[];
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
      return Object.freeze(settledReturnContracts.flatMap(
        ({ rewrite, resolutions }) =>
          resolutions.every((resolution) => {
            return resolution.closed &&
              allCallableDependenciesAreOptimized(resolution, optimized);
          })
            ? [rewrite]
            : [],
      ));
    },
  });
}
