import type {
  Node,
  SourceFile,
} from "@tsonic/tsts";
import { KindAsyncKeyword } from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api";
import type { CallableReturnRewrite } from "../model/callable-contract.js";

export interface CooperativeEffectFilePlan {
  readonly callables: readonly Node[];
  readonly awaits: readonly Node[];
  readonly asyncModifiers: readonly Node[];
  readonly returnTypes: readonly CallableReturnRewrite[];
}

export interface CooperativeEffectFileCandidate {
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
}

interface MutableCooperativeEffectFilePlan {
  readonly callables: Node[];
  readonly awaits: Node[];
  readonly asyncModifiers: Node[];
  readonly returnTypes: CallableReturnRewrite[];
}

export function createCooperativeEffectFilePlans(
  source: TargetSourceProgram,
  candidates: Iterable<CooperativeEffectFileCandidate>,
  optimized: ReadonlySet<Node>,
  awaits: Iterable<Node>,
  returnTypes: Iterable<CallableReturnRewrite>,
): ReadonlyMap<SourceFile, CooperativeEffectFilePlan> {
  const mutable = new Map<SourceFile, MutableCooperativeEffectFilePlan>();
  for (const sourceFile of source.navigation.sourceFiles) {
    mutable.set(sourceFile, {
      callables: [],
      awaits: [],
      asyncModifiers: [],
      returnTypes: [],
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
    filePlanForNode(source, mutable, rewrite.target).returnTypes.push(rewrite);
  }
  return new Map(
    [...mutable].map(([sourceFile, file]) => [
      sourceFile,
      Object.freeze({
        callables: Object.freeze(file.callables),
        awaits: Object.freeze(file.awaits),
        asyncModifiers: Object.freeze(file.asyncModifiers),
        returnTypes: Object.freeze(file.returnTypes),
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
