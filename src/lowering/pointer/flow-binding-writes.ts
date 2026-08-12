import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

export function indexProjectBindingWrites(
  source: TargetSourceProgram,
  nodes: readonly Node[],
): ReadonlySet<Node> {
  const declarations = new Set<Node>();
  for (const node of nodes) {
    if (!isPotentialBindingReference(source, node) || !mayReachWrite(source, node)) {
      continue;
    }
    const reference = source.navigation.sourceReferenceFor(node);
    if (
      reference?.project === true &&
      source.navigation.bindingWritesWithin(reference.symbol, node).length !== 0
    ) {
      declarations.add(reference.declaration);
    }
  }
  return declarations;
}

function isPotentialBindingReference(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  return source.ast.is.IsIdentifier(node) ||
    source.ast.is.IsPropertyAccessExpression(node) ||
    source.ast.is.IsElementAccessExpression(node);
}

function mayReachWrite(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  let current = node;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined || source.ast.is.IsSourceFile(parent)) {
      return false;
    }
    if (source.ast.is.IsBinaryExpression(parent)) {
      return source.ast.as.AsBinaryExpression(parent)?.Left === current;
    }
    if (source.ast.is.IsPrefixUnaryExpression(parent)) {
      return source.ast.as.AsPrefixUnaryExpression(parent)?.Operand === current;
    }
    if (source.ast.is.IsPostfixUnaryExpression(parent)) {
      return source.ast.as.AsPostfixUnaryExpression(parent)?.Operand === current;
    }
    if (source.ast.is.IsForInStatement(parent) || source.ast.is.IsForOfStatement(parent)) {
      return source.ast.as.AsForInOrOfStatement(parent)?.Initializer === current;
    }
    current = parent;
  }
}
