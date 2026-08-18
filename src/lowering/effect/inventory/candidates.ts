import type { Node, SourceFile, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  KindArrowFunction,
  KindCallExpression,
  KindFunctionDeclaration,
  KindFunctionExpression,
  KindMethodDeclaration,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../program-index.js";
import {
  blockCooperativeEffect,
  type CooperativeEffectFallbackReason,
} from "../closure/retention.js";
import { callableDispatchIsClosed } from "../model/syntax.js";
import { sameSelectedType } from "../model/synchronous.js";

export interface CooperativeEffectCandidate {
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly innerType?: Type;
  readonly dependencies: Set<CooperativeEffectCandidate>;
  readonly directBlockerNodes: Map<
    CooperativeEffectFallbackReason,
    Set<Node>
  >;
  readonly blockers: Set<CooperativeEffectFallbackReason>;
}

export function collectCooperativeEffectCandidates(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): Map<Node, CooperativeEffectCandidate> {
  const candidates = new Map<Node, CooperativeEffectCandidate>();
  for (const node of program.nodesOfKinds([
    KindFunctionDeclaration,
    KindMethodDeclaration,
    KindFunctionExpression,
    KindArrowFunction,
  ])) {
    if (!isAsyncCallable(source, node)) {
      continue;
    }
    const sourceFile = source.ast.getSourceFile(node);
    if (sourceFile === undefined) {
      throw new Error("async callable candidate has no source file");
    }
    const innerType = asyncCallableInnerType(source, node);
    const candidate: CooperativeEffectCandidate = {
      declaration: node,
      sourceFile,
      ...(innerType === undefined ? {} : { innerType }),
      dependencies: new Set(),
      directBlockerNodes: new Map(),
      blockers: new Set(),
    };
    candidates.set(node, candidate);
    const parsed = parsedCallable(source, node);
    if (
      source.ast.body(node) === undefined ||
      parsed?.AsteriskToken !== undefined ||
      parsed?.FullSignature !== undefined ||
      innerType === undefined
    ) {
      blockCooperativeEffect(candidate, "incompatible-return", node);
    }
    if (
      source.ast.is.IsMethodDeclaration(node) &&
      !callableDispatchIsClosed(source, program, node)
    ) {
      blockCooperativeEffect(candidate, "open-dispatch", node);
    }
  }
  return candidates;
}

export function collectCooperativeEffectCalls(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
): ReadonlyMap<Node, CooperativeEffectCandidate> {
  const calls = new Map<Node, CooperativeEffectCandidate>();
  for (const node of program.nodesOfKind(KindCallExpression)) {
    const semantics = source.semantics.forNode(node);
    const signature = semantics.getResolvedSignature(node);
    const declaration = semantics.getSignatureDeclaration(signature);
    const candidate = declaration === undefined
      ? undefined
      : candidates.get(declaration);
    if (candidate !== undefined) {
      calls.set(node, candidate);
    }
  }
  return calls;
}

function isAsyncCallable(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  return (
    source.ast.is.IsFunctionDeclaration(node) ||
    source.ast.is.IsMethodDeclaration(node) ||
    source.ast.is.IsFunctionExpression(node) ||
    source.ast.is.IsArrowFunction(node)
  ) && source.ast.hasModifierKind(node, "async");
}

function parsedCallable(source: TargetSourceProgram, node: Node) {
  return source.ast.is.IsFunctionDeclaration(node)
    ? source.ast.as.AsFunctionDeclaration(node)
    : source.ast.is.IsMethodDeclaration(node)
    ? source.ast.as.AsMethodDeclaration(node)
    : source.ast.is.IsFunctionExpression(node)
    ? source.ast.as.AsFunctionExpression(node)
    : source.ast.as.AsArrowFunction(node);
}

function asyncCallableInnerType(
  source: TargetSourceProgram,
  node: Node,
): Type | undefined {
  const typeNode = source.ast.typeNode(node);
  if (typeNode === undefined || !source.ast.is.IsTypeReferenceNode(typeNode)) {
    return undefined;
  }
  const typeArguments = source.ast.typeArguments(typeNode);
  const innerTypeNode = typeArguments[0];
  if (typeArguments.length !== 1 || innerTypeNode === undefined) {
    return undefined;
  }
  const semantics = source.semantics.forNode(node);
  const returnType = semantics.getTypeFromTypeNode(typeNode);
  const innerType = semantics.getTypeFromTypeNode(innerTypeNode);
  if (
    returnType === undefined ||
    innerType === undefined ||
    !semantics.isTypeReference(returnType)
  ) {
    return undefined;
  }
  const selectedArguments = semantics.getTypeArguments(returnType);
  return selectedArguments.length === 1 &&
      sameSelectedType(semantics, selectedArguments[0], innerType)
    ? innerType
    : undefined;
}
