import type {
  Node,
  SourceFile,
} from "@tsonic/tsts";
import {
  AsNewExpression,
  AsPropertyAccessExpression,
  KindCommaToken,
  NewAsExpression,
  NewBinaryExpression,
  NewParenthesizedExpression,
  NewToken,
  NewVoidExpression,
  transformTargetSourceFile,
} from "@tsonic/tsts/target-ast";
import type {
  NodeFactory,
  TargetAstRewrite,
} from "@tsonic/tsts/target-ast";

import type {
  ScalarRepresentationPlan,
  ScalarRepresentationProfile,
} from "./plan.js";

export interface ScalarRepresentationRewriteResult {
  readonly sourceFile: SourceFile;
  readonly profile: ScalarRepresentationProfile;
  readonly projectionCount: number;
}

export interface ScalarRepresentationRewriter {
  readonly rewrite: TargetAstRewrite;
  finish(sourceFile: SourceFile): ScalarRepresentationRewriteResult;
}

export function createScalarRepresentationRewriter(
  plan: ScalarRepresentationPlan,
  sourceFile: SourceFile,
): ScalarRepresentationRewriter {
  const expected = plan.projectionsFor(sourceFile);
  const consumed = new Set<Node>();
  let finished = false;
  return Object.freeze({
    rewrite(
      original: Node,
      updated: Node,
      factory: NodeFactory,
    ): Node | undefined {
      if (finished) {
        throw new Error("scalar representation rewriter is already finished");
      }
      const projection = plan.projectionFor(original);
      if (projection === undefined) {
        return updated;
      }
      if (consumed.has(original)) {
        throw new Error("scalar projection was visited more than once");
      }
      const access = AsPropertyAccessExpression(updated);
      const construction = access?.Expression === undefined
        ? undefined
        : AsNewExpression(access.Expression);
      const target = construction?.Expression;
      const argument = construction?.Arguments?.Nodes[0];
      if (
        access === undefined ||
        construction === undefined ||
        target === undefined ||
        argument === undefined ||
        construction.Arguments?.Nodes.length !== 1
      ) {
        throw new Error(
          "planned scalar projection lost its exact transformed shape",
        );
      }
      consumed.add(original);
      return projectScalarValue(
        factory,
        target,
        argument,
        projection.resultTypeNode,
      );
    },
    finish(transformed: SourceFile): ScalarRepresentationRewriteResult {
      if (finished) {
        throw new Error("scalar representation rewriter is already finished");
      }
      finished = true;
      const missing = expected.find((projection) =>
        !consumed.has(projection.access)
      );
      if (missing !== undefined || consumed.size !== expected.length) {
        throw new Error(
          `scalar projection consumption mismatch: planned ${expected.length}, consumed ${consumed.size}`,
        );
      }
      return Object.freeze({
        sourceFile: transformed,
        profile: plan.profile,
        projectionCount: consumed.size,
      });
    },
  });
}

export function lowerScalarRepresentations(
  sourceFile: SourceFile,
  plan: ScalarRepresentationPlan,
): ScalarRepresentationRewriteResult {
  const rewriter = createScalarRepresentationRewriter(plan, sourceFile);
  const transformed = transformTargetSourceFile(
    sourceFile,
    rewriter.rewrite,
  );
  return rewriter.finish(transformed);
}

function projectScalarValue(
  factory: NodeFactory,
  constructorTarget: Node,
  argument: Node,
  resultTypeNode: Node,
): Node {
  const sequence = requiredNode(
    NewBinaryExpression(
      factory,
      undefined,
      requiredNode(
        NewVoidExpression(factory, constructorTarget),
        "scalar constructor-target evaluation",
      ),
      undefined,
      NewToken(factory, KindCommaToken),
      argument,
    ),
    "scalar construction evaluation sequence",
  );
  const parenthesized = requiredNode(
    NewParenthesizedExpression(factory, sequence),
    "scalar construction evaluation parentheses",
  );
  return requiredNode(
    NewAsExpression(factory, parenthesized, resultTypeNode),
    "scalar projection type preservation",
  );
}

function requiredNode(node: Node | undefined, subject: string): Node {
  if (node === undefined) {
    throw new Error(`failed to construct ${subject}`);
  }
  return node;
}
