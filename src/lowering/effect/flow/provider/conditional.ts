import type { Node } from "@tsonic/tsts";

import type { CallableValueFlow } from "../callable/value-flow.js";
import {
  createCallableValueResolution,
  type CallableValueResolution,
} from "../callable/value-resolution.js";
import type {
  ConditionalProviderInvocation,
  ProviderInvocationFlow,
} from "./flow.js";

export interface ConditionalProviderEffectFlow {
  readonly calls: readonly ConditionalProviderInvocation[];
  forCall(call: Node | undefined): ConditionalProviderInvocation | undefined;
  resolutionFor(call: Node | undefined): CallableValueResolution | undefined;
  settledCalls(
    optimized: ReadonlySet<Node>,
  ): readonly ConditionalProviderInvocation[];
}

export function createConditionalProviderEffectFlow(
  providers: ProviderInvocationFlow,
  values: CallableValueFlow,
): ConditionalProviderEffectFlow {
  const resolutions = new Map<Node, CallableValueResolution>();
  for (const call of providers.conditionalCalls) {
    const expressions = call.callableExpressions;
    if (expressions === undefined || expressions.length === 0) {
      continue;
    }
    const selected = expressions.map((expression) =>
      values.resolutionForExpression(expression)
    );
    if (selected.some((resolution) =>
      resolution === undefined ||
      !resolution.closed ||
      resolution.dependencyCount + resolution.synchronousDeclarationCount === 0
    )) {
      continue;
    }
    const dependencies = new Set<Node>();
    const synchronous = new Set<Node>();
    for (const resolution of selected) {
      if (resolution === undefined) {
        throw new Error("conditional provider resolution disappeared");
      }
      for (const declaration of resolution.dependencyNodes()) {
        dependencies.add(declaration);
      }
      for (const declaration of resolution.synchronousDeclarationNodes()) {
        synchronous.add(declaration);
      }
    }
    resolutions.set(
      call.call,
      createCallableValueResolution(true, dependencies, synchronous),
    );
  }
  return Object.freeze({
    calls: providers.conditionalCalls,
    forCall(call: Node | undefined): ConditionalProviderInvocation | undefined {
      return providers.conditionalFor(call);
    },
    resolutionFor(call: Node | undefined): CallableValueResolution | undefined {
      return call === undefined ? undefined : resolutions.get(call);
    },
    settledCalls(
      optimized: ReadonlySet<Node>,
    ): readonly ConditionalProviderInvocation[] {
      return Object.freeze(providers.conditionalCalls.filter((call) => {
        const resolution = resolutions.get(call.call);
        if (resolution === undefined) {
          return false;
        }
        for (const dependency of resolution.dependencyNodes()) {
          if (!optimized.has(dependency)) {
            return false;
          }
        }
        return true;
      }));
    },
  });
}
