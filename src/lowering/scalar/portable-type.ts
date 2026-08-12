import type { Node, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  AsTypeAliasDeclaration,
  AsTypeReferenceNode,
} from "@tsonic/tsts/target-ast";

export type ScalarPrimitiveKind =
  | "bigint"
  | "boolean"
  | "number"
  | "string";

export function scalarPrimitiveKind(
  semantics: ReturnType<TargetSourceProgram["semantics"]["forNode"]>,
  type: Type,
): ScalarPrimitiveKind | undefined {
  if (semantics.isNumberLike(type)) {
    return "number";
  }
  if (semantics.isStringLike(type)) {
    return "string";
  }
  if (semantics.isBooleanLike(type)) {
    return "boolean";
  }
  return semantics.isBigIntLike(type) ? "bigint" : undefined;
}

export function portableScalarKind(
  source: TargetSourceProgram,
  authoredType: Node,
  knownKinds: Map<Node, ScalarPrimitiveKind | undefined>,
): ScalarPrimitiveKind | undefined {
  if (knownKinds.has(authoredType)) {
    return knownKinds.get(authoredType);
  }
  const visited = new Set<Node>();
  const path: Node[] = [];
  let current: Node | undefined = authoredType;
  let result: ScalarPrimitiveKind | undefined;
  while (current !== undefined) {
    if (knownKinds.has(current)) {
      result = knownKinds.get(current);
      break;
    }
    if (visited.has(current)) {
      break;
    }
    visited.add(current);
    path.push(current);
    if (source.ast.is.IsParenthesizedTypeNode(current)) {
      current = source.ast.as.AsParenthesizedTypeNode(current)?.Type;
      continue;
    }
    const keyword = primitiveKindName(source.ast.kindName(current));
    if (keyword !== undefined) {
      result = keyword;
      break;
    }
    const reference = AsTypeReferenceNode(current);
    if (
      reference === undefined ||
      (reference.TypeArguments?.Nodes.length ?? 0) !== 0
    ) {
      break;
    }
    const declaration = source.navigation.sourceReferenceFor(
      reference.TypeName,
    )?.declaration;
    if (declaration === undefined) {
      break;
    }
    const alias = AsTypeAliasDeclaration(declaration);
    if (
      alias?.Type === undefined ||
      source.ast.typeParameters(declaration).length !== 0
    ) {
      break;
    }
    current = alias.Type;
  }
  for (const node of path) {
    knownKinds.set(node, result);
  }
  return result;
}

function primitiveKindName(
  kind: string | undefined,
): ScalarPrimitiveKind | undefined {
  switch (kind) {
    case "KindBigIntKeyword":
      return "bigint";
    case "KindBooleanKeyword":
      return "boolean";
    case "KindNumberKeyword":
      return "number";
    case "KindStringKeyword":
      return "string";
    default:
      return undefined;
  }
}
