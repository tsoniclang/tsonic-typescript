import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
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
import {
  createProgramGeneratedNames,
  type SourceFileGeneratedNames,
} from "../generated-names.js";
import {
  createTargetProgramIndex,
  type TargetProgramIndex,
} from "../program-index.js";

import { PointerLoweringError } from "./diagnostic.js";
import {
  appendDirectObjectReplacementMethod,
} from "./direct-object-replacement-ast.js";
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
import {
  createPointerProjectionCallablePlan,
  type PointerProjectionCallablePlan,
} from "./projection-callable-plan.js";
import { lowerRawPointerOperation, lowerRawPointerType } from "./raw.js";
import {
  lowerOptimizedPointerOperation,
  lowerOptimizedPointerType,
} from "./representation-ast.js";
import { applyPointerInferenceStabilization } from "./inference-stabilization.js";
import { lowerPointerProjectionFusion } from "./projection-fusion-ast.js";
import {
  insertProjectedPropertyLocationClass,
  lowerProjectedPropertyLocation,
} from "./projected-property-ast.js";
import {
  insertCanonicalPointerKeyMapStorage,
  rewriteCanonicalPointerKeyMapNode,
} from "./map/transform.js";
import {
  prependRuntimeImport,
} from "./runtime-ast.js";
import {
  assertCompletePointerLoweringConsumption,
  createPointerLoweringConsumption,
  type PointerLoweringConsumption,
} from "./consumption.js";

export interface PointerLoweringResult {
  readonly sourceFile: SourceFile;
  readonly operationCount: number;
  readonly pointerTypeCount: number;
  readonly rawPointerOperationCount: number;
  readonly rawPointerTypeCount: number;
  readonly locationBindingCount: number;
  readonly inferenceStabilizationCount: number;
  readonly directObjectReplacementCount: number;
  readonly representationTransportInlineCount: number;
  readonly runtimeAlias: string | undefined;
}

export function lowerPointers(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  flowPlan?: ClosedPointerFlowPlan,
): PointerLoweringResult {
  const program = createTargetProgramIndex(source, {
    bindingWrites: true,
  });
  const generatedNames = createProgramGeneratedNames(source, program)
    .forFile(sourceFile);
  const projectionCallables = createPointerProjectionCallablePlan(
    source,
    program,
    flowPlan === undefined ? "location" : "closed-direct",
    (selected) => source.documents.forFile(selected).identity,
  );
  const plan = createPointerLoweringPlan(
    source,
    sourceFile,
    program,
    generatedNames,
    flowPlan,
    projectionCallables,
  );
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
    plan.removableMarkerDeclarations.size === 0 &&
    plan.representationTransportInlines.count === 0
  ) {
    return Object.freeze({
      sourceFile,
      operationCount: 0,
      pointerTypeCount: 0,
      rawPointerOperationCount: 0,
      rawPointerTypeCount: 0,
      locationBindingCount: 0,
      inferenceStabilizationCount: 0,
      directObjectReplacementCount: 0,
      representationTransportInlineCount: 0,
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
  program: TargetProgramIndex,
  generatedNames: SourceFileGeneratedNames,
  flowPlan: ClosedPointerFlowPlan | undefined,
  projectionCallables: PointerProjectionCallablePlan,
  finalNodes: FinalNodeLookup,
): PointerRewriteSession {
  return createPointerRewriteSessionForPlan(
    source,
    createPointerLoweringPlan(
      source,
      sourceFile,
      program,
      generatedNames,
      flowPlan,
      projectionCallables,
    ),
    finalNodes,
  );
}

function createPointerRewriteSessionForPlan(
  source: TargetSourceProgram,
  plan: PointerLoweringPlan,
  finalNodes: FinalNodeLookup,
): PointerRewriteSession {
  const consumed = createPointerLoweringConsumption(plan);
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
      assertCompletePointerLoweringConsumption(plan, consumed);
      return pointerLoweringResult(plan, consumed, transformed);
    },
  });
}

