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
  KindEqualsGreaterThanToken,
  NewArrowFunction,
  NewBlock,
  NewCallExpression,
  NewCatchClause,
  NewIdentifier,
  NewParenthesizedExpression,
  NewPropertyAccessExpression,
  NewReturnStatement,
  NewToken,
  NewTryStatement,
  NewVariableDeclaration,
  NodeFactory_NewNodeList,
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
type CooperativePromiseBoundary =
  CooperativeEffectFilePlan["promiseBoundaries"][number];

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
  const promiseBoundaryByCall = new Map(
    file.promiseBoundaries.map((boundary) => [boundary.call, boundary] as const),
  );
  if (returnTypes.size !== file.returnTypes.length) {
    throw new Error("cooperative-effect return contract was planned twice");
  }
  const consumedCallables = new Set<Node>();
  const consumedAwaits = new Set<Node>();
  const consumedModifiers = new Set<Node>();
  const consumedReturnTypes = new Set<Node>();
  const consumedProviderCalls = new Set<Node>();
  const consumedPromiseBoundaries = new Set<Node>();
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
      const promiseBoundary = promiseBoundaryByCall.get(original);
      if (provider !== undefined || promiseBoundary !== undefined) {
        if (consumedProviderCalls.has(original)) {
          throw new Error("planned conditional provider call was visited twice");
        }
        let replacement = updated;
        if (provider !== undefined) {
          consumedProviderCalls.add(original);
          replacement = settleProviderCall(plan, provider, replacement, factory);
        }
        if (promiseBoundary !== undefined) {
          if (consumedPromiseBoundaries.has(original)) {
            throw new Error("planned promise boundary was visited twice");
          }
          consumedPromiseBoundaries.add(original);
          replacement = preservePromiseObservation(
            promiseBoundary,
            replacement,
            factory,
          );
        }
        return replacement;
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
      assertExactConsumption(
        "promise boundary",
        new Set(promiseBoundaryByCall.keys()),
        consumedPromiseBoundaries,
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

function preservePromiseObservation(
  boundary: CooperativePromiseBoundary,
  expression: Node,
  factory: NodeFactory,
): Node {
  const tryBlock = requiredNode(NewBlock(
    factory,
    NodeFactory_NewNodeList(factory, [
      requiredNode(NewReturnStatement(
        factory,
        promiseMethodCall(factory, boundary, "resolve", expression),
      )),
    ]),
    true,
  ));
  const errorDeclaration = requiredNode(NewVariableDeclaration(
    factory,
    NewIdentifier(factory, boundary.names.error.text),
    undefined,
    undefined,
    undefined,
  ));
  const catchBlock = requiredNode(NewBlock(
    factory,
    NodeFactory_NewNodeList(factory, [
      requiredNode(NewReturnStatement(
        factory,
        promiseMethodCall(
          factory,
          boundary,
          "reject",
          requiredNode(NewIdentifier(factory, boundary.names.error.text)),
        ),
      )),
    ]),
    true,
  ));
  const catchClause = requiredNode(NewCatchClause(
    factory,
    errorDeclaration,
    catchBlock,
  ));
  const body = requiredNode(NewBlock(
    factory,
    NodeFactory_NewNodeList(factory, [
      requiredNode(NewTryStatement(factory, tryBlock, catchClause, undefined)),
    ]),
    true,
  ));
  const arrow = requiredNode(NewArrowFunction(
    factory,
    undefined,
    undefined,
    NodeFactory_NewNodeList(factory, []),
    undefined,
    undefined,
    NewToken(factory, KindEqualsGreaterThanToken),
    body,
  ));
  return requiredNode(NewCallExpression(
    factory,
    requiredNode(NewParenthesizedExpression(factory, arrow)),
    undefined,
    undefined,
    NodeFactory_NewNodeList(factory, []),
    0,
  ));
}

function promiseMethodCall(
  factory: NodeFactory,
  boundary: CooperativePromiseBoundary,
  method: "resolve" | "reject",
  value: Node,
): Node {
  const globalObject = requiredNode(NewIdentifier(
    factory,
    boundary.names.globalObject.text,
  ));
  const promise = requiredNode(NewPropertyAccessExpression(
    factory,
    globalObject,
    undefined,
    requiredNode(NewIdentifier(factory, "Promise")),
    0,
  ));
  const target = requiredNode(NewPropertyAccessExpression(
    factory,
    promise,
    undefined,
    requiredNode(NewIdentifier(factory, method)),
    0,
  ));
  return requiredNode(NewCallExpression(
    factory,
    target,
    undefined,
    undefined,
    NodeFactory_NewNodeList(factory, [value]),
    0,
  ));
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
