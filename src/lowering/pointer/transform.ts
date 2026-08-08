import type {
  Node,
  PointerOperationFact,
  SourceFile,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  AsCallExpression,
  AsImportClause,
  AsImportDeclaration,
  AsNamedImports,
  AsPropertyAccessExpression,
  AsShorthandPropertyAssignment,
  AsSourceFile,
  AsTypeReferenceNode,
  AsVariableDeclaration,
  KindEqualsToken,
  IsCallExpression,
  IsImportClause,
  IsImportDeclaration,
  IsNamedImports,
  IsPropertyAccessExpression,
  IsShorthandPropertyAssignment,
  IsSourceFile,
  IsTypeReferenceNode,
  IsVariableDeclaration,
  NewBinaryExpression,
  NewPropertyAssignment,
  NewToken,
  NewVoidExpression,
  NodeFactory_UpdateVariableDeclaration,
  transformTargetSourceFile,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import { lowerAddressOf } from "./address.js";
import { PointerLoweringError } from "./diagnostic.js";
import { locationBindingExpression } from "./location-binding.js";
import {
  createPointerLoweringPlan,
  type LocalLocationBinding,
  type PointerLoweringPlan,
} from "./plan.js";
import { prependParameterLocations } from "./parameter-location.js";
import { lowerRawPointerOperation, lowerRawPointerType } from "./raw.js";
import {
  locationValue,
  prependRuntimeImport,
  runtimeCall,
  runtimeType,
} from "./runtime-ast.js";

export interface PointerLoweringResult {
  readonly sourceFile: SourceFile;
  readonly operationCount: number;
  readonly pointerTypeCount: number;
  readonly rawPointerOperationCount: number;
  readonly rawPointerTypeCount: number;
  readonly promotedBindingCount: number;
  readonly runtimeAlias: string | undefined;
}

export function lowerPointers(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
): PointerLoweringResult {
  const plan = createPointerLoweringPlan(source, sourceFile);
  if (
    plan.operations.size === 0 &&
    plan.pointerTypes.size === 0 &&
    plan.rawPointerOperations.size === 0 &&
    plan.rawPointerTypes.size === 0
  ) {
    return Object.freeze({
      sourceFile,
      operationCount: 0,
      pointerTypeCount: 0,
      rawPointerOperationCount: 0,
      rawPointerTypeCount: 0,
      promotedBindingCount: 0,
      runtimeAlias: undefined,
    });
  }
  const consumed = createConsumptionState();
  const transformed = transformTargetSourceFile(
    sourceFile,
    (original, updated, factory) => {
      const rewritten = rewriteNode(
        source,
        plan,
        consumed,
        original,
        updated,
        factory,
      );
      if (rewritten !== undefined) {
        consumed.updatedNodes.set(original, rewritten);
      }
      return rewritten;
    },
  );
  assertCompleteConsumption(plan, consumed);
  return Object.freeze({
    sourceFile: transformed,
    operationCount: consumed.operations.size,
    pointerTypeCount: consumed.pointerTypes.size,
    rawPointerOperationCount: consumed.rawPointerOperations.size,
    rawPointerTypeCount: consumed.rawPointerTypes.size,
    promotedBindingCount:
      consumed.localBindings.size + consumed.parameterBindings.size,
    runtimeAlias: plan.runtimeAlias,
  });
}

interface ConsumptionState {
  readonly operations: Set<Node>;
  readonly pointerTypes: Set<Node>;
  readonly rawPointerOperations: Set<Node>;
  readonly rawPointerTypes: Set<Node>;
  readonly localBindings: Set<Node>;
  readonly parameterBindings: Set<Node>;
  readonly promotedReferences: Set<Node>;
  readonly removableImports: Set<Node>;
  readonly updatedNodes: Map<Node, Node>;
}

function createConsumptionState(): ConsumptionState {
  return {
    operations: new Set(),
    pointerTypes: new Set(),
    rawPointerOperations: new Set(),
    rawPointerTypes: new Set(),
    localBindings: new Set(),
    parameterBindings: new Set(),
    promotedReferences: new Set(),
    removableImports: new Set(),
    updatedNodes: new Map(),
  };
}

function rewriteNode(
  source: TargetSourceProgram,
  plan: PointerLoweringPlan,
  consumed: ConsumptionState,
  original: Node,
  updated: Node,
  factory: NodeFactory,
): Node | undefined {
  if (plan.removableImports.has(original)) {
    consumed.removableImports.add(original);
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

  const binding = plan.localBindings.get(original);
  if (binding !== undefined) {
    consumed.localBindings.add(original);
    return promoteLocalBinding(factory, updated, binding, plan.runtimeAlias);
  }

  const promotedBinding = plan.promotedReferences.get(original);
  if (promotedBinding !== undefined) {
    const parent = source.ast.parent(original);
    if (parent !== undefined && source.ast.is.IsShorthandPropertyAssignment(parent)) {
      return updated;
    }
    consumed.promotedReferences.add(original);
    return locationValue(
      factory,
      locationBindingExpression(factory, promotedBinding, updated),
    );
  }

  const shorthand = IsShorthandPropertyAssignment(original)
    ? AsShorthandPropertyAssignment(original)
    : undefined;
  const shorthandBinding = shorthand?.name === undefined
    ? undefined
    : plan.promotedReferences.get(shorthand.name);
  if (shorthand !== undefined && shorthandBinding !== undefined) {
    const updatedShorthand = IsShorthandPropertyAssignment(updated)
      ? AsShorthandPropertyAssignment(updated)
      : undefined;
    if (
      updatedShorthand === undefined ||
      updatedShorthand.name === undefined ||
      updatedShorthand.ObjectAssignmentInitializer !== undefined
    ) {
      throw new PointerLoweringError(
        "promoted shorthand property has unsupported assignment syntax",
      );
    }
    consumed.promotedReferences.add(shorthand.name!);
    return NewPropertyAssignment(
      factory,
      updatedShorthand.modifiers,
      updatedShorthand.name,
      updatedShorthand.PostfixToken,
      updatedShorthand.Type,
      locationValue(
        factory,
        locationBindingExpression(
          factory,
          shorthandBinding,
          updatedShorthand.name,
        ),
      ),
    );
  }

  const operation = plan.operations.get(original);
  if (operation !== undefined) {
    consumed.operations.add(original);
    return lowerOperation(
      source,
      factory,
      operation,
      updated,
      plan,
      consumed.updatedNodes,
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
    return lowerPointerType(factory, updated, plan.runtimeAlias);
  }


  if (plan.rawPointerTypes.has(original)) {
    consumed.rawPointerTypes.add(original);
    return lowerRawPointerType(factory, updated, plan.runtimeAlias);
  }

  const parameterBindings = plan.parameterBindingsByBody.get(original);
  if (parameterBindings !== undefined) {
    for (const parameter of parameterBindings) {
      consumed.parameterBindings.add(parameter.declaration);
    }
    return prependParameterLocations(
      factory,
      updated,
      parameterBindings,
      plan.runtimeAlias,
    );
  }

  if (IsSourceFile(updated)) {
    const sourceFile = AsSourceFile(updated);
    if (sourceFile === undefined) {
      throw new PointerLoweringError(
        "source-file predicate did not yield a source-file receiver",
      );
    }
    return prependRuntimeImport(
      factory,
      sourceFile,
      plan.runtimeAlias,
      plan.usesRuntimeValue,
    );
  }
  return updated;
}

function promoteLocalBinding(
  factory: NodeFactory,
  updated: Node,
  _binding: LocalLocationBinding,
  runtimeAlias: string,
): Node {
  const declaration = IsVariableDeclaration(updated)
    ? AsVariableDeclaration(updated)
    : undefined;
  if (declaration === undefined || declaration.Initializer === undefined) {
    throw new PointerLoweringError(
      "addressed local must have an explicit variable initializer",
    );
  }
  const originalType = declaration.Type;
  const locationType = originalType === undefined
    ? undefined
    : runtimeType(factory, runtimeAlias, "Location", [originalType]);
  const initializer = runtimeCall(
    factory,
    runtimeAlias,
    "location",
    [],
    [declaration.Initializer],
  );
  return requiredNode(
    NodeFactory_UpdateVariableDeclaration(
      factory,
      declaration,
      declaration.name,
      declaration.ExclamationToken,
      locationType,
      initializer,
    ),
    "promoted variable declaration",
  );
}

function lowerPointerType(
  factory: NodeFactory,
  updated: Node,
  runtimeAlias: string,
): Node {
  const typeReference = IsTypeReferenceNode(updated)
    ? AsTypeReferenceNode(updated)
    : undefined;
  if (
    typeReference === undefined ||
    typeReference.TypeArguments === undefined ||
    typeReference.TypeArguments.Nodes.length !== 1
  ) {
    throw new PointerLoweringError(
      "Pointer<T> fact must own exactly one type argument",
    );
  }
  return runtimeType(
    factory,
    runtimeAlias,
    "Location",
    requireNodes(typeReference.TypeArguments.Nodes, "Pointer<T> type arguments"),
  );
}

function lowerOperation(
  source: TargetSourceProgram,
  factory: NodeFactory,
  operation: PointerOperationFact,
  updated: Node,
  plan: PointerLoweringPlan,
  updatedNodes: ReadonlyMap<Node, Node>,
): Node {
  const call = IsCallExpression(updated) ? AsCallExpression(updated) : undefined;
  if (call === undefined) {
    throw new PointerLoweringError(
      `${operation.operation} fact no longer owns a call expression`,
    );
  }
  const arguments_ = requireNodes(
    call.Arguments?.Nodes ?? [],
    `${operation.operation} arguments`,
  );
  switch (operation.operation) {
    case "allocate":
      requireArity(operation.operation, arguments_, 1);
      return runtimeCall(
        factory,
        plan.runtimeAlias,
        "location",
        requireNodes(
          call.TypeArguments?.Nodes ?? [],
          `${operation.operation} type arguments`,
        ),
        arguments_,
      );
    case "load":
      requireArity(operation.operation, arguments_, 1);
      return locationValue(factory, requiredElement(arguments_, 0));
    case "store": {
      requireArity(operation.operation, arguments_, 2);
      const assignment = NewBinaryExpression(
        factory,
        undefined,
        locationValue(factory, requiredElement(arguments_, 0)),
        undefined,
        NewToken(factory, KindEqualsToken),
        requiredElement(arguments_, 1),
      );
      return requiredNode(
        NewVoidExpression(factory, assignment),
        "pointer store expression",
      );
    }
    case "equal-pointer":
      requireArity(operation.operation, arguments_, 2);
      return runtimeCall(
        factory,
        plan.runtimeAlias,
        "sameLocation",
        [],
        arguments_,
      );
    case "hash-pointer":
      requireArity(operation.operation, arguments_, 1);
      return runtimeCall(
        factory,
        plan.runtimeAlias,
        "hashLocation",
        [],
        arguments_,
      );
    case "bind-pointer":
      requireArity(operation.operation, arguments_, 3);
      return runtimeCall(
        factory,
        plan.runtimeAlias,
        "boundLocation",
        requireNodes(
          call.TypeArguments?.Nodes ?? [],
          `${operation.operation} type arguments`,
        ),
        arguments_,
      );
    case "project-pointer":
      requireArity(operation.operation, arguments_, 3);
      return runtimeCall(
        factory,
        plan.runtimeAlias,
        "projectLocation",
        requireNodes(
          call.TypeArguments?.Nodes ?? [],
          `${operation.operation} type arguments`,
        ),
        arguments_,
      );
    case "address-of":
      requireArity(operation.operation, arguments_, 1);
      return lowerAddressOf(
        source,
        factory,
        operation,
        requiredElement(arguments_, 0),
        plan,
        updatedNodes,
      );
  }
}

function requiredElement(
  values: readonly Node[],
  index: number,
): Node {
  const value = values[index];
  if (value === undefined) {
    throw new PointerLoweringError(
      `pointer operation lost argument ${index}`,
    );
  }
  return value;
}

function requireNodes(
  values: readonly (Node | undefined)[],
  subject: string,
): readonly Node[] {
  const result: Node[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) {
      throw new PointerLoweringError(
        `${subject} contains an absent node at index ${index}`,
      );
    }
    result.push(value);
  }
  return result;
}

function requireArity(
  operation: PointerOperationFact["operation"],
  values: readonly Node[],
  expected: number,
): void {
  if (values.length !== expected) {
    throw new PointerLoweringError(
      `${operation} requires ${expected} exact arguments, got ${values.length}`,
    );
  }
}

function requiredNode(node: Node | undefined, subject: string): Node {
  if (node === undefined) {
    throw new PointerLoweringError(`${subject} was not created`);
  }
  return node;
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
  assertCount("promoted bindings", consumed.localBindings, plan.localBindings.size);
  assertCount(
    "promoted parameters",
    consumed.parameterBindings,
    [...plan.parameterBindingsByBody.values()].reduce(
      (count, bindings) => count + bindings.length,
      0,
    ),
  );
  assertCount(
    "promoted references",
    consumed.promotedReferences,
    plan.promotedReferences.size,
  );
  assertCount(
    "marker imports",
    consumed.removableImports,
    plan.removableImports.size,
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
