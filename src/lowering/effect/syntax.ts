import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import type { TargetProgramIndex } from "../program-index.js";

export function exactReturnedCall(
  source: TargetSourceProgram,
  expression: Node,
): Node | undefined {
  const awaited = source.ast.is.IsAwaitExpression(expression)
    ? source.ast.as.AsAwaitExpression(expression)?.Expression
    : expression;
  return exactCallExpression(source, awaited);
}

export function exactCallExpression(
  source: TargetSourceProgram,
  expression: Node | undefined,
): Node | undefined {
  const current = transparentExpression(source, expression);
  return current !== undefined && source.ast.is.IsCallExpression(current)
    ? current
    : undefined;
}

export function isFunctionLike(
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

export function callableDispatchIsClosed(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  declaration: Node,
): boolean {
  if (!source.ast.is.IsMethodDeclaration(declaration)) {
    return true;
  }
  if (source.ast.hasModifierKind(declaration, "static")) {
    return true;
  }
  const dispatch = program.memberDispatch(declaration);
  return dispatch !== undefined &&
    !dispatch.overridesBase &&
    !dispatch.hasDerivedOverride;
}

export function containingAwait(
  source: TargetSourceProgram,
  call: Node,
): Node | undefined {
  let current = call;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return undefined;
    }
    if (source.ast.is.IsAwaitExpression(parent)) {
      return exactCallExpression(
          source,
          source.ast.as.AsAwaitExpression(parent)?.Expression,
        ) === call
        ? parent
        : undefined;
    }
    if (!isTransparentExpression(source, parent, current)) {
      return undefined;
    }
    current = parent;
  }
}

export function containingReturn(
  source: TargetSourceProgram,
  call: Node,
): Node | undefined {
  let current = call;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return undefined;
    }
    if (source.ast.is.IsReturnStatement(parent)) {
      return parent;
    }
    if (
      source.ast.is.IsAwaitExpression(parent) ||
      isTransparentExpression(source, parent, current)
    ) {
      current = parent;
      continue;
    }
    return undefined;
  }
}

export function isDiscardedCall(
  source: TargetSourceProgram,
  call: Node,
): boolean {
  let current = call;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return false;
    }
    if (source.ast.is.IsExpressionStatement(parent)) {
      return true;
    }
    if (!isTransparentExpression(source, parent, current)) {
      return false;
    }
    current = parent;
  }
}

export function directContainingCall(
  source: TargetSourceProgram,
  reference: Node,
): Node | undefined {
  let current = reference;
  while (true) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return undefined;
    }
    if (source.ast.is.IsCallExpression(parent)) {
      return source.ast.as.AsCallExpression(parent)?.Expression === current
        ? parent
        : undefined;
    }
    if (isNeverFallback(source, parent, current)) {
      current = parent;
      continue;
    }
    if (
      source.ast.is.IsPropertyAccessExpression(parent) ||
      source.ast.is.IsElementAccessExpression(parent) ||
      isTransparentExpression(source, parent, current)
    ) {
      current = parent;
      continue;
    }
    return undefined;
  }
}

export function exactCallableTarget(
  source: TargetSourceProgram,
  expression: Node | undefined,
): Node | undefined {
  let current = transparentExpression(source, expression);
  for (;;) {
    if (current === undefined) {
      return undefined;
    }
    const left = source.ast.is.IsBinaryExpression(current)
      ? source.ast.as.AsBinaryExpression(current)?.Left
      : undefined;
    if (left !== undefined && isNeverFallback(source, current, left)) {
      current = transparentExpression(source, left);
      continue;
    }
    return current;
  }
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
    const child = transparentExpressionChild(source, current);
    if (child === false) {
      return current;
    }
    if (child === undefined) {
      return undefined;
    }
    current = child;
  }
}

export function isModuleForwardingReference(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  let current = source.ast.parent(node);
  while (current !== undefined) {
    if (
      source.ast.is.IsImportClause(current) ||
      source.ast.is.IsImportSpecifier(current) ||
      source.ast.is.IsNamespaceImport(current) ||
      source.ast.is.IsExportSpecifier(current) ||
      source.ast.is.IsImportDeclaration(current) ||
      source.ast.is.IsExportDeclaration(current)
    ) {
      return true;
    }
    if (!source.ast.is.IsNamedImports(current)) {
      return false;
    }
    current = source.ast.parent(current);
  }
  return false;
}

function isTransparentExpression(
  source: TargetSourceProgram,
  node: Node,
  child: Node,
): boolean {
  if (source.ast.is.IsParenthesizedExpression(node)) {
    return source.ast.as.AsParenthesizedExpression(node)?.Expression === child;
  }
  if (source.ast.is.IsAsExpression(node)) {
    return source.ast.as.AsAsExpression(node)?.Expression === child;
  }
  if (source.ast.is.IsTypeAssertion(node)) {
    return source.ast.as.AsTypeAssertion(node)?.Expression === child;
  }
  if (source.ast.is.IsSatisfiesExpression(node)) {
    return source.ast.as.AsSatisfiesExpression(node)?.Expression === child;
  }
  return source.ast.is.IsNonNullExpression(node) &&
    source.ast.as.AsNonNullExpression(node)?.Expression === child;
}

function transparentExpressionChild(
  source: TargetSourceProgram,
  node: Node,
): Node | undefined | false {
  if (source.ast.is.IsParenthesizedExpression(node)) {
    return source.ast.as.AsParenthesizedExpression(node)?.Expression;
  }
  if (source.ast.is.IsAsExpression(node)) {
    return source.ast.as.AsAsExpression(node)?.Expression;
  }
  if (source.ast.is.IsTypeAssertion(node)) {
    return source.ast.as.AsTypeAssertion(node)?.Expression;
  }
  if (source.ast.is.IsSatisfiesExpression(node)) {
    return source.ast.as.AsSatisfiesExpression(node)?.Expression;
  }
  if (source.ast.is.IsNonNullExpression(node)) {
    return source.ast.as.AsNonNullExpression(node)?.Expression;
  }
  return false;
}

function isNeverFallback(
  source: TargetSourceProgram,
  node: Node,
  left: Node,
): boolean {
  if (
    !source.ast.is.IsBinaryExpression(node) ||
    source.ast.operatorKindName(node) !== "KindQuestionQuestionToken" ||
    source.ast.as.AsBinaryExpression(node)?.Left !== left
  ) {
    return false;
  }
  const fallback = source.ast.as.AsBinaryExpression(node)?.Right;
  const fallbackType = fallback === undefined
    ? undefined
    : source.semantics.forNode(fallback).getTypeAtLocation(fallback);
  return fallback !== undefined &&
    fallbackType !== undefined &&
    source.semantics.forNode(fallback).isNever(fallbackType);
}
