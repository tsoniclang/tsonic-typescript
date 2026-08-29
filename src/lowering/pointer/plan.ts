import {
  pointerFactKey,
  pointerOperationFactKey,
  rawPointerFactKey,
  rawPointerOperationFactKey,
} from "@tsonic/tsts";
import type {
  Node,
  PointerOperationFact,
  RawPointerOperationFact,
  SourceFile,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../program-index.js";
import type {
  GeneratedBindingName,
  SourceFileGeneratedNames,
} from "../generated-names.js";
import type { DirectObjectReplacement } from "./direct-object-replacement.js";
import { PointerLoweringError } from "./diagnostic.js";
import { validatePointerOperationFact } from "./operation-contract.js";
import type {
  ClosedPointerFlowPlan,
} from "./flow-plan.js";
import {
  planPointerInferenceStabilizations,
  type PointerInferenceStabilization,
} from "./inference-stabilization.js";
import {
  pointerOperationIsFused,
  pointerOperationUsesRuntimeValue,
} from "./flow-application.js";
import { planPointerMarkerUsage } from "./marker-usage.js";
import {
  planLocationBindings,
  type LocalLocationBinding,
  type LocationBinding,
} from "./location-binding-plan.js";
import { pointerTypeCanBeUndefined } from "./nullability.js";
import type { PointerProjectionCallablePlan } from "./projection-callable-plan.js";
import type { ProjectedPropertyLocationFusion } from "./projected-property.js";
import {
  planStaticPropertyLocations,
  type StaticPropertyLocationClassPlan,
} from "./property-location/plan.js";
import { validatePointerFact } from "./type-contract.js";

export type {
  LocalLocationBinding,
  LocationBinding,
  ParameterLocationBinding,
} from "./location-binding-plan.js";

export interface ReferenceHashPlan {
  readonly nullable: boolean;
  readonly parameterName?: GeneratedBindingName;
}

export interface PointerLoweringPlan {
  readonly sourceFile: SourceFile;
  readonly operations: ReadonlyMap<Node, PointerOperationFact>;
  readonly pointerTypes: ReadonlySet<Node>;
  readonly rawPointerOperations: ReadonlyMap<Node, RawPointerOperationFact>;
  readonly rawPointerTypes: ReadonlySet<Node>;
  readonly localBindings: ReadonlyMap<Node, LocalLocationBinding>;
  readonly localBindingsByStatement: ReadonlyMap<
    Node,
    readonly LocalLocationBinding[]
  >;
  readonly prologueBindingsByBody: ReadonlyMap<
    Node,
    readonly LocationBinding[]
  >;
  readonly addressBindings: ReadonlyMap<Node, LocationBinding>;
  readonly removableMarkerDeclarations: ReadonlySet<Node>;
  readonly flowPlan: ClosedPointerFlowPlan | undefined;
  readonly projectionCallables: PointerProjectionCallablePlan;
  readonly runtimeAlias: GeneratedBindingName;
  readonly referenceHashes: ReadonlyMap<Node, ReferenceHashPlan>;
  readonly inferenceStabilizations: ReadonlyMap<
    Node,
    PointerInferenceStabilization
  >;
  readonly directObjectReplacements: ReadonlyMap<Node, DirectObjectReplacement>;
  readonly projectedPropertyLocations: ReadonlyMap<
    Node,
    ProjectedPropertyLocationFusion
  >;
  readonly projectedPropertyLocationClassName: GeneratedBindingName | undefined;
  readonly staticPropertyLocations: ReadonlyMap<
    Node,
    StaticPropertyLocationClassPlan
  >;
  readonly staticPropertyLocationClasses: readonly StaticPropertyLocationClassPlan[];
  readonly usesRuntimeValue: boolean;
}

export function createPointerLoweringPlan(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  program: TargetProgramIndex,
  generatedNames: SourceFileGeneratedNames,
  flowPlan: ClosedPointerFlowPlan | undefined,
  projectionCallables: PointerProjectionCallablePlan,
): PointerLoweringPlan {
  if (generatedNames.sourceFile !== sourceFile) {
    throw new PointerLoweringError(
      "pointer planning received generated names for another source file",
    );
  }
  if (flowPlan !== undefined && !flowPlan.owns(source)) {
    throw new PointerLoweringError(
      "pointer flow plan belongs to a different checked source program",
    );
  }
  if (!projectionCallables.owns(source)) {
    throw new PointerLoweringError(
      "pointer projection-callable plan belongs to a different checked source program",
    );
  }
  const nodes = program.nodesFor(sourceFile);
  const operations = new Map<Node, PointerOperationFact>();
  const pointerTypes = new Set<Node>();
  const rawPointerOperations = new Map<Node, RawPointerOperationFact>();
  const rawPointerTypes = new Set<Node>();
  const selectedMarkerRoots: Node[] = [];
  const directObjectReplacements = new Map<Node, DirectObjectReplacement>();
  const projectedPropertyLocations = new Map<
    Node,
    ProjectedPropertyLocationFusion
  >();
  let usesRuntimeValue = false;

  for (const node of nodes) {
    const directObjectReplacement = flowPlan?.directObjectReplacementFor(node);
    if (directObjectReplacement !== undefined) {
      if (
        directObjectReplacement.classDeclaration !== node &&
        !directObjectReplacement.storeCalls.includes(node)
      ) {
        throw new PointerLoweringError(
          "direct-object replacement is attached outside its exact class or store",
        );
      }
      directObjectReplacements.set(node, directObjectReplacement);
    }
    const operation = source.sourceFacts.getFact(node, pointerOperationFactKey);
    if (operation !== undefined) {
      if (operation.call !== node || operations.has(node)) {
        throw new PointerLoweringError(
          "pointer operation fact is not uniquely attached to its exact call",
        );
      }
      validatePointerOperationFact(source, operation);
      operations.set(node, operation);
      const projectedPropertyLocation = flowPlan?.projectedPropertyLocationFor(
        node,
      );
      if (projectedPropertyLocation !== undefined) {
        if (projectedPropertyLocation.projection !== operation) {
          throw new PointerLoweringError(
            "projected-property fusion disagrees with its exact operation fact",
          );
        }
        projectedPropertyLocations.set(node, projectedPropertyLocation);
      }
      if (!pointerOperationIsFused(flowPlan, node)) {
        usesRuntimeValue ||= pointerOperationUsesRuntimeValue(
          operation,
          flowPlan,
        );
      }
      selectedMarkerRoots.push(requireCallTarget(source, node));
    }
    const rawPointerOperation = source.sourceFacts.getFact(
      node,
      rawPointerOperationFactKey,
    );
    if (rawPointerOperation !== undefined) {
      if (
        rawPointerOperation.call !== node ||
        rawPointerOperations.has(node) ||
        operation !== undefined
      ) {
        throw new PointerLoweringError(
          "raw-pointer operation fact is not uniquely attached to its exact call",
        );
      }
      rawPointerOperations.set(node, rawPointerOperation);
      usesRuntimeValue = true;
      selectedMarkerRoots.push(requireCallTarget(source, node));
    }
    const pointerFact = source.sourceFacts.getFact(node, pointerFactKey);
    if (source.ast.is.IsTypeReferenceNode(node) && pointerFact !== undefined) {
      validatePointerFact(source, node, pointerFact);
      pointerTypes.add(node);
      const typeReference = source.ast.as.AsTypeReferenceNode(node);
      if (typeReference?.TypeName === undefined) {
        throw new PointerLoweringError(
          "pointer type fact has no exact type-name syntax",
        );
      }
      selectedMarkerRoots.push(typeReference.TypeName);
    }
    if (
      source.ast.is.IsTypeReferenceNode(node) &&
      source.sourceFacts.getFact(node, rawPointerFactKey) !== undefined
    ) {
      if (pointerTypes.has(node)) {
        throw new PointerLoweringError(
          "one type reference cannot be both a typed and raw pointer",
        );
      }
      rawPointerTypes.add(node);
      const typeReference = source.ast.as.AsTypeReferenceNode(node);
      if (typeReference?.TypeName === undefined) {
        throw new PointerLoweringError(
          "raw-pointer type fact has no exact type-name syntax",
        );
      }
      selectedMarkerRoots.push(typeReference.TypeName);
    }
  }
  const {
    localBindings,
    localBindingsByStatement,
    prologueBindingsByBody,
    addressBindings,
  } = planLocationBindings(
    source,
    sourceFile,
    operations,
    flowPlan,
    generatedNames,
  );
  const markerUsage = planPointerMarkerUsage(
    source,
    nodes,
    selectedMarkerRoots,
  );
  const projectedPropertyLocationClassName =
    projectedPropertyLocations.size === 0
      ? undefined
      : generatedNames.reserve("$ProjectedPropertyLocation");
  const staticPropertyLocations = planStaticPropertyLocations(
    source,
    operations,
    addressBindings,
    flowPlan,
    generatedNames,
  );
  const runtimeAlias = generatedNames.reserve("tsonicTypeScriptRuntime");
  const referenceHashes = new Map<Node, ReferenceHashPlan>();
  for (const operation of operations.values()) {
    const representation = flowPlan?.representationFor(operation.call);
    if (
      operation.operation === "hash-pointer" &&
      (representation === "direct-object" || representation === "mutable-cell")
    ) {
      const nullable = pointerTypeCanBeUndefined(
        source,
        operation.pointerExpression,
        operation.pointerType,
      );
      referenceHashes.set(
        operation.call,
        Object.freeze({
          nullable,
          ...(nullable
            ? { parameterName: generatedNames.reserve("$pointer") }
            : {}),
        }),
      );
    }
  }
  const inferenceStabilizations = planPointerInferenceStabilizations(
    source,
    sourceFile,
    operations,
    flowPlan,
  );
  return Object.freeze({
    sourceFile,
    operations,
    pointerTypes,
    rawPointerOperations,
    rawPointerTypes,
    localBindings,
    localBindingsByStatement,
    prologueBindingsByBody,
    addressBindings,
    removableMarkerDeclarations: markerUsage.removableDeclarations,
    flowPlan,
    projectionCallables,
    runtimeAlias,
    referenceHashes,
    inferenceStabilizations,
    directObjectReplacements,
    projectedPropertyLocations,
    projectedPropertyLocationClassName,
    staticPropertyLocations: staticPropertyLocations.operations,
    staticPropertyLocationClasses: staticPropertyLocations.classes,
    usesRuntimeValue,
  });
}

function requireCallTarget(source: TargetSourceProgram, node: Node): Node {
  const call = source.ast.as.AsCallExpression(node);
  if (call === undefined || call.Expression === undefined) {
    throw new PointerLoweringError(
      "pointer operation fact is not attached to a call expression",
    );
  }
  return call.Expression;
}
