import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

export interface InvocationTransport {
  readonly inputExpressions: readonly Node[];
  readonly resultOriginExpressions?: readonly Node[];
}

export interface InvocationTransportContract {
  transportFor(call: Node): InvocationTransport | undefined;
}

export function isInvocationTransportInput(
  source: TargetSourceProgram,
  reference: Node,
  contract: InvocationTransportContract | undefined,
): boolean {
  if (contract === undefined) {
    return false;
  }
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return false;
    }
    if (isTransparentInputParent(source, parent, current)) {
      current = parent;
      continue;
    }
    if (
      !source.ast.is.IsCallExpression(parent) &&
      !source.ast.is.IsNewExpression(parent)
    ) {
      return false;
    }
    return contract.transportFor(parent)?.inputExpressions.includes(current) === true;
  }
}

function isTransparentInputParent(
  source: TargetSourceProgram,
  parent: Node,
  child: Node,
): boolean {
  if (source.ast.is.IsParenthesizedExpression(parent)) {
    return source.ast.as.AsParenthesizedExpression(parent)?.Expression === child;
  }
  if (source.ast.is.IsAsExpression(parent)) {
    return source.ast.as.AsAsExpression(parent)?.Expression === child;
  }
  if (source.ast.is.IsTypeAssertion(parent)) {
    return source.ast.as.AsTypeAssertion(parent)?.Expression === child;
  }
  if (source.ast.is.IsSatisfiesExpression(parent)) {
    return source.ast.as.AsSatisfiesExpression(parent)?.Expression === child;
  }
  return source.ast.is.IsNonNullExpression(parent) &&
    source.ast.as.AsNonNullExpression(parent)?.Expression === child;
}

export function composeInvocationTransportContracts(
  contracts: readonly (InvocationTransportContract | undefined)[],
): InvocationTransportContract | undefined {
  const selected = contracts.filter(
    (contract): contract is InvocationTransportContract =>
      contract !== undefined,
  );
  if (selected.length === 0) {
    return undefined;
  }
  if (selected.length === 1) {
    return selected[0];
  }
  return Object.freeze({
    transportFor(call: Node): InvocationTransport | undefined {
      let result: InvocationTransport | undefined;
      for (const contract of selected) {
        const candidate = contract.transportFor(call);
        if (candidate === undefined) {
          continue;
        }
        if (result !== undefined) {
          throw new Error(
            "invocation transport has multiple semantic owners",
          );
        }
        result = candidate;
      }
      return result;
    },
  });
}
