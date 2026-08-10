import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  AsExportDeclaration,
  AsImportClause,
  AsImportDeclaration,
  AsNamedExports,
  AsNamedImports,
  AsSourceFile,
  IsBlock,
  IsCaseClause,
  IsDefaultClause,
  IsExportDeclaration,
  IsImportClause,
  IsImportDeclaration,
  IsModuleBlock,
  IsNamedExports,
  IsNamedImports,
  IsSourceFile,
  transformTargetSourceFile,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import {
  createFinalNodeJournal,
  type FinalNodeLookup,
} from "../final-nodes.js";

import { PointerLoweringError } from "./diagnostic.js";
import type { ClosedPointerFlowPlan } from "./flow-plan.js";
import { pointerFlowRepresentation, pointerLoweringPlanUsesRuntime } from "./flow-application.js";
import {
  rewriteLocationStatementOwner,
  wrapExpressionLocationBody,
} from "./location-statements.js";
import {
  lowerLocationPointerOperation,
  lowerLocationPointerType,
} from "./location-operation-ast.js";
import {
  createPointerLoweringPlan,
  type PointerLoweringPlan,
} from "./plan.js";
import { lowerRawPointerOperation, lowerRawPointerType } from "./raw.js";
import {
  lowerOptimizedPointerOperation,
  lowerOptimizedPointerType,
} from "./representation-ast.js";
import {
  prependRuntimeImport,
} from "./runtime-ast.js";

export interface PointerLoweringResult {
  readonly sourceFile: SourceFile;
  readonly operationCount: number;
  readonly pointerTypeCount: number;
  readonly rawPointerOperationCount: number;
  readonly rawPointerTypeCount: number;
  readonly locationBindingCount: number;
  readonly runtimeAlias: string | undefined;
}

export function lowerPointers(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  flowPlan?: ClosedPointerFlowPlan,
): PointerLoweringResult {
  const plan = createPointerLoweringPlan(source, sourceFile, flowPlan);
  return applyPointerLoweringPlan(source, plan);
}

export interface PointerRewriteSession {
  rewrite(
    original: Node,
    updated: Node,
    factory: NodeFactory,
  ): Node | undefined;
  finish(sourceFile: SourceFile): PointerLoweringResult;
}

function applyPointerLoweringPlan(
  source: TargetSourceProgram,
  plan: PointerLoweringPlan,
): PointerLoweringResult {
  const { sourceFile } = plan;
  const usesRuntime = pointerLoweringPlanUsesRuntime(plan);
  if (
    plan.operations.size === 0 &&
    plan.pointerTypes.size === 0 &&
    plan.rawPointerOperations.size === 0 &&
    plan.rawPointerTypes.size === 0 &&
    plan.removableMarkerDeclarations.size === 0
  ) {
    return Object.freeze({
      sourceFile,
      operationCount: 0,
      pointerTypeCount: 0,
      rawPointerOperationCount: 0,
      rawPointerTypeCount: 0,
      locationBindingCount: 0,
      runtimeAlias: undefined,
    });
  }
  const finalNodes = createFinalNodeJournal();
  const session = createPointerRewriteSessionForPlan(source, plan, finalNodes);
  const transformed = transformTargetSourceFile(
    sourceFile,
    (original, updated, factory) => finalNodes.record(
      original,
      session.rewrite(original, updated, factory),
    ),
  );
  return session.finish(transformed);
}

export function createPointerRewriteSession(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  flowPlan: ClosedPointerFlowPlan | undefined,
  finalNodes: FinalNodeLookup,
): PointerRewriteSession {
  return createPointerRewriteSessionForPlan(
    source,
    createPointerLoweringPlan(source, sourceFile, flowPlan),
    finalNodes,
  );
}

