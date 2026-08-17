import type { Node, SourceFile } from "@tsonic/tsts";
import {
  AsCallExpression,
  AsFunctionDeclaration,
  AsMethodDeclaration,
  NodeFactory_NewNodeList,
  NodeFactory_UpdateCallExpression,
  NodeFactory_UpdateFunctionDeclaration,
  NodeFactory_UpdateMethodDeclaration,
  transformTargetSourceFile,
} from "@tsonic/tsts/target-ast";
import type {
  NodeFactory,
  TargetAstRewrite,
} from "@tsonic/tsts/target-ast";

import type { IdentityCallableSpecialization } from "./callable-plan.js";
import type { RepresentationProjectionPlan } from "./plan.js";

export interface RepresentationProjectionRewriteResult {
  readonly sourceFile: SourceFile;
  readonly rewriteCount: number;
  readonly callableParameterCount: number;
  readonly callableInvocationCount: number;
  readonly callableArgumentCount: number;
}

export interface RepresentationProjectionRewriter {
  readonly rewrite: TargetAstRewrite;
  finish(sourceFile: SourceFile): RepresentationProjectionRewriteResult;
}

export function createRepresentationProjectionRewriter(
  plan: RepresentationProjectionPlan,
  sourceFile: SourceFile,
): RepresentationProjectionRewriter {
  const expected = plan.rewritesFor(sourceFile);
  const callableSpecializations = plan.identityCallables.specializationsFor(sourceFile);
  const consumed = new Set<Node>();
  const consumedOwners = new Map<Node, Set<number>>();
  const consumedOwnerCalls = new Map<Node, Set<number>>();
  const consumedParameterCalls = new Set<Node>();
  let finished = false;
  return Object.freeze({
    rewrite(original: Node, updated: Node, factory: NodeFactory): Node | undefined {
      if (finished) {
        throw new Error("representation projection rewriter is already finished");
      }
      const selected = plan.rewriteFor(original);
      if (selected !== undefined) {
        if (consumed.has(original)) {
          throw new Error("representation projection was visited more than once");
        }
        consumed.add(original);
        const call = AsCallExpression(updated);
        const directArgument = call?.Arguments?.Nodes[0];
        if (directArgument === undefined || call?.Arguments?.Nodes.length !== 1) {
          throw new Error("planned representation call lost its transformed shape");
        }
        if (selected.kind === "identity") {
          return directArgument;
        }
        const inner = AsCallExpression(directArgument);
        const inverseArgument = inner?.Arguments?.Nodes[0];
        if (inverseArgument === undefined || inner?.Arguments?.Nodes.length !== 1) {
          throw new Error("planned inverse representation lost its inner call");
        }
        return inverseArgument;
      }

      const parameterSpecialization =
        plan.identityCallables.specializationForParameterCall(original);
      if (parameterSpecialization !== undefined) {
        if (consumedParameterCalls.has(original)) {
          throw new Error("identity-callable invocation was visited more than once");
        }
        const call = AsCallExpression(updated);
        const argument = call?.Arguments?.Nodes[0];
        if (argument === undefined || call?.Arguments?.Nodes.length !== 1) {
          throw new Error("planned identity-callable invocation lost its argument");
        }
        consumedParameterCalls.add(original);
        return argument;
      }

      const ownerCallSpecializations =
        plan.identityCallables.specializationsForOwnerCall(original);
      let result = updated;
      if (ownerCallSpecializations.length !== 0) {
        result = updateOwnerCall(
          original,
          result,
          factory,
          ownerCallSpecializations,
          consumedOwnerCalls,
        );
      }

      const ownerSpecializations =
        plan.identityCallables.specializationsForOwner(original);
      if (ownerSpecializations.length !== 0) {
        result = updateOwner(
          original,
          result,
          factory,
          ownerSpecializations,
          consumedOwners,
        );
      }
      return result;
    },
    finish(transformed: SourceFile): RepresentationProjectionRewriteResult {
      if (finished) {
        throw new Error("representation projection rewriter is already finished");
      }
      finished = true;
      const missing = expected.find((rewrite) => !consumed.has(rewrite.call));
      if (missing !== undefined || consumed.size !== expected.length) {
        throw new Error(
          `representation projection consumption mismatch: planned ${expected.length}, consumed ${consumed.size}`,
        );
      }
      assertCallableConsumption(
        plan,
        sourceFile,
        callableSpecializations,
        consumedOwners,
        consumedOwnerCalls,
        consumedParameterCalls,
      );
      return Object.freeze({
        sourceFile: transformed,
        rewriteCount: consumed.size,
        callableParameterCount: countConsumed(consumedOwners),
        callableInvocationCount: consumedParameterCalls.size,
        callableArgumentCount: countConsumed(consumedOwnerCalls),
      });
    },
  });
}

