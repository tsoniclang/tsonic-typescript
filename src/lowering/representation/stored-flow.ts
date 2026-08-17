import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  AsCallExpression,
  AsVariableDeclaration,
  AsVariableDeclarationList,
  IsCallExpression,
  IsIdentifier,
  IsVariableDeclaration,
  IsVariableDeclarationList,
  IsVariableStatement,
  NodeFlagsConst,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";
import {
  representationFactoryArgument,
  type ProjectionCallShape,
} from "./shape.js";

export interface StoredRepresentationFlow {
  readonly binding: Node;
  readonly construction: Node;
  readonly projections: readonly ProjectionCallShape[];
}

export interface StoredRepresentationFlowPlan {
  readonly flowCount: number;
  readonly constructionCount: number;
  readonly projectionCount: number;
  readonly flows: readonly StoredRepresentationFlow[];
  constructionFor(call: Node): StoredRepresentationFlow | undefined;
  projectionFor(call: Node): StoredRepresentationFlow | undefined;
  constructionsFor(sourceFile: SourceFile): readonly Node[];
}

const noNodes = Object.freeze([]) as readonly Node[];

export function createStoredRepresentationFlowPlan(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  candidates: readonly ProjectionCallShape[],
): StoredRepresentationFlowPlan {
  const candidateByArgument = new Map<Node, ProjectionCallShape>();
  const candidateBindings = new Set<Node>();
  const candidateArgumentsByBinding = new Map<Node, Node[]>();
  for (const candidate of candidates) {
    const argument = AsCallExpression(candidate.call)?.Arguments?.Nodes[0];
    if (argument === undefined || !IsIdentifier(argument)) {
      continue;
    }
    const binding = source.navigation.sourceReferenceFor(argument)?.declaration;
    if (binding === undefined || !IsVariableDeclaration(binding)) {
      continue;
    }
    candidateByArgument.set(argument, candidate);
    candidateBindings.add(binding);
    const arguments_ = candidateArgumentsByBinding.get(binding);
    if (arguments_ === undefined) {
      candidateArgumentsByBinding.set(binding, [argument]);
    } else {
      arguments_.push(argument);
    }
  }

  const flows: StoredRepresentationFlow[] = [];
  for (const binding of candidateBindings) {
    const flow = resolveFlow(
      source,
      program,
      binding,
      candidateByArgument,
      candidateArgumentsByBinding.get(binding) ?? [],
    );
    if (flow !== undefined) {
      flows.push(flow);
    }
  }
  return sealPlan(source, flows);
}

function resolveFlow(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  binding: Node,
  candidateByArgument: ReadonlyMap<Node, ProjectionCallShape>,
  candidateArguments: readonly Node[],
): StoredRepresentationFlow | undefined {
  const declaration = AsVariableDeclaration(binding);
  const construction = declaration?.Initializer;
  if (
    declaration === undefined ||
    declaration.Type !== undefined ||
    declaration.ExclamationToken !== undefined ||
    construction === undefined ||
    !IsCallExpression(construction) ||
    !closedConstBinding(source, program, binding)
  ) {
    return undefined;
  }

  const references = source.navigation.referencesToDeclaration(binding);
  const referenceSet = new Set(references);
  if (
    references.length !== candidateArguments.length ||
    candidateArguments.some((argument) => !referenceSet.has(argument))
  ) {
    return undefined;
  }
  const projections: ProjectionCallShape[] = [];
  for (const reference of references) {
    const projection = candidateByArgument.get(reference);
    if (projection === undefined) {
      return undefined;
    }
    const factory = representationFactoryArgument(
      source,
      program,
      construction,
      projection,
    );
    if (factory.kind !== "proved") {
      return undefined;
    }
    projections.push(projection);
  }
  if (
    projections.length === 0 ||
    new Set(projections.map((projection) => projection.call)).size !==
      projections.length
  ) {
    return undefined;
  }
  return Object.freeze({
    binding,
    construction,
    projections: Object.freeze(projections),
  });
}

function closedConstBinding(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  binding: Node,
): boolean {
  if (program.bindingWritesFor(binding).length !== 0) {
    return false;
  }
  const listNode = source.ast.parent(binding);
  if (!IsVariableDeclarationList(listNode)) {
    return false;
  }
  const list = AsVariableDeclarationList(listNode);
  const statement = source.ast.parent(listNode);
  return list !== undefined &&
    (list.Flags & NodeFlagsConst) !== 0 &&
    IsVariableStatement(statement) &&
    !source.ast.hasModifierKind(statement, "export") &&
    !source.ast.hasModifierKind(statement, "default");
}

function sealPlan(
  source: TargetSourceProgram,
  flows: readonly StoredRepresentationFlow[],
): StoredRepresentationFlowPlan {
  const byConstruction = new Map<Node, StoredRepresentationFlow>();
  const byProjection = new Map<Node, StoredRepresentationFlow>();
  const byFile = new Map<SourceFile, Node[]>();
  for (const flow of flows) {
    if (byConstruction.has(flow.construction)) {
      throw new Error("one representation construction owns two stored flows");
    }
    byConstruction.set(flow.construction, flow);
    addToFile(source, byFile, flow.construction);
    for (const projection of flow.projections) {
      if (byProjection.has(projection.call)) {
        throw new Error("one representation projection owns two stored flows");
      }
      byProjection.set(projection.call, flow);
    }
  }
  const sealedByFile = new Map<SourceFile, readonly Node[]>();
  for (const [sourceFile, constructions] of byFile) {
    sealedByFile.set(sourceFile, Object.freeze([...constructions]));
  }
  return Object.freeze({
    flowCount: flows.length,
    constructionCount: byConstruction.size,
    projectionCount: byProjection.size,
    flows: Object.freeze([...flows]),
    constructionFor(call: Node) {
      return byConstruction.get(call);
    },
    projectionFor(call: Node) {
      return byProjection.get(call);
    },
    constructionsFor(sourceFile: SourceFile) {
      return sealedByFile.get(sourceFile) ?? noNodes;
    },
  });
}

function addToFile(
  source: TargetSourceProgram,
  byFile: Map<SourceFile, Node[]>,
  node: Node,
): void {
  const sourceFile = source.ast.getSourceFile(node);
  if (sourceFile === undefined) {
    throw new Error("stored representation construction has no source file");
  }
  const selected = byFile.get(sourceFile);
  if (selected === undefined) {
    byFile.set(sourceFile, [node]);
  } else {
    selected.push(node);
  }
}
