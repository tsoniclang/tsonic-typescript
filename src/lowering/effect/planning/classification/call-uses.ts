import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import { connectCooperativeEffectDependency } from "../../closure/dependency.js";
import { blockCooperativeEffect } from "../../closure/retention.js";
import type { CallableValueFlow } from "../../flow/callable/value-flow.js";
import type { DeclaredInterfaceDispatch } from "../../flow/interface/dispatch.js";
import type { ConditionalProviderEffectFlow } from "../../flow/provider/conditional.js";
import type { CooperativeEffectCandidate } from "../../inventory/candidates.js";
import {
  containingAwait,
  containingReturn,
  isDiscardedCall,
} from "../../model/syntax.js";
import { enclosingCooperativeCandidate } from "./owner.js";
import { resolvedCallProducesDefinitelySynchronousValue } from "../../model/synchronous.js";

export interface CooperativeEffectCallUseClassification {
  readonly promiseCalls: ReadonlySet<Node>;
  readonly providerPromiseCalls: ReadonlySet<Node>;
}

export function classifyCooperativeEffectCallUses(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  calls: ReadonlyMap<Node, CooperativeEffectCandidate>,
  interfaces: DeclaredInterfaceDispatch,
  valueFlow: CallableValueFlow,
  providers: ConditionalProviderEffectFlow,
  returnedCallHasClosedConsumers: (call: Node) => boolean,
): CooperativeEffectCallUseClassification {
  const promiseCalls = new Set<Node>();
  const providerPromiseCalls = new Set<Node>();
  for (const [call, candidate] of calls) {
    const use = cooperativeCallUse(source, candidates, call);
    if (use === "awaited") {
      continue;
    }
    if (use === "discarded") {
      promiseCalls.add(call);
      continue;
    }
    if (typeof use !== "string") {
      connectCooperativeEffectDependency(use.owner, candidate, "return", call);
      continue;
    }
    if (!returnedCallHasClosedConsumers(call)) {
      promiseCalls.add(call);
    }
  }
  for (const [call, family] of interfaces.calls) {
    const use = cooperativeCallUse(source, candidates, call);
    if (use === "awaited") {
      continue;
    }
    if (use === "discarded") {
      promiseCalls.add(call);
      continue;
    }
    if (typeof use !== "string") {
      interfaces.addDependencies(use.owner, family, "return", call);
      continue;
    }
    if (!returnedCallHasClosedConsumers(call)) {
      promiseCalls.add(call);
    }
  }
  valueFlow.forEachCall((call, resolution) => {
    if (
      calls.has(call) ||
      interfaces.calls.has(call) ||
      interfaces.callIsRejected(call) ||
      valueFlow.callReturnsCallableValue(call) ||
      resolvedCallProducesDefinitelySynchronousValue(source, call) ||
      resolution.dependencyCount === 0
    ) {
      return;
    }
    const use = cooperativeCallUse(source, candidates, call);
    if (use === "awaited") {
      return;
    }
    if (use === "discarded") {
      promiseCalls.add(call);
      return;
    }
    if (typeof use !== "string") {
      return;
    }
    if (
      !resolution.closed ||
      !returnedCallHasClosedConsumers(call)
    ) {
      promiseCalls.add(call);
    }
  });
  for (const provider of providers.calls) {
    const resolution = providers.resolutionFor(provider.call);
    if (resolution === undefined) {
      continue;
    }
    const use = cooperativeCallUse(source, candidates, provider.call);
    if (use === "awaited") {
      continue;
    }
    if (use === "discarded") {
      providerPromiseCalls.add(provider.call);
      continue;
    }
    if (use === "consumer") {
      if (!returnedCallHasClosedConsumers(provider.call)) {
        providerPromiseCalls.add(provider.call);
      }
      continue;
    }
    const dependencies = [...resolution.dependencyNodes()].map((declaration) =>
      candidates.get(declaration)
    );
    if (dependencies.some((dependency) => dependency === undefined)) {
      blockCooperativeEffect(use.owner, "unresolved-call", provider.call);
      continue;
    }
    for (const dependency of dependencies) {
      if (dependency === undefined) {
        throw new Error("validated provider dependency disappeared");
      }
      connectCooperativeEffectDependency(
        use.owner,
        dependency,
        "return",
        provider.call,
      );
    }
  }
  return Object.freeze({
    promiseCalls: Object.freeze(promiseCalls),
    providerPromiseCalls: Object.freeze(providerPromiseCalls),
  });
}

export function collectCooperativeResultConsumerQueries(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  calls: ReadonlyMap<Node, CooperativeEffectCandidate>,
  interfaces: DeclaredInterfaceDispatch,
  valueFlow: CallableValueFlow,
  providers: ConditionalProviderEffectFlow,
): ReadonlySet<Node> {
  const queries = new Set<Node>();
  const include = (call: Node): void => {
    if (cooperativeCallUse(source, candidates, call) === "consumer") {
      queries.add(call);
    }
  };
  for (const call of calls.keys()) {
    include(call);
  }
  for (const call of interfaces.calls.keys()) {
    include(call);
  }
  for (const provider of providers.calls) {
    include(provider.call);
  }
  valueFlow.forEachCall((call, resolution) => {
    if (
      !calls.has(call) &&
      !interfaces.calls.has(call) &&
      !valueFlow.callReturnsCallableValue(call) &&
      !resolvedCallProducesDefinitelySynchronousValue(source, call) &&
      resolution.closed &&
      resolution.dependencyCount !== 0
    ) {
      include(call);
    }
  });
  return Object.freeze(queries);
}

type CooperativeCallUse =
  | "awaited"
  | "discarded"
  | "consumer"
  | { readonly kind: "returned"; readonly owner: CooperativeEffectCandidate };

function cooperativeCallUse(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  call: Node,
): CooperativeCallUse {
  if (containingAwait(source, call) !== undefined) {
    return "awaited";
  }
  if (isDiscardedCall(source, call)) {
    return "discarded";
  }
  const owner = enclosingCooperativeCandidate(source, candidates, call);
  return owner !== undefined && containingReturn(source, call) !== undefined
    ? Object.freeze({ kind: "returned", owner })
    : "consumer";
}