function pointerLoweringResult(
  plan: PointerLoweringPlan,
  consumed: PointerLoweringConsumption,
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
    inferenceStabilizationCount: consumed.inferenceStabilizations.size,
    directObjectReplacementCount: consumed.directObjectReplacements.size,
    representationTransportInlineCount:
      consumed.representationTransportInlines.count,
    runtimeAlias: usesRuntime ? plan.runtimeAlias.text : undefined,
  });
}

function rewriteNode(
  source: TargetSourceProgram,
  plan: PointerLoweringPlan,
  consumed: PointerLoweringConsumption,
  finalNodes: FinalNodeLookup,
  original: Node,
  updated: Node,
  factory: NodeFactory,
): Node | undefined {
  if (plan.removableMarkerDeclarations.has(original)) {
    consumed.removableMarkerDeclarations.add(original);
    return undefined;
  }

  if (consumed.representationTransportInlines.has(original)) {
    return consumed.representationTransportInlines.rewrite(
      original,
      updated,
      factory,
    );
  }

  const pointerKeyMapRewrite = plan.flowPlan?.pointerKeyMapRewriteFor(original);
  if (pointerKeyMapRewrite !== undefined) {
    return rewriteCanonicalPointerKeyMapNode(
      factory,
      original,
      updated,
      pointerKeyMapRewrite,
      finalNodes,
      consumed.pointerKeyMaps,
    );
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
    const projectionFusion = plan.flowPlan?.projectionFusionFor(original);
    if (projectionFusion !== undefined) {
      return lowerPointerProjectionFusion(
        source,
        factory,
        projectionFusion,
        finalNodes,
      );
    }
    if (plan.flowPlan?.ownsFusedProjection(original) === true) {
      return updated;
    }
    const projectedPropertyLocation = plan.projectedPropertyLocations.get(
      original,
    );
    if (projectedPropertyLocation !== undefined) {
      return lowerProjectedPropertyLocation(
        source,
        factory,
        projectedPropertyLocation,
        updated,
        plan,
        finalNodes,
      );
    }
    if (plan.flowPlan?.ownsProjectedPropertyAddress(original) === true) {
      return updated;
    }
    const optimized = lowerOptimizedPointerOperation(
      source,
      factory,
      operation,
      updated,
      pointerFlowRepresentation(plan, original),
      plan.directObjectReplacements.get(original),
      plan.runtimeAlias,
      plan.referenceHashes.get(original),
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

  const stabilization = plan.inferenceStabilizations.get(original);
  if (stabilization !== undefined) {
    consumed.inferenceStabilizations.add(original);
    return applyPointerInferenceStabilization(
      factory,
      original,
      updated,
      stabilization,
      finalNodes,
    );
  }

  let structuralResult = updated;
  const directObjectReplacement = plan.directObjectReplacements.get(original);
  if (
    directObjectReplacement !== undefined &&
    directObjectReplacement.classDeclaration === original
  ) {
    consumed.directObjectReplacements.add(original);
    structuralResult = appendDirectObjectReplacementMethod(
      factory,
      structuralResult,
      directObjectReplacement,
    );
  }
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
    const withRuntimeNode = pointerLoweringPlanUsesRuntime(plan)
      ? prependRuntimeImport(
          factory,
          sourceFile,
          plan.runtimeAlias,
          plan.usesRuntimeValue,
        )
      : sourceFile;
    const withRuntime = AsSourceFile(withRuntimeNode);
    if (withRuntime === undefined) {
      throw new PointerLoweringError(
        "pointer lowering lost its source-file receiver",
      );
    }
    const withPointerMapStorage = insertCanonicalPointerKeyMapStorage(
      factory,
      withRuntime,
      plan.flowPlan?.pointerKeyMapsFor(plan.sourceFile) ?? [],
      consumed.pointerKeyMaps,
    );
    if (plan.projectedPropertyLocationClassName === undefined) {
      return withPointerMapStorage;
    }
    if (consumed.projectedPropertyLocationClassInserted) {
      throw new PointerLoweringError(
        "projected-property class was inserted twice",
      );
    }
    consumed.projectedPropertyLocationClassInserted = true;
    return insertProjectedPropertyLocationClass(
      factory,
      withPointerMapStorage,
      plan.projectedPropertyLocationClassName,
    );
  }
  return structuralResult;
}
