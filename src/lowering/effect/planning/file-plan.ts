import type {
  Node,
  SourceFile,
} from "@tsonic/tsts";
import { KindAsyncKeyword } from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { CallableReturnRewrite } from "../model/callable-contract.js";
import type { ConditionalProviderInvocation } from "../flow/provider/flow.js";

export interface CooperativeEffectFilePlan {
  readonly callables: readonly Node[];
  readonly awaits: readonly Node[];
  readonly asyncModifiers: readonly Node[];
  readonly returnTypes: readonly CallableReturnRewrite[];
  readonly providerCalls: readonly ConditionalProviderInvocation[];
}

export interface CooperativeEffectFileCandidate {
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
}

interface MutableCooperativeEffectFilePlan {
  readonly callables: Node[];
  readonly awaits: Node[];
  readonly asyncModifiers: Node[];
  readonly returnTypes: Map<Node, CallableReturnRewrite>;
  readonly providerCalls: Map<Node, ConditionalProviderInvocation>;
}

export function createCooperativeEffectFilePlans(
  source: TargetSourceProgram,
  candidates: Iterable<CooperativeEffectFileCandidate>,
  optimized: ReadonlySet<Node>,
  awaits: Iterable<Node>,
  returnTypes: Iterable<CallableReturnRewrite>,
  providerCalls: Iterable<ConditionalProviderInvocation>,
): ReadonlyMap<SourceFile, CooperativeEffectFilePlan> {
  const mutable = new Map<SourceFile, MutableCooperativeEffectFilePlan>();
  for (const sourceFile of source.navigation.sourceFiles) {
    mutable.set(sourceFile, {
      callables: [],
      awaits: [],
      asyncModifiers: [],
      returnTypes: new Map(),
      providerCalls: new Map(),
    });
  }
  for (const candidate of candidates) {
    if (!optimized.has(candidate.declaration)) {
      continue;
    }
    const file = requireFilePlan(mutable, candidate.sourceFile);
    file.callables.push(candidate.declaration);
    for (const modifier of source.ast.modifiers(candidate.declaration)) {
      if (modifier?.Kind === KindAsyncKeyword) {
        file.asyncModifiers.push(modifier);
      }
    }
  }
  for (const node of awaits) {
    filePlanForNode(source, mutable, node).awaits.push(node);
  }
  for (const rewrite of returnTypes) {
    const file = filePlanForNode(source, mutable, rewrite.target);
    const existing = file.returnTypes.get(rewrite.target);
    if (
      existing !== undefined &&
      (
        existing.selection.kind !== rewrite.selection.kind ||
        existing.selection.index !== rewrite.selection.index
      )
    ) {
      throw new Error("callable return contract has conflicting rewrites");
    }
    file.returnTypes.set(rewrite.target, rewrite);
  }
  for (const provider of providerCalls) {
    const file = filePlanForNode(source, mutable, provider.call);
    if (file.providerCalls.has(provider.call)) {
      throw new Error("conditional provider call was planned twice");
    }
    file.providerCalls.set(provider.call, provider);
  }
  return new Map(
    [...mutable].map(([sourceFile, file]) => [
      sourceFile,
      Object.freeze({
        callables: Object.freeze(file.callables),
        awaits: Object.freeze(file.awaits),
        asyncModifiers: Object.freeze(file.asyncModifiers),
        returnTypes: Object.freeze([...file.returnTypes.values()]),
        providerCalls: Object.freeze([...file.providerCalls.values()]),
      }),
    ]),
  );
}

function filePlanForNode(
  source: TargetSourceProgram,
  files: ReadonlyMap<SourceFile, MutableCooperativeEffectFilePlan>,
  node: Node,
): MutableCooperativeEffectFilePlan {
  const sourceFile = source.ast.getSourceFile(node);
  if (sourceFile === undefined) {
    throw new Error("cooperative-effect node has no source file");
  }
  return requireFilePlan(files, sourceFile);
}

function requireFilePlan(
  files: ReadonlyMap<SourceFile, MutableCooperativeEffectFilePlan>,
  sourceFile: SourceFile,
): MutableCooperativeEffectFilePlan {
  const file = files.get(sourceFile);
  if (file === undefined) {
    throw new Error("cooperative-effect node belongs to a foreign source file");
  }
  return file;
}
