import type {
  Node,
  PointerOperationFact,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import { PointerLoweringError } from "./diagnostic.js";
import type {
  PointerFlowGraph,
  PointerFlowVertex,
} from "./flow-graph.js";
import type { PointerReferenceCensus } from "./flow-references.js";
import type { PointerPlanningLedger } from "./planning-ledger.js";

export function resolvePointerExpression(
  source: TargetSourceProgram,
  references: PointerReferenceCensus,
  graph: PointerFlowGraph,
  operations: ReadonlyMap<Node, PointerOperationFact>,
  expression: Node | undefined,
): PointerFlowVertex | undefined {
  const reference = transparentReference(source, expression);
  if (reference !== undefined) {
    const declaration = references.referenceFor(reference)?.declaration;
    return blockTypeBearingWrapper(
      source,
      graph,
      expression,
      graph.get(declaration),
    );
  }
  const root = transparentExpression(source, expression);
  const operation = root === undefined ? undefined : operations.get(root);
  const vertex = root === undefined ||
      operation !== undefined && !producesPointer(operation)
    ? undefined
    : graph.get(root);
  return blockTypeBearingWrapper(source, graph, expression, vertex);
}

export function resolveRequiredPointerExpression(
  source: TargetSourceProgram,
  references: PointerReferenceCensus,
  graph: PointerFlowGraph,
  operations: ReadonlyMap<Node, PointerOperationFact>,
  expression: Node | undefined,
): PointerFlowVertex | undefined {
  const vertex = resolvePointerExpression(
    source,
    references,
    graph,
    operations,
    expression,
  );
  if (vertex !== undefined) {
    return vertex;
  }
  const reference = transparentReference(source, expression);
  const expected = reference === undefined
    ? undefined
    : source.navigation.sourceReferenceFor(reference);
  if (
    reference !== undefined &&
    expected !== undefined &&
    references.tracks(expected.declaration) &&
    references.referenceFor(reference) === undefined
  ) {
    const occurrence = source.documents.occurrenceFor(reference);
    const identity = occurrence.kind === "authored"
      ? `${occurrence.document.identity}:${occurrence.start}-${occurrence.end}/${occurrence.syntaxKind}`
      : `synthetic/${occurrence.syntaxKind}`;
    throw new PointerLoweringError(
      `pointer operand ${identity} lost its exact source reference`,
    );
  }
  return undefined;
}

function blockTypeBearingWrapper(
  source: TargetSourceProgram,
  graph: PointerFlowGraph,
  expression: Node | undefined,
  vertex: PointerFlowVertex | undefined,
): PointerFlowVertex | undefined {
  let current = expression;
  while (current !== undefined) {
    if (source.ast.is.IsParenthesizedExpression(current)) {
      current = source.ast.as.AsParenthesizedExpression(current)?.Expression;
      continue;
    }
    if (source.ast.is.IsAsExpression(current)) {
      graph.block(vertex, "unsupported-flow", current);
      current = source.ast.as.AsAsExpression(current)?.Expression;
      continue;
    }
    if (source.ast.is.IsTypeAssertion(current)) {
      graph.block(vertex, "unsupported-flow", current);
      current = source.ast.as.AsTypeAssertion(current)?.Expression;
      continue;
    }
    if (source.ast.is.IsSatisfiesExpression(current)) {
      graph.block(vertex, "unsupported-flow", current);
      current = source.ast.as.AsSatisfiesExpression(current)?.Expression;
      continue;
    }
    if (source.ast.is.IsNonNullExpression(current)) {
      current = source.ast.as.AsNonNullExpression(current)?.Expression;
      continue;
    }
    if (
      source.ast.is.IsBinaryExpression(current) &&
      isNeverFallback(source, current)
    ) {
      current = source.ast.as.AsBinaryExpression(current)?.Left;
      continue;
    }
    break;
  }
  return vertex;
}

export function addTransparentReference(
  source: TargetSourceProgram,
  expression: Node | undefined,
  target: Set<Node>,
): void {
  const reference = transparentReference(source, expression);
  if (reference !== undefined) {
    target.add(reference);
  }
}

export function addTransparentProducer(
  source: TargetSourceProgram,
  expression: Node | undefined,
  operations: ReadonlyMap<Node, PointerOperationFact>,
  target: Set<Node>,
  additional?: ReadonlySet<Node>,
): void {
  const root = transparentExpression(source, expression);
  const operation = root === undefined ? undefined : operations.get(root);
  if (
    root !== undefined &&
    (operation !== undefined && producesPointer(operation) ||
      additional?.has(root) === true)
  ) {
    target.add(root);
  }
}

export function transparentReference(
  source: TargetSourceProgram,
  expression: Node | undefined,
): Node | undefined {
  const root = transparentExpression(source, expression);
  return root !== undefined && source.ast.is.IsIdentifier(root)
    ? root
    : undefined;
}

export function transparentExpression(
  source: TargetSourceProgram,
  expression: Node | undefined,
): Node | undefined {
  let current = expression;
  for (;;) {
    if (current === undefined) {
      return undefined;
    }
    if (source.ast.is.IsParenthesizedExpression(current)) {
      current = source.ast.as.AsParenthesizedExpression(current)?.Expression;
      continue;
    }
    if (source.ast.is.IsAsExpression(current)) {
      current = source.ast.as.AsAsExpression(current)?.Expression;
      continue;
    }
    if (source.ast.is.IsTypeAssertion(current)) {
      current = source.ast.as.AsTypeAssertion(current)?.Expression;
      continue;
    }
    if (source.ast.is.IsNonNullExpression(current)) {
      current = source.ast.as.AsNonNullExpression(current)?.Expression;
      continue;
    }
    if (source.ast.is.IsSatisfiesExpression(current)) {
      current = source.ast.as.AsSatisfiesExpression(current)?.Expression;
      continue;
    }
    if (
      source.ast.is.IsBinaryExpression(current) &&
      isNeverFallback(source, current)
    ) {
      current = source.ast.as.AsBinaryExpression(current)?.Left;
      continue;
    }
    return current;
  }
}

function isNeverFallback(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  if (
    source.ast.operatorKindName(node) !== "KindQuestionQuestionToken"
  ) {
    return false;
  }
  const fallback = source.ast.as.AsBinaryExpression(node)?.Right;
  const fallbackType = fallback === undefined
    ? undefined
    : source.semantics.forNode(fallback).types.expressionType(fallback);
  return fallback !== undefined &&
    fallbackType !== undefined &&
    source.semantics.forNode(fallback).types.isNever(fallbackType);
}

export function transparentExpressionRoot(
  source: TargetSourceProgram,
  expression: Node,
): Node {
  let current = expression;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined || transparentExpression(source, parent) !== current) {
      return current;
    }
    current = parent;
  }
}

