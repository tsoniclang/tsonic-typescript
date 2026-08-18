import type {
  Node,
  SourceFile,
} from "@tsonic/tsts";
import {
  AsAwaitExpression,
  AsArrowFunction,
  AsFunctionDeclaration,
  AsFunctionExpression,
  AsMethodDeclaration,
  NodeFactory_UpdateArrowFunction,
  NodeFactory_UpdateFunctionDeclaration,
  NodeFactory_UpdateFunctionExpression,
  NodeFactory_UpdateMethodDeclaration,
  transformTargetSourceFile,
} from "@tsonic/tsts/target-ast";
import type {
  NodeFactory,
  TargetAstRewrite,
} from "@tsonic/tsts/target-ast";

import type { CooperativeEffectPlan } from "../planning/plan.js";
import {
  selectedCallableReturnType,
  type CallableReturnRewrite,
} from "../model/callable-contract.js";

export interface CooperativeEffectRewriteResult {
  readonly sourceFile: SourceFile;
  readonly callableCount: number;
  readonly awaitCount: number;
}

export interface CooperativeEffectRewriteSession {
  readonly rewrite: TargetAstRewrite;
  finish(sourceFile: SourceFile): CooperativeEffectRewriteResult;
}

export function createCooperativeEffectRewriteSession(
  plan: CooperativeEffectPlan,
  sourceFile: SourceFile,
): CooperativeEffectRewriteSession {
  const file = plan.begin(sourceFile);
  const callables = new Set(file.callables);
  const awaits = new Set(file.awaits);
  const asyncModifiers = new Set(file.asyncModifiers);
  const returnTypes = new Map(
    file.returnTypes.map((rewrite) => [rewrite.target, rewrite] as const),
  );
  if (returnTypes.size !== file.returnTypes.length) {
    throw new Error("cooperative-effect return contract was planned twice");
  }
  const consumedCallables = new Set<Node>();
  const consumedAwaits = new Set<Node>();
  const consumedModifiers = new Set<Node>();
  const consumedReturnTypes = new Set<Node>();
  let finished = false;
  return Object.freeze({
    rewrite(original: Node, updated: Node, factory: NodeFactory): Node | undefined {
      if (finished) {
        throw new Error("cooperative-effect rewriter is already finished");
      }
      const returnType = returnTypes.get(original);
      if (returnType !== undefined) {
        const replacement = selectedCallableReturnType(
          plan.source,
          updated,
          returnType.selection,
        );
        if (replacement === undefined || consumedReturnTypes.has(original)) {
          throw new Error("planned callable contract lost its exact AST shape");
        }
        consumedReturnTypes.add(original);
        return replacement;
      }
      if (asyncModifiers.has(original)) {
        if (consumedModifiers.has(original)) {
          throw new Error("planned async modifier was visited twice");
        }
        consumedModifiers.add(original);
        return undefined;
      }
      if (awaits.has(original)) {
        const expression = AsAwaitExpression(updated)?.Expression;
        if (expression === undefined || consumedAwaits.has(original)) {
          throw new Error("planned cooperative await lost its exact AST shape");
        }
        consumedAwaits.add(original);
        return expression;
      }
      if (!callables.has(original)) {
        return updated;
      }
      if (consumedCallables.has(original)) {
        throw new Error("planned cooperative callable was visited twice");
      }
      consumedCallables.add(original);
      return settleCallable(plan, updated, factory);
    },
    finish(transformed: SourceFile): CooperativeEffectRewriteResult {
      if (finished) {
        throw new Error("cooperative-effect rewriter was sealed twice");
      }
      finished = true;
      assertExactConsumption("callable", callables, consumedCallables);
      assertExactConsumption("await", awaits, consumedAwaits);
      assertExactConsumption("async modifier", asyncModifiers, consumedModifiers);
      assertExactConsumption(
        "callable return type",
        new Set(returnTypes.keys()),
        consumedReturnTypes,
      );
      plan.finishFile(sourceFile);
      return Object.freeze({
        sourceFile: transformed,
        callableCount: consumedCallables.size,
        awaitCount: consumedAwaits.size,
      });
    },
  });
}

export function lowerCooperativeEffects(
  sourceFile: SourceFile,
  plan: CooperativeEffectPlan,
): CooperativeEffectRewriteResult {
  const session = createCooperativeEffectRewriteSession(plan, sourceFile);
  const transformed = transformTargetSourceFile(sourceFile, session.rewrite);
  return session.finish(transformed);
}

function settleCallable(
  plan: CooperativeEffectPlan,
  updated: Node,
  factory: NodeFactory,
): Node {
  const typeNode = plan.source.ast.typeNode(updated);
  const innerTypeNode = plan.source.ast.typeArguments(typeNode)[0];
  if (typeNode === undefined || innerTypeNode === undefined) {
    throw new Error("planned cooperative callable lost its return contract");
  }
  const functionDeclaration = plan.source.ast.is.IsFunctionDeclaration(updated)
    ? AsFunctionDeclaration(updated)
    : undefined;
  if (functionDeclaration !== undefined) {
    return requiredNode(NodeFactory_UpdateFunctionDeclaration(
      factory,
      functionDeclaration,
      functionDeclaration.modifiers,
      functionDeclaration.AsteriskToken,
      functionDeclaration.name,
      functionDeclaration.TypeParameters,
      functionDeclaration.Parameters,
      innerTypeNode,
      functionDeclaration.FullSignature,
      functionDeclaration.Body,
    ));
  }
  const method = plan.source.ast.is.IsMethodDeclaration(updated)
    ? AsMethodDeclaration(updated)
    : undefined;
  if (method !== undefined) {
    return requiredNode(NodeFactory_UpdateMethodDeclaration(
      factory,
      method,
      method.modifiers,
      method.AsteriskToken,
      method.name,
      method.PostfixToken,
      method.TypeParameters,
      method.Parameters,
      innerTypeNode,
      method.FullSignature,
      method.Body,
    ));
  }
  const arrow = plan.source.ast.is.IsArrowFunction(updated)
    ? AsArrowFunction(updated)
    : undefined;
  if (arrow !== undefined) {
    return requiredNode(NodeFactory_UpdateArrowFunction(
      factory,
      arrow,
      arrow.modifiers,
      arrow.TypeParameters,
      arrow.Parameters,
      innerTypeNode,
      arrow.FullSignature,
      arrow.EqualsGreaterThanToken,
      arrow.Body,
    ));
  }
  const expression = plan.source.ast.is.IsFunctionExpression(updated)
    ? AsFunctionExpression(updated)
    : undefined;
  if (expression !== undefined) {
    return requiredNode(NodeFactory_UpdateFunctionExpression(
      factory,
      expression,
      expression.modifiers,
      expression.AsteriskToken,
      expression.name,
      expression.TypeParameters,
      expression.Parameters,
      innerTypeNode,
      expression.FullSignature,
      expression.Body,
    ));
  }
  throw new Error("planned cooperative callable changed declaration kind");
}

function assertExactConsumption(
  subject: string,
  expected: ReadonlySet<Node>,
  consumed: ReadonlySet<Node>,
): void {
  if (
    expected.size !== consumed.size ||
    [...expected].some((node) => !consumed.has(node))
  ) {
    throw new Error(
      `cooperative-effect ${subject} consumption mismatch: planned ${expected.size}, consumed ${consumed.size}`,
    );
  }
}

function requiredNode(node: Node | undefined): Node {
  if (node === undefined) {
    throw new Error("failed to construct settled cooperative callable");
  }
  return node;
}
