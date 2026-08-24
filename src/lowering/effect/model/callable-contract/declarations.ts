import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import { nodeHasExactSourceSemantics } from "../source-membership.js";
import { typeMaySuspend } from "../synchronous.js";
import {
  callableReturnRewrite,
  callableReturnRewriteAdmitsDirectValue,
  collectCallableResultRewrites,
  type CallableReturnRewrite,
} from "../callable-contract.js";

export function callableDeclarationAllowsSynchronousValue(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  return callableDeclarationSynchronousReturnTypes(source, declaration) !==
    undefined;
}

export function callableDeclarationSynchronousReturnTypes(
  source: TargetSourceProgram,
  declaration: Node,
): readonly CallableReturnRewrite[] | undefined {
  if (!nodeHasExactSourceSemantics(source, declaration)) {
    return undefined;
  }
  const typeNode = source.ast.typeNode(declaration);
  const rewrites: CallableReturnRewrite[] = [];
  const callable = typeNode === undefined
    ? undefined
    : collectCallableResultRewrites(source, typeNode, rewrites);
  if (callable === true && rewrites.length !== 0) {
    return Object.freeze(rewrites);
  }
  const contracts = typeNode === undefined
    ? undefined
    : exactCallableContractDeclarations(source, typeNode);
  if (contracts === undefined) {
    return undefined;
  }
  rewrites.length = 0;
  for (const contract of contracts) {
    const returnType = source.ast.typeNode(contract);
    const semantics = returnType === undefined
      ? undefined
      : source.semantics.forNode(returnType);
    const type = returnType === undefined
      ? undefined
      : semantics?.types.authoredType(returnType);
    const rewrite = returnType === undefined
      ? undefined
      : callableReturnRewrite(source, returnType);
    if (
      rewrite !== undefined &&
      callableReturnRewriteAdmitsDirectValue(source, rewrite)
    ) {
      rewrites.push(rewrite);
    } else if (
      semantics === undefined ||
      type === undefined ||
      typeMaySuspend(semantics, type)
    ) {
      return undefined;
    }
  }
  return rewrites.length === 0 ? undefined : Object.freeze(rewrites);
}

function exactCallableContractDeclarations(
  source: TargetSourceProgram,
  typeNode: Node,
): readonly Node[] | undefined {
  const semantics = source.semantics.forNode(typeNode);
  const type = semantics.types.authoredType(typeNode);
  if (
    type === undefined ||
    semantics.types.isAny(type) ||
    semantics.types.isUnknown(type)
  ) {
    return undefined;
  }
  const signatures = semantics.types.callSignatures(type);
  if (signatures.length === 0) {
    return undefined;
  }
  const declarations = new Set<Node>();
  for (const signature of signatures) {
    const declaration = semantics.declarations.signatureDeclaration(signature);
    if (
      declaration === undefined ||
      !nodeHasExactSourceSemantics(source, declaration)
    ) {
      return undefined;
    }
    declarations.add(declaration);
  }
  return Object.freeze([...declarations]);
}
