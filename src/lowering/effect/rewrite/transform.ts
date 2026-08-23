import type {
  Node,
  SourceFile,
} from "@tsonic/tsts";
import {
  AsAwaitExpression,
  AsArrowFunction,
  AsCallExpression,
  AsFunctionDeclaration,
  AsFunctionExpression,
  AsMethodDeclaration,
  AsPropertyAccessExpression,
  NewIdentifier,
  NewPropertyAccessExpression,
  NodeFactory_UpdateCallExpression,
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

import type {
  CooperativeEffectFilePlan,
  CooperativeEffectPlan,
} from "../planning/plan.js";
import {
  selectedCallableReturnType,
  type CallableReturnRewrite,
} from "../model/callable-contract.js";

type ConditionalProviderInvocation =
  CooperativeEffectFilePlan["providerCalls"][number];

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
  const providerCalls = new Map(
    file.providerCalls.map((provider) => [provider.call, provider] as const),
  );
  if (returnTypes.size !== file.returnTypes.length) {
    throw new Error("cooperative-effect return contract was planned twice");
  }
  const consumedCallables = new Set<Node>();
  const consumedAwaits = new Set<Node>();
  const consumedModifiers = new Set<Node>();
  const consumedReturnTypes = new Set<Node>();
  const consumedProviderCalls = new Set<Node>();
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
      const provider = providerCalls.get(original);
      if (provider !== undefined) {
        if (consumedProviderCalls.has(original)) {
          throw new Error("planned conditional provider call was visited twice");
        }
        consumedProviderCalls.add(original);
        return settleProviderCall(plan, provider, updated, factory);
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
      assertExactConsumption(
        "conditional provider call",
        new Set(providerCalls.keys()),
        consumedProviderCalls,
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

function settleProviderCall(
  plan: CooperativeEffectPlan,
  provider: ConditionalProviderInvocation,
  updated: Node,
  factory: NodeFactory,
): Node {
  const replacement = provider.fact.conditional?.replacement;
  const call = plan.source.ast.is.IsCallExpression(updated)
    ? AsCallExpression(updated)
    : undefined;
  const access = call?.Expression !== undefined &&
      plan.source.ast.is.IsPropertyAccessExpression(call.Expression)
    ? AsPropertyAccessExpression(call.Expression)
    : undefined;
  const receiver = access?.Expression;
  if (
    replacement === undefined ||
    provider.fact.target.access !== "export" ||
    replacement.access !== "export" ||
    call === undefined ||
    access === undefined ||
    receiver === undefined ||
    plan.source.ast.text(access.name) !== provider.fact.target.exportName
  ) {
    throw new Error(
      `Conditional provider call '${provider.fact.semanticKey}' lost its exact namespace-export shape`,
    );
  }
  const target = NewPropertyAccessExpression(
    factory,
    receiver,
    access.QuestionDotToken,
    NewIdentifier(factory, replacement.exportName),
    access.Flags,
  );
  if (target === undefined) {
    throw new Error("failed to construct conditional provider replacement");
  }
  return requiredNode(NodeFactory_UpdateCallExpression(
    factory,
    call,
    target,
    call.QuestionDotToken,
    call.TypeArguments,
    call.Arguments,
    call.Flags,
  ));
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