function createPointerRewriteSessionForPlan(
  source: TargetSourceProgram,
  plan: PointerLoweringPlan,
  finalNodes: FinalNodeLookup,
): PointerRewriteSession {
  const consumed = createConsumptionState();
  let finished = false;
  const rewrite = (
    original: Node,
    updated: Node,
    factory: NodeFactory,
  ): Node | undefined => {
    if (finished) {
      throw new PointerLoweringError("pointer rewrite session is already sealed");
    }
    const rewritten = rewriteNode(
      source,
      plan,
      consumed,
      finalNodes,
      original,
      updated,
      factory,
    );
    return rewritten;
  };
  return Object.freeze({
    rewrite,
    finish(transformed: SourceFile): PointerLoweringResult {
      if (finished) {
        throw new PointerLoweringError("pointer rewrite session was sealed twice");
      }
      finished = true;
      assertCompleteConsumption(plan, consumed);
      return pointerLoweringResult(plan, consumed, transformed);
    },
  });
}

function pointerLoweringResult(
  plan: PointerLoweringPlan,
  consumed: ConsumptionState,
  transformed: SourceFile,
): PointerLoweringResult {
  const usesRuntime = pointerLoweringPlanUsesRuntime(plan);
  return Object.freeze({
    sourceFile: transformed,
    operationCount: consumed.operations.size,
    pointerTypeCount: consumed.pointerTypes.size,
    rawPointerOperationCount: consumed.rawPointerOperations.size,
    rawPointerTypeCount: consumed.rawPointerTypes.size,
    locationBindingCount: consumed.locationBindings.size,
    runtimeAlias: usesRuntime ? plan.runtimeAlias : undefined,
  });
}

interface ConsumptionState {
  readonly operations: Set<Node>;
  readonly pointerTypes: Set<Node>;
  readonly rawPointerOperations: Set<Node>;
  readonly rawPointerTypes: Set<Node>;
  readonly locationBindings: Set<Node>;
  readonly removableMarkerDeclarations: Set<Node>;
}

function createConsumptionState(): ConsumptionState {
  return {
    operations: new Set(),
    pointerTypes: new Set(),
    rawPointerOperations: new Set(),
    rawPointerTypes: new Set(),
    locationBindings: new Set(),
    removableMarkerDeclarations: new Set(),
  };
}

