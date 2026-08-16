import type {
  Node,
  SourceFile,
} from "@tsonic/tsts";
import {
  AsClassDeclaration,
  AsNewExpression,
  AsPropertyAccessExpression,
  KindBigIntKeyword,
  KindBooleanKeyword,
  KindCommaToken,
  KindNumberKeyword,
  KindStringKeyword,
  NewAsExpression,
  NewBinaryExpression,
  NewKeywordTypeNode,
  NewNumericLiteral,
  NewParenthesizedExpression,
  NewToken,
  NewVariableDeclaration,
  NewVariableDeclarationList,
  NewVariableStatement,
  NewVoidExpression,
  NodeFactory_NewNodeList,
  NodeFlagsConst,
  transformTargetSourceFile,
} from "@tsonic/tsts/target-ast";
import type {
  NodeFactory,
  TargetAstRewrite,
} from "@tsonic/tsts/target-ast";

import type {
  ScalarRepresentationPlan,
  ScalarRepresentationProfile,
  ScalarProjectionResultType,
} from "./plan.js";

export interface ScalarRepresentationRewriteResult {
  readonly sourceFile: SourceFile;
  readonly profile: ScalarRepresentationProfile;
  readonly projectionCount: number;
  readonly scalarClassRewriteCount: number;
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
  const expectedClassRewrites = plan.scalarClassRewritesFor(sourceFile);
  const consumed = new Set<Node>();
  const consumedClassRewrites = new Set<Node>();
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
      const classRewrite = plan.scalarClassRewriteFor(original);
      if (classRewrite !== undefined) {
        if (consumedClassRewrites.has(original)) {
          throw new Error("scalar class node was visited more than once");
        }
        consumedClassRewrites.add(original);
        if (classRewrite.kind === "declaration") {
          const declaration = AsClassDeclaration(updated);
          if (declaration?.name === undefined) {
            throw new Error("planned scalar class lost its declaration shape");
          }
          return scalarClassSentinel(factory, declaration);
        }
        const primitive = classRewrite.flow.proof.portableResultType;
        if (primitive === undefined) {
          throw new Error("planned scalar class lost its portable type");
        }
        return resultTypeNode(factory, {
          kind: "primitive",
          primitive,
        });
      }
      const projection = plan.projectionFor(original);
      if (projection === undefined) {
        return updated;
      }
      consumeProjection(consumed, original);
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
      return projectScalarValue(
        factory,
        target,
        argument,
        projection.resultType,
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
      const missingClassRewrite = expectedClassRewrites.find((node) =>
        !consumedClassRewrites.has(node)
      );
      if (
        missingClassRewrite !== undefined ||
        consumedClassRewrites.size !== expectedClassRewrites.length
      ) {
        throw new Error(
          `scalar class consumption mismatch: planned ${expectedClassRewrites.length}, consumed ${consumedClassRewrites.size}`,
        );
      }
      return Object.freeze({
        sourceFile: transformed,
        profile: plan.profile,
        projectionCount: consumed.size,
        scalarClassRewriteCount: consumedClassRewrites.size,
      });
    },
  });
}

function scalarClassSentinel(
  factory: NodeFactory,
  declaration: NonNullable<ReturnType<typeof AsClassDeclaration>>,
): Node {
  if (declaration.name === undefined) {
    throw new Error("planned scalar class sentinel has no name");
  }
  const zero = requiredNode(
    NewNumericLiteral(factory, "0", 0),
    "scalar class sentinel zero",
  );
  const initializer = requiredNode(
    NewVoidExpression(factory, zero),
    "scalar class sentinel initializer",
  );
  const variable = requiredNode(
    NewVariableDeclaration(
      factory,
      declaration.name,
      undefined,
      undefined,
      initializer,
    ),
    "scalar class sentinel declaration",
  );
  const declarations = requiredNode(
    NewVariableDeclarationList(
      factory,
      NodeFactory_NewNodeList(factory, [variable]),
      NodeFlagsConst,
    ),
    "scalar class sentinel declaration list",
  );
  return requiredNode(
    NewVariableStatement(factory, declaration.modifiers, declarations),
    "scalar class sentinel statement",
  );
}

function consumeProjection(consumed: Set<Node>, original: Node): void {
  if (consumed.has(original)) {
    throw new Error("scalar projection was visited more than once");
  }
  consumed.add(original);
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
  resultType: ScalarProjectionResultType,
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
  const projected = requiredNode(
    NewAsExpression(factory, parenthesized, resultTypeNode(factory, resultType)),
    "scalar projection type preservation",
  );
  return requiredNode(
    NewParenthesizedExpression(factory, projected),
    "scalar projection use-site precedence",
  );
}

function resultTypeNode(
  factory: NodeFactory,
  resultType: ScalarProjectionResultType,
): Node {
  if (resultType.kind === "authored") {
    return resultType.node;
  }
  const kind = resultType.primitive === "number"
    ? KindNumberKeyword
    : resultType.primitive === "string"
    ? KindStringKeyword
    : resultType.primitive === "boolean"
    ? KindBooleanKeyword
    : KindBigIntKeyword;
  return requiredNode(
    NewKeywordTypeNode(factory, kind),
    "scalar projection primitive type",
  );
}

function requiredNode(node: Node | undefined, subject: string): Node {
  if (node === undefined) {
    throw new Error(`failed to construct ${subject}`);
  }
  return node;
}
