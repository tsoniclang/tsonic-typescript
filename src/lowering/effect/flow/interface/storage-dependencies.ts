import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";

import { resolveExactSourceInvocationContract } from "../../model/exact-source-invocation.js";
import type { StorageOwnerBoundaryDependencies } from "../storage/owner-boundaries.js";

export function createInterfaceStorageBoundaryDependencies(
  source: TargetSourceProgram,
  interfaceOwners: ReadonlySet<Node>,
): StorageOwnerBoundaryDependencies {
  return Object.freeze({
    allowsInvocation(invocation: Node): boolean {
      const resolved = resolveExactSourceInvocationContract(
        source,
        invocation,
      );
      const contract = resolved?.contract;
      const owner = contract === undefined ? undefined : source.ast.parent(contract);
      if (owner !== undefined && interfaceOwners.has(owner)) {
        return true;
      }
      const semantics = source.semantics.forNode(invocation);
      const call = semantics.operations.call(invocation);
      return call !== undefined && [
        call.sourceResultType,
        ...call.sourceArguments.map((argument) => argument.type),
        ...call.sourceArgumentBindings.flatMap((binding) => [
          binding.selectedArgumentType,
          binding.selectedParameterType,
        ]),
      ].some((type) =>
        typeContainsInterfaceOwner(
          semantics,
          type,
          interfaceOwners,
          new Set(),
        )
      );
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
  const arguments_ = semantics.types.isTypeReference(type)
    ? semantics.types.effectiveTypeArguments(type)
    : Object.freeze([]);
  if (arguments_ === undefined) {
    pending.delete(type);
    return false;
  }
  const children = [
    ...(semantics.types.isUnion(type) || semantics.types.isIntersection(type)
      ? semantics.types.unionOrIntersectionTypes(type)
      : []),
    ...arguments_,
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