function rewriteNode(
  source: TargetSourceProgram,
  plan: PointerLoweringPlan,
  consumed: ConsumptionState,
  finalNodes: FinalNodeLookup,
  original: Node,
  updated: Node,
  factory: NodeFactory,
): Node | undefined {
  if (plan.removableMarkerDeclarations.has(original)) {
    consumed.removableMarkerDeclarations.add(original);
    return undefined;
  }

  const namedImports = IsNamedImports(updated) ? AsNamedImports(updated) : undefined;
  if (namedImports !== undefined && namedImports.Elements?.Nodes.length === 0) {
    return undefined;
  }
  const importClause = IsImportClause(updated) ? AsImportClause(updated) : undefined;
  if (
    importClause !== undefined &&
    importClause.name === undefined &&
    importClause.NamedBindings === undefined
  ) {
    return undefined;
  }
  const importDeclaration = IsImportDeclaration(updated)
    ? AsImportDeclaration(updated)
    : undefined;
  if (
    importDeclaration !== undefined &&
    IsImportDeclaration(original) &&
    AsImportDeclaration(original)?.ImportClause !== undefined &&
    importDeclaration.ImportClause === undefined
  ) {
    return undefined;
  }
  const namedExports = IsNamedExports(updated)
    ? AsNamedExports(updated)
    : undefined;
  if (namedExports !== undefined && namedExports.Elements?.Nodes.length === 0) {
    return undefined;
  }
  const exportDeclaration = IsExportDeclaration(updated)
    ? AsExportDeclaration(updated)
    : undefined;
  if (
    exportDeclaration !== undefined &&
    IsExportDeclaration(original) &&
    AsExportDeclaration(original)?.ExportClause !== undefined &&
    exportDeclaration.ExportClause === undefined
  ) {
    return undefined;
  }

  const operation = plan.operations.get(original);
  if (operation !== undefined) {
    consumed.operations.add(original);
    const optimized = lowerOptimizedPointerOperation(
      factory,
      operation,
      updated,
      pointerFlowRepresentation(plan, original),
    );
    if (optimized !== undefined) {
      return optimized;
    }
    return lowerLocationPointerOperation(
      source,
      factory,
      operation,
      updated,
      plan,
      finalNodes,
    );
  }

  const rawPointerOperation = plan.rawPointerOperations.get(original);
  if (rawPointerOperation !== undefined) {
    consumed.rawPointerOperations.add(original);
    return lowerRawPointerOperation(
      factory,
      rawPointerOperation,
      updated,
      plan.runtimeAlias,
    );
  }

  if (plan.pointerTypes.has(original)) {
    consumed.pointerTypes.add(original);
    const optimized = lowerOptimizedPointerType(
      factory,
      updated,
      pointerFlowRepresentation(plan, original),
    );
    if (optimized !== undefined) {
      return optimized;
    }
    return lowerLocationPointerType(factory, updated, plan.runtimeAlias);
  }


  if (plan.rawPointerTypes.has(original)) {
    consumed.rawPointerTypes.add(original);
    return lowerRawPointerType(factory, updated, plan.runtimeAlias);
  }

  let structuralResult = updated;
  if (
    IsSourceFile(original) ||
    IsBlock(original) ||
    IsModuleBlock(original) ||
    IsCaseClause(original) ||
    IsDefaultClause(original)
  ) {
    structuralResult = rewriteLocationStatementOwner(
      source,
      factory,
      original,
      structuralResult,
      plan,
      finalNodes,
      (binding) => consumed.locationBindings.add(binding.declaration),
    );
  } else {
    const bodyBindings = plan.prologueBindingsByBody.get(original);
    if (bodyBindings !== undefined) {
      structuralResult = wrapExpressionLocationBody(
        factory,
        structuralResult,
        bodyBindings,
        plan.runtimeAlias,
        (binding) => consumed.locationBindings.add(binding.declaration),
      );
    }
  }

  if (IsSourceFile(structuralResult)) {
    const sourceFile = AsSourceFile(structuralResult);
    if (sourceFile === undefined) {
      throw new PointerLoweringError(
        "source-file predicate did not yield a source-file receiver",
      );
    }
    return pointerLoweringPlanUsesRuntime(plan) ? prependRuntimeImport(
      factory,
      sourceFile,
      plan.runtimeAlias,
      plan.usesRuntimeValue,
    ) : sourceFile;
  }
  return structuralResult;
}

function assertCompleteConsumption(
  plan: PointerLoweringPlan,
  consumed: ConsumptionState,
): void {
  assertCount("pointer operations", consumed.operations, plan.operations.size);
  assertCount("pointer types", consumed.pointerTypes, plan.pointerTypes.size);
  assertCount(
    "raw-pointer operations",
    consumed.rawPointerOperations,
    plan.rawPointerOperations.size,
  );
  assertCount(
    "raw-pointer types",
    consumed.rawPointerTypes,
    plan.rawPointerTypes.size,
  );
  const parameterCount = [...plan.prologueBindingsByBody.values()].reduce(
    (count, bindings) => count + bindings.filter(
      (binding) => binding.kind === "parameter",
    ).length,
    0,
  );
  assertCount(
    "location bindings",
    consumed.locationBindings,
    plan.localBindings.size + parameterCount,
  );
  assertCount(
    "removable marker declarations",
    consumed.removableMarkerDeclarations,
    plan.removableMarkerDeclarations.size,
  );
}

function assertCount(
  subject: string,
  consumed: ReadonlySet<Node>,
  expected: number,
): void {
  if (consumed.size !== expected) {
    throw new PointerLoweringError(
      `consumed ${consumed.size} ${subject}, expected ${expected}`,
    );
  }
}
