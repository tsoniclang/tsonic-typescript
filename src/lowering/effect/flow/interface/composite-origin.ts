import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

export interface CompositeValueAlternative {
  readonly expression: Node;
  readonly role: "value" | "container" | "same";
}

export type CompositeValueAlternatives =
  | readonly CompositeValueAlternative[]
  | null
  | undefined;

export function compositeValueAlternatives(
  source: TargetSourceProgram,
  expression: Node,
): CompositeValueAlternatives {
  if (source.ast.is.IsArrayLiteralExpression(expression)) {
    const elements = source.ast.elements(expression);
    const result: CompositeValueAlternative[] = [];
    for (const element of elements) {
      if (element === undefined) {
        return null;
      }
      if (source.ast.is.IsSpreadElement(element)) {
        const spread = source.ast.as.AsSpreadElement(element)?.Expression;
        if (spread === undefined) {
          return null;
        }
        result.push({ expression: spread, role: "container" });
      } else {
        result.push({ expression: element, role: "value" });
      }
    }
    return Object.freeze(result);
  }
  if (source.ast.is.IsObjectLiteralExpression(expression)) {
    return objectLiteralValueExpressions(source, expression);
  }
  if (source.ast.is.IsConditionalExpression(expression)) {
    const conditional = source.ast.as.AsConditionalExpression(expression);
    return conditional?.WhenTrue === undefined ||
        conditional.WhenFalse === undefined
      ? null
      : Object.freeze([
        { expression: conditional.WhenTrue, role: "same" as const },
        { expression: conditional.WhenFalse, role: "same" as const },
      ]);
  }
  if (!source.ast.is.IsBinaryExpression(expression)) {
    return undefined;
  }
  const binary = source.ast.as.AsBinaryExpression(expression);
  if (binary?.Left === undefined || binary.Right === undefined) {
    return null;
  }
  switch (source.ast.operatorKindName(expression)) {
    case "KindQuestionQuestionToken":
    case "KindBarBarToken":
    case "KindAmpersandAmpersandToken":
      return Object.freeze([
        { expression: binary.Left, role: "same" as const },
        { expression: binary.Right, role: "same" as const },
      ]);
    case "KindCommaToken":
    case "KindEqualsToken":
      return Object.freeze([
        { expression: binary.Right, role: "same" as const },
      ]);
    default:
      return null;
  }
}

function objectLiteralValueExpressions(
  source: TargetSourceProgram,
  expression: Node,
): readonly CompositeValueAlternative[] | null {
  const result: CompositeValueAlternative[] = [];
  for (const property of source.ast.properties(expression)) {
    if (property === undefined) {
      return null;
    }
    if (source.ast.is.IsPropertyAssignment(property)) {
      const initializer = source.ast.as.AsPropertyAssignment(property)
        ?.Initializer;
      if (initializer === undefined) {
        return null;
      }
      result.push({ expression: initializer, role: "value" });
      continue;
    }
    if (source.ast.is.IsShorthandPropertyAssignment(property)) {
      const name = source.ast.name(property);
      if (name === undefined) {
        return null;
      }
      result.push({ expression: name, role: "value" });
      continue;
    }
    if (source.ast.is.IsSpreadAssignment(property)) {
      const spread = source.ast.as.AsSpreadAssignment(property)?.Expression;
      if (spread === undefined) {
        return null;
      }
      result.push({ expression: spread, role: "container" });
      continue;
    }
    if (
      source.ast.is.IsMethodDeclaration(property) ||
      source.ast.is.IsGetAccessorDeclaration(property) ||
      source.ast.is.IsSetAccessorDeclaration(property)
    ) {
      continue;
    }
    return null;
  }
  return Object.freeze(result);
}
