import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { isFunctionLike } from "../../model/syntax.js";

export function exactCallableReturnExpressions(
  source: TargetSourceProgram,
  declaration: Node,
): readonly (Node | undefined)[] | undefined {
  const body = source.ast.body(declaration);
  if (body === undefined) {
    return undefined;
  }
  if (
    source.ast.is.IsArrowFunction(declaration) &&
    !source.ast.is.IsBlock(body)
  ) {
    return Object.freeze([body]);
  }
  const returns: (Node | undefined)[] = [];
  const pending = [body];
  while (pending.length !== 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    if (node !== body && isFunctionLike(source, node)) {
      continue;
    }
    if (source.ast.is.IsReturnStatement(node)) {
      returns.push(source.ast.as.AsReturnStatement(node)?.Expression);
      continue;
    }
    for (const child of source.ast.children(node)) {
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
  return Object.freeze(returns);
}
