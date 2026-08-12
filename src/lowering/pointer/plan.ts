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
import type { TargetSourceProgram } from "@tsonic/target-api";

import type { TargetProgramIndex } from "../program-index.js";
import type { SourceFileGeneratedNames } from "../generated-names.js";
import { validateAddressableStorage } from "./addressability.js";
import { PointerLoweringError } from "./diagnostic.js";
import { validatePointerOperationFact } from "./operation-contract.js";
import type {
  ClosedPointerFlowPlan,
} from "./flow-plan.js";
import {
  pointerOperationIsFused,
  pointerOperationUsesRuntimeValue,
} from "./flow-application.js";
import { planPointerMarkerUsage } from "./marker-usage.js";
import { pointerTypeCanBeUndefined } from "./nullability.js";

export interface LocalLocationBinding {
  readonly kind: "variable";
  readonly declaration: Node;
  readonly addressOperands: ReadonlySet<Node>;
  readonly sourceName: string;
  readonly locationName: string;
  readonly writeName: string;
}

export interface ParameterLocationBinding {
  readonly kind: "parameter";
  readonly declaration: Node;
  readonly addressOperands: ReadonlySet<Node>;
  readonly body: Node;
  readonly sourceName: string;
  readonly locationName: string;
  readonly writeName: string;
}

export type LocationBinding = LocalLocationBinding | ParameterLocationBinding;

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
  readonly runtimeAlias: string;
  readonly nullableHashParameterName: string;
  readonly usesRuntimeValue: boolean;
}

interface MutableLocationBinding {
  readonly kind: "variable" | "parameter";
  readonly declaration: Node;
  readonly addressOperands: Set<Node>;
  readonly body?: Node;
  readonly sourceName?: string;
}

