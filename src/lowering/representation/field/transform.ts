import type { Node, SourceFile } from "@tsonic/tsts";
import {
  AsCallExpression,
  AsPropertyAccessExpression,
  KindCommaToken,
  NewBinaryExpression,
  NewIdentifier,
  NewParenthesizedExpression,
  NewPropertyAccessExpression,
  NewToken,
  NewVoidExpression,
  type NodeFactory,
} from "@tsonic/tsts/target-ast";

import type { DirectLogicalFieldPlan } from "./plan.js";

export interface DirectLogicalFieldRewriter {
  rewrite(
    original: Node,
    updated: Node,
    factory: NodeFactory,
  ): Node | undefined;
  finish(): number;
}

export function createDirectLogicalFieldRewriter(
  plan: DirectLogicalFieldPlan,
  sourceFile: SourceFile,
): DirectLogicalFieldRewriter {
  const expected = plan.rewritesFor(sourceFile);
  const consumed = new Set<Node>();
  let finished = false;
  return Object.freeze({
    rewrite(
      original: Node,
      updated: Node,
      factory: NodeFactory,
    ): Node | undefined {
      if (finished) {
        throw new Error("direct logical-field rewriter is already finished");
      }
      const selected = plan.rewriteFor(original);
      if (selected === undefined) {
        return undefined;
      }
      if (consumed.has(original)) {
        throw new Error("direct logical-field projection was visited twice");
      }
      const access = AsPropertyAccessExpression(updated);
      const projection = AsCallExpression(access?.Expression);
      const argument = projection?.Arguments?.Nodes[0];
      const target = projection?.Expression;
      if (
        access === undefined ||
        projection === undefined ||
        argument === undefined ||
        target === undefined ||
        projection.Arguments?.Nodes.length !== 1
      ) {
        throw new Error("planned direct logical-field projection lost its shape");
      }
      consumed.add(original);
      const receiver = requiredNode(NewParenthesizedExpression(
        factory,
        requiredNode(NewBinaryExpression(
          factory,
          undefined,
          requiredNode(NewVoidExpression(factory, target)),
          undefined,
          NewToken(factory, KindCommaToken),
          argument,
        )),
      ));
      return requiredNode(NewPropertyAccessExpression(
        factory,
        receiver,
        undefined,
        NewIdentifier(factory, selected.logicalName),
        access.Flags,
      ));
    },
    finish(): number {
      if (finished) {
        throw new Error("direct logical-field rewriter was sealed twice");
      }
      finished = true;
      const missing = expected.find((rewrite) => !consumed.has(rewrite.access));
      if (missing !== undefined || consumed.size !== expected.length) {
        throw new Error(
          `direct logical-field consumption mismatch: planned ${expected.length}, consumed ${consumed.size}`,
        );
      }
      return consumed.size;
    },
  });
}

function requiredNode(node: Node | undefined): Node {
  if (node === undefined) {
    throw new Error("failed to construct direct logical-field rewrite");
  }
  return node;
}
