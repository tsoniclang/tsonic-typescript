import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import {
  isFunctionLike,
  transparentExpression,
} from "../../model/syntax.js";

export function containingCallArgument(
  source: TargetSourceProgram,
  reference: Node,
): { readonly call: Node; readonly expression: Node } | undefined {
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return undefined;
    }
    if (source.ast.is.IsCallExpression(parent)) {
      return source.ast.arguments(parent).includes(current)
        ? { call: parent, expression: current }
        : undefined;
    }
    if (transparentExpression(source, parent) !== current) {
      return undefined;
    }
    current = parent;
  }
}

export function isNullishIdentityObservation(
  source: TargetSourceProgram,
  reference: Node,
): boolean {
  const parent = source.ast.parent(reference);
  if (
    parent === undefined ||
    !source.ast.is.IsBinaryExpression(parent) ||
    !new Set([
      "KindEqualsEqualsEqualsToken",
      "KindExclamationEqualsEqualsToken",
    ]).has(source.ast.operatorKindName(parent) ?? "")
  ) {
    return false;
  }
  const binary = source.ast.as.AsBinaryExpression(parent);
  const other = binary?.Left === reference ? binary.Right : binary?.Left;
  if (other === undefined) {
    return false;
  }
  const semantics = source.semantics.forNode(other);
  const type = semantics.types.expressionType(other);
  return type !== undefined && semantics.types.isNullish(type);
}

export function containingFunction(
  source: TargetSourceProgram,
  node: Node,
): Node | undefined {
  let current = source.ast.parent(node);
  while (current !== undefined) {
    if (isFunctionLike(source, current)) {
      return current;
    }
    current = source.ast.parent(current);
  }
  return undefined;
}

export function forEachDirectFunctionNode(
  source: TargetSourceProgram,
  owner: Node,
  callback: (node: Node) => void,
): void {
  forEachNode(source, owner, (node) => {
    if (node !== owner && isFunctionLike(source, node)) {
      return false;
    }
    callback(node);
    return true;
  });
}

function forEachNode(
  source: TargetSourceProgram,
  root: Node,
  callback: (node: Node) => boolean | void,
): void {
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined || callback(node) === false) {
      continue;
    }
    const children = source.ast.children(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
}
