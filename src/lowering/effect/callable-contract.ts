import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api";

import { typeMaySuspend } from "./synchronous.js";

export function callableDeclarationAllowsSynchronousValue(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  const name = source.ast.name(declaration);
  const semantics = source.semantics.forNode(name ?? declaration);
  const type = semantics.getTypeAtLocation(name ?? declaration);
  return type !== undefined && callableTypeAllowsSynchronousValue(
    semantics,
    type,
    new Set(),
  );
}

function callableTypeAllowsSynchronousValue(
  semantics: SourceFileSemantics,
  type: Type,
  pending: Set<Type>,
): boolean {
  if (
    pending.has(type) ||
    semantics.isAny(type) ||
    semantics.isUnknown(type)
  ) {
    return false;
  }
  if (semantics.isNullish(type)) {
    return true;
  }
  if (semantics.isUnion(type)) {
    pending.add(type);
    let callable = false;
    for (const member of semantics.getUnionOrIntersectionTypes(type)) {
      if (member === undefined || semantics.isNullish(member)) {
        continue;
      }
      if (!callableTypeAllowsSynchronousValue(semantics, member, pending)) {
        pending.delete(type);
        return false;
      }
      callable = true;
    }
    pending.delete(type);
    return callable;
  }
  const signatures = semantics.getCallSignatures(type);
  return signatures.length !== 0 && signatures.every((signature) => {
    const returnType = semantics.getReturnTypeOfSignature(signature);
    return returnType !== undefined && returnTypeAllowsSynchronousValue(
      semantics,
      returnType,
    );
  });
}

function returnTypeAllowsSynchronousValue(
  semantics: SourceFileSemantics,
  type: Type,
): boolean {
  if (!semantics.isUnion(type)) {
    return !typeMaySuspend(semantics, type);
  }
  return semantics.getUnionOrIntersectionTypes(type).some((member) =>
    member !== undefined && !typeMaySuspend(semantics, member)
  );
}
