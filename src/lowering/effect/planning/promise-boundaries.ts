import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type {
  GeneratedBindingName,
  ProgramGeneratedNames,
} from "../../generated-names.js";
import type {
  TypeScriptActiveCooperativeEffectProfile,
} from "../../profile.js";
import { blockCooperativeEffect } from "../closure/retention.js";
import type { CallableValueFlow } from "../flow/callable/value-flow.js";
import type { DeclaredInterfaceDispatch } from "../flow/interface/dispatch.js";
import type { CooperativeEffectCandidate } from "../inventory/candidates.js";

export interface CooperativePromiseBoundaryNames {
  readonly globalObject: GeneratedBindingName;
  readonly error: GeneratedBindingName;
}

export interface CooperativePromiseBoundary {
  readonly call: Node;
  readonly names: CooperativePromiseBoundaryNames;
}

export function prepareCooperativePromiseBoundaries(
  source: TargetSourceProgram,
  observations: Iterable<Node>,
  calls: ReadonlyMap<Node, CooperativeEffectCandidate>,
  interfaces: DeclaredInterfaceDispatch,
  valueFlow: CallableValueFlow,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  generatedNames: ProgramGeneratedNames,
  cooperativeEffects: TypeScriptActiveCooperativeEffectProfile,
): ReadonlyMap<Node, CooperativePromiseBoundaryNames> {
  const result = new Map<Node, CooperativePromiseBoundaryNames>();
  const globalObjects = new Map<SourceFile, GeneratedBindingName | null>();
  for (const call of observations) {
    const dependencies = promiseChangingCandidates(
      call,
      calls,
      interfaces,
      valueFlow,
      candidates,
    );
    if (dependencies.length === 0) {
      continue;
    }
    if (cooperativeEffects !== "closed-program") {
      for (const dependency of dependencies) {
        blockCooperativeEffect(dependency, "promise-observed", call);
      }
      continue;
    }
    const sourceFile = source.ast.getSourceFile(call);
    if (sourceFile === undefined) {
      throw new Error("cooperative Promise observation has no source file");
    }
    let globalObject = globalObjects.get(sourceFile);
    if (globalObject === undefined) {
      globalObject = generatedNames.forFile(sourceFile).reserveExact(
        "globalThis",
      ) ?? null;
      globalObjects.set(sourceFile, globalObject);
    }
    if (globalObject === null) {
      for (const dependency of dependencies) {
        blockCooperativeEffect(dependency, "promise-observed", call);
      }
      continue;
    }
    result.set(call, Object.freeze({
      globalObject,
      error: generatedNames.forFile(sourceFile).reserve(
        "$promiseObservationError",
      ),
    }));
  }
  return new Map(result);
}

export function collectCooperativePromiseBoundaries(
  observations: Iterable<Node>,
  calls: ReadonlyMap<Node, CooperativeEffectCandidate>,
  interfaces: DeclaredInterfaceDispatch,
  valueFlow: CallableValueFlow,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  optimized: ReadonlySet<Node>,
  names: ReadonlyMap<Node, CooperativePromiseBoundaryNames>,
): readonly CooperativePromiseBoundary[] {
  const result: CooperativePromiseBoundary[] = [];
  for (const call of observations) {
    const direct = calls.get(call);
    if (direct !== undefined) {
      if (optimized.has(direct.declaration)) {
        result.push(requiredBoundary(call, names));
      }
      continue;
    }
    const family = interfaces.calls.get(call);
    if (family !== undefined) {
      if (
        family.candidates.length !== 0 &&
        interfaces.callIsSettled(call, optimized)
      ) {
        result.push(requiredBoundary(call, names));
      }
      continue;
    }
    const dependencies = promiseChangingCandidates(
      call,
      calls,
      interfaces,
      valueFlow,
      candidates,
    );
    if (
      dependencies.length !== 0 &&
      dependencies.every((candidate) => optimized.has(candidate.declaration))
    ) {
      result.push(requiredBoundary(call, names));
    }
  }
  return Object.freeze(result);
}

function promiseChangingCandidates(
  call: Node,
  calls: ReadonlyMap<Node, CooperativeEffectCandidate>,
  interfaces: DeclaredInterfaceDispatch,
  valueFlow: CallableValueFlow,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
): readonly CooperativeEffectCandidate[] {
  const direct = calls.get(call);
  if (direct !== undefined) {
    return Object.freeze([direct]);
  }
  const family = interfaces.calls.get(call);
  if (family !== undefined) {
    return Object.freeze([...family.candidates]);
  }
  const result = valueFlow.resolutionFor(call);
  const contract = valueFlow.contractForCall(call);
  const selected = new Map<Node, CooperativeEffectCandidate>();
  for (
    const declaration of [
      ...(result?.dependencyNodes() ?? []),
      ...(contract?.dependencyNodes() ?? []),
    ]
  ) {
    const candidate = candidates.get(declaration);
    if (candidate !== undefined) {
      selected.set(candidate.declaration, candidate);
    }
  }
  return Object.freeze([...selected.values()]);
}

function requiredBoundary(
  call: Node,
  names: ReadonlyMap<Node, CooperativePromiseBoundaryNames>,
): CooperativePromiseBoundary {
  const selected = names.get(call);
  if (selected === undefined) {
    throw new Error("settled Promise observation has no lexical boundary");
  }
  return Object.freeze({ call, names: selected });
}