export function isOptimizableFunctionDeclaration(
  source: TargetSourceProgram,
  owner: Node,
  planning?: PointerPlanningLedger,
): boolean {
  const functionDeclaration = source.ast.is.IsFunctionDeclaration(owner)
    ? source.ast.as.AsFunctionDeclaration(owner)
    : undefined;
  const staticMethod = source.ast.is.IsMethodDeclaration(owner) &&
      source.ast.hasModifierKind(owner, "static")
    ? source.ast.as.AsMethodDeclaration(owner)
    : undefined;
  if (
    (functionDeclaration === undefined && staticMethod === undefined) ||
    source.ast.body(owner) === undefined
  ) {
    return false;
  }
  const declaration = functionDeclaration ?? staticMethod;
  if (declaration?.AsteriskToken !== undefined) {
    return false;
  }
  for (const parameter of source.ast.parameters(owner)) {
    planning?.record("flow-census");
    const parsed = source.ast.as.AsParameterDeclaration(parameter);
    if (
      parsed?.DotDotDotToken !== undefined ||
      parsed?.QuestionToken !== undefined ||
      parsed?.Initializer !== undefined
    ) {
      return false;
    }
  }
  return true;
}

export function isModuleAliasReference(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  let current = source.ast.parent(node);
  for (let depth = 0; current !== undefined && depth < 3; depth += 1) {
    if (
      source.ast.is.IsImportClause(current) ||
      source.ast.is.IsImportSpecifier(current) ||
      source.ast.is.IsNamespaceImport(current) ||
      source.ast.is.IsExportSpecifier(current)
    ) {
      return true;
    }
    current = source.ast.parent(current);
  }
  return false;
}

export function enclosingFunction(
  source: TargetSourceProgram,
  node: Node,
): Node | undefined {
  let current = source.ast.parent(node);
  while (current !== undefined) {
    if (
      source.ast.is.IsFunctionDeclaration(current) ||
      source.ast.is.IsFunctionExpression(current) ||
      source.ast.is.IsArrowFunction(current) ||
      source.ast.is.IsMethodDeclaration(current) ||
      source.ast.is.IsConstructorDeclaration(current) ||
      source.ast.is.IsGetAccessorDeclaration(current) ||
      source.ast.is.IsSetAccessorDeclaration(current)
    ) {
      return current;
    }
    current = source.ast.parent(current);
  }
  return undefined;
}

export function producesPointer(operation: PointerOperationFact): boolean {
  return operation.operation === "address-of" ||
    operation.operation === "allocate" ||
    operation.operation === "bind-pointer" ||
    operation.operation === "project-pointer";
}
