import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import { typeHasDefinitelyNonThenableContract } from "../../../thenability.js";
import {
  callableReturnRewrite,
  callableReturnRewriteAdmitsDirectValue,
  type CallableReturnRewrite,
} from "../../model/callable-contract.js";
import {
  callableUsesSynchronousTransport,
} from "../../model/synchronous.js";
import {
  sourceBodyInspectionIsExact,
  type ExactSourceBodyInspection,
} from "../../model/source-membership.js";
import { exactCallableReturnExpressions } from "../invocation/results.js";

export interface InterfaceImplementationReturnContract {
  readonly rewrites: readonly CallableReturnRewrite[];
  readonly blockers: readonly Node[];
}

export function interfaceImplementationReturnContract(
  source: TargetSourceProgram,
  declarations: readonly Node[],
  implementation: Node,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
): InterfaceImplementationReturnContract | undefined {
  const family = exactImplementationDeclarationFamily(
    source,
    declarations,
    implementation,
  );
  if (family === undefined) {
    return undefined;
  }
  const rewrites = new Map<Node, CallableReturnRewrite>();
  const blockers: Node[] = [];
  for (const declaration of family) {
    if (
      declaration === implementation ||
      callableUsesSynchronousTransport(
        source,
        declaration,
        bodyInspectionIsCertified,
      )
    ) {
      continue;
    }
    const returnType = source.ast.typeNode(declaration);
    const rewrite = returnType === undefined
      ? undefined
      : callableReturnRewrite(source, returnType);
    if (
      rewrite === undefined ||
      !callableReturnRewriteAdmitsDirectValue(source, rewrite)
    ) {
      blockers.push(declaration);
      continue;
    }
    const existing = rewrites.get(rewrite.target);
    if (
      existing !== undefined &&
      (existing.selection.kind !== rewrite.selection.kind ||
        existing.selection.index !== rewrite.selection.index)
    ) {
      blockers.push(declaration);
      continue;
    }
    rewrites.set(rewrite.target, rewrite);
  }
  return Object.freeze({
    rewrites: Object.freeze([...rewrites.values()]),
    blockers: Object.freeze(blockers),
  });
}

function exactImplementationDeclarationFamily(
  source: TargetSourceProgram,
  declarations: readonly Node[],
  implementation: Node,
): readonly Node[] | undefined {
  const name = source.ast.name(implementation);
  if (name === undefined) {
    return Object.freeze([...new Set(declarations)]);
  }
  const semantics = source.semantics.forNode(name);
  const symbol = source.navigation.sourceReferenceFor(name)?.symbol;
  if (symbol === undefined) {
    return undefined;
  }
  const family = [
    ...declarations,
    semantics.declarations.primarySymbolDeclaration(symbol),
    ...semantics.declarations.symbolDeclarations(symbol),
  ].filter((declaration): declaration is Node => declaration !== undefined);
  const selected = Object.freeze([...new Set(family)]);
  return selected.includes(implementation) ? selected : undefined;
}

export function interfaceImplementationUsesSynchronousTransport(
  source: TargetSourceProgram,
  declaration: Node,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
): boolean {
  if (
    callableUsesSynchronousTransport(
      source,
      declaration,
      bodyInspectionIsCertified,
    )
  ) {
    return true;
  }
  if (
    source.ast.hasModifierKind(declaration, "async") ||
    !sourceBodyInspectionIsExact(
      source,
      declaration,
      bodyInspectionIsCertified,
    )
  ) {
    return false;
  }
  const returned = exactCallableReturnExpressions(source, declaration);
  return returned !== undefined && returned.every((expression) => {
    if (expression === undefined) {
      return true;
    }
    const semantics = source.semantics.forNode(expression);
    const type = semantics.types.expressionType(expression);
    return type !== undefined && typeHasDefinitelyNonThenableContract(
      source,
      semantics,
      type,
    );
  });
}
