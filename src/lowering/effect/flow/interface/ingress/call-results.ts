import type { Node } from "@tsonic/tsts";

import { callableDispatchIsClosed } from "../../../model/syntax.js";
import { resolveProjectInvocation } from "../../../model/project-invocation.js";
import { exactCallableReturnExpressions } from "../../invocation/results.js";
import { exactSourceCallInputsForDeclaration } from "../../invocation/call-binding.js";
import { transparentExpression } from "../../../model/syntax.js";
import type { InterfaceContractIngress } from "../ingress.js";

export function exactInterfaceCallResultOrigins(
  call: Node,
  ingress: InterfaceContractIngress,
): readonly Node[] | undefined {
  const direct = resolveProjectInvocation(ingress.source, call)?.implementation;
  const semantics = ingress.source.semantics.forNode(call);
  const signature = semantics.operations.call(call)?.selectedSignature;
  const contract = signature === undefined
    ? undefined
    : semantics.declarations.signatureDeclaration(signature);
  const indirect = direct === undefined
    ? ingress.exactCallImplementations?.(call)
    : undefined;
  const implementations = direct === undefined && indirect !== undefined
    ? indirect
    : direct === undefined && contract !== undefined &&
      ingress.entries.has(contract)
    ? ingress.implementations.implementationsFor(contract)
    : direct === undefined
    ? []
    : [direct];
  if (implementations.length === 0) {
    return undefined;
  }
  const origins: Node[] = [];
  for (const implementation of implementations) {
    if (
      !ingress.source.navigation.isProjectDeclaration(implementation) ||
      !callableDispatchIsClosed(
        ingress.source,
        ingress.program,
        implementation,
      )
    ) {
      return undefined;
    }
    const returned = exactCallableReturnExpressions(
      ingress.source,
      implementation,
    );
    if (
      returned === undefined ||
      returned.length === 0 ||
      returned.some((expression) => expression === undefined)
    ) {
      return undefined;
    }
    const inputs = exactSourceCallInputsForDeclaration(
      ingress.source,
      call,
      implementation,
      ingress.aggregateProjections,
    );
    if (inputs === undefined) {
      return undefined;
    }
    for (const expression of returned) {
      if (expression === undefined) {
        return undefined;
      }
      const root = transparentExpression(ingress.source, expression);
      const reference = root !== undefined &&
          ingress.source.ast.is.IsIdentifier(root)
        ? ingress.source.navigation.sourceReferenceFor(root)
        : undefined;
      const substituted = reference?.project === true &&
          ingress.source.ast.is.IsParameterDeclaration(reference.declaration)
        ? inputs.inputs.get(reference.declaration)
        : undefined;
      if (substituted === undefined) {
        origins.push(expression);
      } else {
        origins.push(...substituted);
      }
    }
  }
  return Object.freeze([...new Set(origins)]);
}
