import type { Node } from "@tsonic/tsts";

import {
  callableUsesSynchronousTransport,
} from "../../../model/synchronous.js";
import { isFunctionLike } from "../../../model/syntax.js";
import type {
  CallableContext,
  CallableState,
} from "../provenance-flow.js";
import { dependency } from "./state.js";

export function connectSynchronousCallableBodies(
  context: CallableContext,
  stateForDeclaration: (declaration: Node) => CallableState,
): void {
  for (const [call, state] of context.calls) {
    if (!state.relevant) {
      continue;
    }
    const owner = containingFunction(context, call);
    if (
      owner === undefined ||
      context.candidates.has(owner) ||
      !callableUsesSynchronousTransport(
        context.source,
        owner,
        context.bodyInspectionIsCertified,
      )
    ) {
      continue;
    }
    dependency(
      stateForDeclaration(owner),
      state,
      "callable-invocation",
      call,
      context,
    );
  }
}

function containingFunction(
  context: CallableContext,
  node: Node,
): Node | undefined {
  let current = context.source.ast.parent(node);
  while (current !== undefined) {
    if (isFunctionLike(context.source, current)) {
      return current;
    }
    current = context.source.ast.parent(current);
  }
  return undefined;
}
