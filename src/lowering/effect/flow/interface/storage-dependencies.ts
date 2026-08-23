import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";

import { resolveProjectInvocationContract } from "../../model/project-invocation.js";
import type { StorageOwnerBoundaryDependencies } from "../storage/owner-boundaries.js";

export function createInterfaceStorageBoundaryDependencies(
  source: TargetSourceProgram,
  interfaceOwners: ReadonlySet<Node>,
): StorageOwnerBoundaryDependencies {
  return Object.freeze({
    allowsInvocation(invocation: Node): boolean {
      const contract = resolveProjectInvocationContract(source, invocation)?.contract;
      const owner = contract === undefined ? undefined : source.ast.parent(contract);
      return owner !== undefined && interfaceOwners.has(owner);
    },
    allowsContextualValue(value: Node): boolean {
      const semantics = source.semantics.forNode(value);
      const selection = semantics.types.contextualValueSelection(value);
      return selection.kind === "selected" && typeContainsInterfaceOwner(
        semantics,
        selection.type,
        interfaceOwners,
        new Set(),
      );
    },
    allowsModuleForwardingReference(): boolean {
      return false;
    },
  });
}

function typeContainsInterfaceOwner(
  semantics: SourceFileSemantics,
  type: Type,
  interfaceOwners: ReadonlySet<Node>,
  pending: Set<Type>,
): boolean {
  if (pending.has(type)) {
    return false;
  }
  pending.add(type);
  for (const symbol of [
    semantics.declarations.typeSymbol(type),
    semantics.declarations.typeAliasSymbol(type),
  ]) {
    const declaration = symbol === undefined
      ? undefined
      : semantics.declarations.primarySymbolDeclaration(symbol);
    if (declaration !== undefined && interfaceOwners.has(declaration)) {
      pending.delete(type);
      return true;
    }
  }
  const target = semantics.types.isTypeReference(type)
    ? semantics.types.typeReferenceTarget(type)
    : undefined;
  const children = [
    ...(semantics.types.isUnion(type) || semantics.types.isIntersection(type)
      ? semantics.types.unionOrIntersectionTypes(type)
      : []),
    ...(semantics.types.isTypeReference(type)
      ? semantics.types.typeArguments(type)
      : []),
    ...(target === undefined ? [] : [target]),
  ];
  const result = children.some((child) =>
    child !== undefined && typeContainsInterfaceOwner(
      semantics,
      child,
      interfaceOwners,
      pending,
    )
  );
  pending.delete(type);
  return result;
}
