import type { Node } from "@tsonic/tsts";

import { callableDispatchIsClosed } from "../../../model/syntax.js";
import { resolveExactSourceInvocation } from "../../../model/exact-source-invocation.js";
import { exactCallableReturnExpressions } from "../../invocation/results.js";
import { exactSourceCallInputsForDeclaration } from "../../invocation/call-binding.js";
import type { InterfaceContractIngress } from "../ingress.js";
import { sourceBodyInspectionIsExact } from "../../../model/source-membership.js";
import { exactCallSpecificResultOrigins } from "./call-result-origin.js";

export function exactInterfaceCallResultOrigins(
  call: Node,
  ingress: InterfaceContractIngress,
): readonly Node[] | undefined {
  const direct = resolveExactSourceInvocation(
    ingress.source,
    call,
    ingress.bodyInspectionIsCertified,
  )?.implementation;
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
      !sourceBodyInspectionIsExact(
        ingress.source,
        implementation,
        ingress.bodyInspectionIsCertified,
      ) ||
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
    const selectedOrigins = exactCallSpecificResultOrigins(
      ingress.source,
      ingress.program,
      implementation,
      returned.filter((expression): expression is Node =>
        expression !== undefined
      ),
      inputs,
      ingress.bodyInspectionIsCertified,
    );
    if (selectedOrigins === undefined) {
      return undefined;
    }
    origins.push(...selectedOrigins);
  }
  return Object.freeze([...new Set(origins)]);
}