export function createPointerLoweringPlan(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  program: TargetProgramIndex,
  generatedNames: SourceFileGeneratedNames,
  flowPlan?: ClosedPointerFlowPlan,
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
  const nodes = program.nodesFor(sourceFile);
  const operations = new Map<Node, PointerOperationFact>();
  const pointerTypes = new Set<Node>();
  const rawPointerOperations = new Map<Node, RawPointerOperationFact>();
  const rawPointerTypes = new Set<Node>();
  const selectedMarkerRoots: Node[] = [];
  const bindingsByDeclaration = new Map<Node, MutableLocationBinding>();
  let usesRuntimeValue = false;

  for (const node of nodes) {
    const operation = source.sourceFacts.getFact(node, pointerOperationFactKey);
    if (operation !== undefined) {
      if (operation.call !== node || operations.has(node)) {
        throw new PointerLoweringError(
          "pointer operation fact is not uniquely attached to its exact call",
        );
      }
      validatePointerOperationFact(source, operation);
      operations.set(node, operation);
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
    if (
      source.ast.is.IsTypeReferenceNode(node) &&
      source.sourceFacts.getFact(node, pointerFactKey) !== undefined
    ) {
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
  for (const operation of operations.values()) {
    if (
      operation.operation === "address-of" &&
      (flowPlan?.representationFor(operation.call) ?? "location") === "location"
    ) {
      validateAddressableStorage(source, operation.storageExpression);
      collectAddressBinding(source, sourceFile, operation, bindingsByDeclaration);
    }
  }

  const localBindings = new Map<Node, LocalLocationBinding>();
  const localBindingsByStatement = new Map<Node, LocalLocationBinding[]>();
  const prologueBindingsByBody = new Map<Node, LocationBinding[]>();
  const addressBindings = new Map<Node, LocationBinding>();
  const mutableBindings = [...bindingsByDeclaration.values()].sort(
    (left, right) => source.ast.pos(left.declaration) - source.ast.pos(right.declaration),
  );
  for (const binding of mutableBindings) {
    const sealed = sealLocationBinding(source, binding, generatedNames);
    if (sealed.kind === "variable") {
      localBindings.set(sealed.declaration, sealed);
      const declarationKind = source.ast.variableDeclarationKind(
        sealed.declaration,
      );
      if (declarationKind === "const") {
        throw new PointerLoweringError(
          "address-of cannot create writable storage for a const binding",
        );
      }
      if (declarationKind === "using" || declarationKind === "await using") {
        throw new PointerLoweringError(
          "address-of does not support resource-management bindings",
        );
      }
      if (declarationKind === "var") {
        const scope = requireVariableScope(source, sealed.declaration);
        appendBinding(prologueBindingsByBody, scope, sealed);
      } else if (declarationKind === "let") {
        const declarationList = source.ast.parent(sealed.declaration);
        const owner = source.ast.parent(declarationList);
        if (owner !== undefined && source.ast.is.IsVariableStatement(owner)) {
          requireStatementListOwner(source, owner);
          appendBinding(localBindingsByStatement, owner, sealed);
        } else if (
          owner !== undefined &&
          (source.ast.is.IsForStatement(owner) ||
            source.ast.is.IsForInStatement(owner) ||
            source.ast.is.IsForOfStatement(owner))
        ) {
          throw new PointerLoweringError(
            "address-of does not support let bindings with per-iteration loop storage",
          );
        } else {
          throw new PointerLoweringError(
            "addressed let binding requires a standalone variable statement",
          );
        }
      } else {
        throw new PointerLoweringError(
          "addressed local has no exact variable declaration kind",
        );
      }
    } else {
      appendBinding(prologueBindingsByBody, sealed.body, sealed);
    }
    for (const operand of sealed.addressOperands) {
      addressBindings.set(operand, sealed);
    }
  }
  const markerUsage = planPointerMarkerUsage(
    source,
    nodes,
    selectedMarkerRoots,
  );
  const runtimeAlias = usesRuntimeValue
    ? generatedNames.reserve("tsonicTypeScriptRuntime")
    : "tsonicTypeScriptRuntime";
  const needsNullableHashParameter = [...operations.values()].some((operation) =>
    operation.operation === "hash-pointer" &&
    flowPlan?.representationFor(operation.call) === "direct-object" &&
    pointerTypeCanBeUndefined(
      source,
      operation.pointerExpression,
      operation.pointerType,
    )
  );
  const nullableHashParameterName = needsNullableHashParameter
    ? generatedNames.reserve("$pointer")
    : "$pointer";
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
    runtimeAlias,
    nullableHashParameterName,
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

function collectAddressBinding(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  operation: Extract<PointerOperationFact, { readonly operation: "address-of" }>,
  bindings: Map<Node, MutableLocationBinding>,
): void {
  const root = valueStorageRoot(source, operation.storageExpression);
  if (root === undefined) {
    return;
  }
  const reference = source.navigation.sourceReferenceFor(root);
  if (
    reference !== undefined &&
    source.ast.getSourceFile(reference.declaration) !== sourceFile
  ) {
    return;
  }
  if (
    reference === undefined ||
    !source.ast.is.IsVariableDeclaration(reference.declaration) &&
    !source.ast.is.IsParameterDeclaration(reference.declaration)
  ) {
    throw new PointerLoweringError(
      "address-of value-field root lacks an exact variable or parameter declaration",
    );
  }
  if (
    root === operation.storageExpression &&
    operation.storageDeclaration !== reference.declaration
  ) {
    throw new PointerLoweringError(
      "address-of identifier fact disagrees with its exact source reference",
    );
  }
  if (
    root !== operation.storageExpression &&
    isImmutableVariable(source, reference.declaration)
  ) {
    return;
  }
  const declarationName = source.ast.name(reference.declaration);
  if (!source.ast.is.IsIdentifier(declarationName)) {
    throw new PointerLoweringError(
      "address-of local currently requires one identifier declaration",
    );
  }
  const isParameter = source.ast.is.IsParameterDeclaration(
    reference.declaration,
  );
  const body = isParameter
    ? source.ast.body(source.ast.parent(reference.declaration))
    : undefined;
  if (isParameter && body === undefined) {
    throw new PointerLoweringError(
      "addressed parameter requires an exact function body",
    );
  }
  const existing = bindings.get(reference.declaration);
  if (existing === undefined) {
    bindings.set(reference.declaration, {
      kind: isParameter ? "parameter" : "variable",
      declaration: reference.declaration,
      addressOperands: new Set([root]),
      ...(body === undefined ? {} : { body }),
      sourceName: source.ast.text(declarationName),
    });
  } else {
    existing.addressOperands.add(root);
  }
}

function isImmutableVariable(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  if (!source.ast.is.IsVariableDeclaration(declaration)) {
    return false;
  }
  return source.ast.variableDeclarationKind(declaration) === "const";
}

function valueStorageRoot(
  source: TargetSourceProgram,
  storage: Node,
): Node | undefined {
  if (source.ast.is.IsIdentifier(storage)) {
    return storage;
  }
  if (source.ast.is.IsPropertyAccessExpression(storage)) {
    const property = source.ast.as.AsPropertyAccessExpression(storage);
    return property?.Expression === undefined
      ? undefined
      : valueStorageRoot(source, property.Expression);
  }
  if (!source.ast.is.IsElementAccessExpression(storage)) {
    return undefined;
  }
  const element = source.ast.as.AsElementAccessExpression(storage);
  return element?.Expression === undefined
    ? undefined
    : valueStorageRoot(source, element.Expression);
}

function sealLocationBinding(
  source: TargetSourceProgram,
  binding: MutableLocationBinding,
  generatedNames: SourceFileGeneratedNames,
): LocationBinding {
  if (binding.kind === "variable") {
    if (binding.sourceName === undefined) {
      throw new PointerLoweringError(
        "addressed local binding has no exact source name",
      );
    }
    return Object.freeze({
      kind: "variable",
      declaration: binding.declaration,
      addressOperands: binding.addressOperands,
      sourceName: binding.sourceName,
      locationName: generatedNames.reserve(`${binding.sourceName}$location`),
      writeName: generatedNames.reserve(`${binding.sourceName}$next`),
    });
  }
  if (binding.body === undefined || binding.sourceName === undefined) {
    throw new PointerLoweringError(
      "addressed parameter binding is incomplete",
    );
  }
  for (const operand of binding.addressOperands) {
    if (!isNodeWithin(source, operand, binding.body)) {
      throw new PointerLoweringError(
        "address-of parameter outside its function body is unsupported",
      );
    }
  }
  return Object.freeze({
    kind: "parameter",
    declaration: binding.declaration,
    addressOperands: binding.addressOperands,
    body: binding.body,
    sourceName: binding.sourceName,
    locationName: generatedNames.reserve(`${binding.sourceName}$location`),
    writeName: generatedNames.reserve(`${binding.sourceName}$next`),
  });
}

function isNodeWithin(
  source: TargetSourceProgram,
  node: Node,
  ancestor: Node,
): boolean {
  for (let current: Node | undefined = node; current !== undefined;) {
    if (current === ancestor) {
      return true;
    }
    current = source.ast.parent(current);
  }
  return false;
}

function appendBinding<T extends LocationBinding>(
  bindings: Map<Node, T[]>,
  owner: Node,
  binding: T,
): void {
  const existing = bindings.get(owner) ?? [];
  existing.push(binding);
  bindings.set(owner, existing);
}

function requireVariableScope(
  source: TargetSourceProgram,
  declaration: Node,
): Node {
  for (
    let current = source.ast.parent(declaration);
    current !== undefined;
    current = source.ast.parent(current)
  ) {
    if (
      source.ast.is.IsSourceFile(current) ||
      source.ast.is.IsModuleBlock(current)
    ) {
      return current;
    }
    if (!source.ast.is.IsBlock(current)) {
      continue;
    }
    const parent = source.ast.parent(current);
    if (
      parent !== undefined &&
      (isFunctionLike(source, parent) ||
        source.ast.is.IsClassStaticBlockDeclaration(parent)) &&
      source.ast.body(parent) === current
    ) {
      return current;
    }
  }
  throw new PointerLoweringError(
    "addressed var binding has no exact variable scope",
  );
}

function isFunctionLike(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  return source.ast.is.IsFunctionDeclaration(node) ||
    source.ast.is.IsFunctionExpression(node) ||
    source.ast.is.IsArrowFunction(node) ||
    source.ast.is.IsMethodDeclaration(node) ||
    source.ast.is.IsConstructorDeclaration(node) ||
    source.ast.is.IsGetAccessorDeclaration(node) ||
    source.ast.is.IsSetAccessorDeclaration(node);
}

function requireStatementListOwner(
  source: TargetSourceProgram,
  statement: Node,
): void {
  const owner = source.ast.parent(statement);
  if (
    owner !== undefined &&
    (source.ast.is.IsSourceFile(owner) ||
      source.ast.is.IsBlock(owner) ||
      source.ast.is.IsModuleBlock(owner) ||
      source.ast.is.IsCaseClause(owner) ||
      source.ast.is.IsDefaultClause(owner))
  ) {
    return;
  }
  throw new PointerLoweringError(
    "addressed let binding requires a statement-list owner",
  );
}
