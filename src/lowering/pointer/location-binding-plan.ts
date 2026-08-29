import type { Node, PointerOperationFact, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type {
  GeneratedBindingName,
  SourceFileGeneratedNames,
} from "../generated-names.js";
import { validateAddressableStorage } from "./addressability.js";
import { PointerLoweringError } from "./diagnostic.js";
import type { ClosedPointerFlowPlan } from "./flow-plan.js";

export interface LocalLocationBinding {
  readonly kind: "variable";
  readonly declaration: Node;
  readonly addressOperands: ReadonlySet<Node>;
  readonly sourceName: string;
  readonly locationName: GeneratedBindingName;
  readonly writeName: GeneratedBindingName;
}

export interface ParameterLocationBinding {
  readonly kind: "parameter";
  readonly declaration: Node;
  readonly addressOperands: ReadonlySet<Node>;
  readonly body: Node;
  readonly sourceName: string;
  readonly locationName: GeneratedBindingName;
  readonly writeName: GeneratedBindingName;
}

export type LocationBinding = LocalLocationBinding | ParameterLocationBinding;

export interface LocationBindingPlan {
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
}

interface MutableLocationBinding {
  readonly kind: "variable" | "parameter";
  readonly declaration: Node;
  readonly addressOperands: Set<Node>;
  readonly body?: Node;
  readonly sourceName?: string;
}

export function planLocationBindings(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  operations: ReadonlyMap<Node, PointerOperationFact>,
  flowPlan: ClosedPointerFlowPlan | undefined,
  generatedNames: SourceFileGeneratedNames,
): LocationBindingPlan {
  const bindingsByDeclaration = new Map<Node, MutableLocationBinding>();
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
    (left, right) =>
      source.ast.pos(left.declaration) - source.ast.pos(right.declaration),
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
        appendBinding(
          prologueBindingsByBody,
          requireVariableScope(source, sealed.declaration),
          sealed,
        );
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
  return Object.freeze({
    localBindings,
    localBindingsByStatement,
    prologueBindingsByBody,
    addressBindings,
  });
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
  return source.ast.is.IsVariableDeclaration(declaration) &&
    source.ast.variableDeclarationKind(declaration) === "const";
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