function updateOwnerCall(
  original: Node,
  updated: Node,
  factory: NodeFactory,
  specializations: readonly IdentityCallableSpecialization[],
  consumed: Map<Node, Set<number>>,
): Node {
  const call = AsCallExpression(updated);
  const arguments_ = call?.Arguments?.Nodes ?? [];
  const removed = new Set(specializations.map((entry) => entry.parameterIndex));
  if (
    call === undefined ||
    removed.size !== specializations.length ||
    [...removed].some((index) => arguments_[index] === undefined)
  ) {
    throw new Error("planned identity-callable owner call lost its argument shape");
  }
  recordIndexes(original, removed, consumed, "owner call");
  return requiredNode(NodeFactory_UpdateCallExpression(
    factory,
    call,
    call.Expression,
    call.QuestionDotToken,
    call.TypeArguments,
    NodeFactory_NewNodeList(
      factory,
      arguments_.filter((_argument, index) => !removed.has(index)),
    ),
    call.Flags,
  ));
}

function updateOwner(
  original: Node,
  updated: Node,
  factory: NodeFactory,
  specializations: readonly IdentityCallableSpecialization[],
  consumed: Map<Node, Set<number>>,
): Node {
  const parameters = sourceParameters(updated);
  const removed = new Set(specializations.map((entry) => entry.parameterIndex));
  if (
    removed.size !== specializations.length ||
    [...removed].some((index) => parameters[index] === undefined)
  ) {
    throw new Error("planned identity-callable owner lost its parameter shape");
  }
  const retained = NodeFactory_NewNodeList(
    factory,
    parameters.filter((_parameter, index) => !removed.has(index)),
  );
  recordIndexes(original, removed, consumed, "owner");
  const declaration = AsFunctionDeclaration(updated);
  if (declaration !== undefined) {
    return requiredNode(NodeFactory_UpdateFunctionDeclaration(
      factory,
      declaration,
      declaration.modifiers,
      declaration.AsteriskToken,
      declaration.name,
      declaration.TypeParameters,
      retained,
      declaration.Type,
      declaration.FullSignature,
      declaration.Body,
    ));
  }
  const method = AsMethodDeclaration(updated);
  if (method !== undefined) {
    return requiredNode(NodeFactory_UpdateMethodDeclaration(
      factory,
      method,
      method.modifiers,
      method.AsteriskToken,
      method.name,
      method.PostfixToken,
      method.TypeParameters,
      retained,
      method.Type,
      method.FullSignature,
      method.Body,
    ));
  }
  throw new Error("planned identity-callable owner changed declaration kind");
}

function sourceParameters(node: Node): readonly Node[] {
  const declaration = AsFunctionDeclaration(node) ?? AsMethodDeclaration(node);
  return (declaration?.Parameters?.Nodes ?? []).filter(
    (parameter): parameter is Node => parameter !== undefined,
  );
}

function recordIndexes(
  node: Node,
  indexes: ReadonlySet<number>,
  consumed: Map<Node, Set<number>>,
  subject: string,
): void {
  const existing = consumed.get(node);
  if (existing !== undefined) {
    throw new Error(`planned identity-callable ${subject} was visited twice`);
  }
  consumed.set(node, new Set(indexes));
}

function assertCallableConsumption(
  plan: RepresentationProjectionPlan,
  sourceFile: SourceFile,
  specializations: readonly IdentityCallableSpecialization[],
  owners: ReadonlyMap<Node, ReadonlySet<number>>,
  ownerCalls: ReadonlyMap<Node, ReadonlySet<number>>,
  parameterCalls: ReadonlySet<Node>,
): void {
  let expectedOwners = 0;
  let expectedOwnerCalls = 0;
  let expectedParameterCalls = 0;
  for (const specialization of specializations) {
    if (plan.identityCallables.belongsToFile(specialization.owner, sourceFile)) {
      expectedOwners += 1;
      if (!owners.get(specialization.owner)?.has(specialization.parameterIndex)) {
        throw new Error("identity-callable owner consumption lost a planned parameter");
      }
    }
    for (const call of specialization.ownerCalls) {
      if (!plan.identityCallables.belongsToFile(call, sourceFile)) {
        continue;
      }
      expectedOwnerCalls += 1;
      if (!ownerCalls.get(call)?.has(specialization.parameterIndex)) {
        throw new Error("identity-callable call consumption lost a planned argument");
      }
    }
    for (const call of specialization.parameterCalls) {
      if (!plan.identityCallables.belongsToFile(call, sourceFile)) {
        continue;
      }
      expectedParameterCalls += 1;
      if (!parameterCalls.has(call)) {
        throw new Error("identity-callable invocation consumption lost a planned call");
      }
    }
  }
  if (
    countConsumed(owners) !== expectedOwners ||
    countConsumed(ownerCalls) !== expectedOwnerCalls ||
    parameterCalls.size !== expectedParameterCalls
  ) {
    throw new Error("identity-callable rewrite consumption mismatch");
  }
}

function countConsumed(values: ReadonlyMap<Node, ReadonlySet<number>>): number {
  let count = 0;
  for (const indexes of values.values()) {
    count += indexes.size;
  }
  return count;
}

function requiredNode(node: Node | undefined): Node {
  if (node === undefined) {
    throw new Error("failed to construct identity-callable rewrite");
  }
  return node;
}

export function lowerRepresentationProjections(
  sourceFile: SourceFile,
  plan: RepresentationProjectionPlan,
): RepresentationProjectionRewriteResult {
  const rewriter = createRepresentationProjectionRewriter(plan, sourceFile);
  return rewriter.finish(transformTargetSourceFile(sourceFile, rewriter.rewrite));
}
