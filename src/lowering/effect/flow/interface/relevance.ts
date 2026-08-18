import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api";

import type { InterfaceContractIndex } from "./graph.js";
import {
  interfaceContractTypeDeclaration,
  isExactInterfaceProjectDeclaration,
} from "./declarations.js";

export interface InterfaceContractRelevance {
  contains(semantics: SourceFileSemantics, type: Type): boolean;
  contracts(semantics: SourceFileSemantics, type: Type): readonly Node[];
  valueContracts(semantics: SourceFileSemantics, type: Type): readonly Node[];
  directContracts(semantics: SourceFileSemantics, type: Type): readonly Node[];
}

export function createInterfaceContractRelevance(
  source: TargetSourceProgram,
  contracts: InterfaceContractIndex,
): InterfaceContractRelevance {
  let sourceFile: Node | undefined;
  let cache = new WeakMap<Type, readonly Node[]>();
  let valueCache = new WeakMap<Type, readonly Node[]>();
  const selectCache = (semantics: SourceFileSemantics) => {
    if (sourceFile !== semantics.sourceFile) {
      sourceFile = semantics.sourceFile;
      cache = new WeakMap<Type, readonly Node[]>();
      valueCache = new WeakMap<Type, readonly Node[]>();
    }
    return cache;
  };
  const selectedContracts = (
    semantics: SourceFileSemantics,
    type: Type,
  ): readonly Node[] => {
    const selected = selectCache(semantics);
    const cached = selected.get(type);
    if (cached !== undefined) {
      return cached;
    }
    const result = collectContracts(semantics, type, source, contracts);
    selected.set(type, result);
    return result;
  };
  const selectedValueContracts = (
    semantics: SourceFileSemantics,
    type: Type,
  ): readonly Node[] => {
    selectCache(semantics);
    const cached = valueCache.get(type);
    if (cached !== undefined) {
      return cached;
    }
    const result = collectValueContracts(
      semantics,
      type,
      source,
      contracts,
      selectedContracts(semantics, type),
    );
    valueCache.set(type, result);
    return result;
  };
  return Object.freeze({
    contains(semantics: SourceFileSemantics, type: Type): boolean {
      return selectedContracts(semantics, type).length !== 0;
    },
    contracts: selectedContracts,
    valueContracts(
      semantics: SourceFileSemantics,
      type: Type,
    ): readonly Node[] {
      return selectedValueContracts(semantics, type);
    },
    directContracts(semantics: SourceFileSemantics, type: Type): readonly Node[] {
      const selected = semantics.removeMissingOrUndefined(type);
      return selected === undefined
        ? noContracts
        : directTypeContracts(semantics, selected, source, contracts);
    },
  });
}

const noContracts = Object.freeze([]) as readonly Node[];
const maximumValueContractTypeCount = 4_096;

function collectContracts(
  semantics: SourceFileSemantics,
  root: Type,
  source: TargetSourceProgram,
  contracts: InterfaceContractIndex,
): readonly Node[] {
  const result = new Set<Node>();
  const pending = [root];
  const seen = new Set<Type>();
  while (pending.length !== 0) {
    const type = pending.pop();
    if (type === undefined || seen.has(type)) {
      continue;
    }
    seen.add(type);
    const selected = semantics.removeMissingOrUndefined(type);
    if (selected === undefined || isPrimitiveType(semantics, selected)) {
      continue;
    }
    for (const contract of directTypeContracts(
      semantics,
      selected,
      source,
      contracts,
    )) {
      result.add(contract);
    }
    for (const signature of semantics.getCallSignatures(selected)) {
      const declaration = semantics.getSignatureDeclaration(signature);
      if (
        declaration === undefined ||
        !isExactInterfaceProjectDeclaration(source, declaration)
      ) {
        continue;
      }
      for (const parameter of semantics.getSignatureParameters(signature)) {
        const parameterType = semantics.getTypeOfSymbol(parameter);
        if (parameterType !== undefined) {
          pending.push(parameterType);
        }
      }
      const returnType = semantics.getReturnTypeOfSignature(signature);
      if (returnType !== undefined) {
        pending.push(returnType);
      }
    }
    appendStructuralTypes(semantics, selected, pending);
  }
  return result.size === 0
    ? noContracts
    : Object.freeze([...result]);
}

function directTypeContracts(
  semantics: SourceFileSemantics,
  type: Type,
  source: TargetSourceProgram,
  contracts: InterfaceContractIndex,
): readonly Node[] {
  const declaration = interfaceContractTypeDeclaration(semantics, type);
  if (
    declaration !== undefined &&
    isExactInterfaceProjectDeclaration(source, declaration) &&
    (
      source.ast.is.IsClassDeclaration(declaration) ||
      source.ast.is.IsClassExpression(declaration)
    )
  ) {
    return contracts.declarationContracts.get(declaration) ?? noContracts;
  }
  if (
    declaration === undefined ||
    !source.ast.is.IsInterfaceDeclaration(declaration) ||
    !isExactInterfaceProjectDeclaration(source, declaration)
  ) {
    return noContracts;
  }
  const result = new Set<Node>();
  for (const property of semantics.getPropertyInfos(type)) {
    for (const member of semantics.getSymbolDeclarations(property.symbol)) {
      if (member !== undefined && contracts.entries.has(member)) {
        result.add(member);
      }
    }
  }
  return result.size === 0
    ? noContracts
    : Object.freeze([...result]);
}

function collectValueContracts(
  semantics: SourceFileSemantics,
  root: Type,
  source: TargetSourceProgram,
  contracts: InterfaceContractIndex,
  fallback: readonly Node[],
): readonly Node[] {
  const result = new Set<Node>();
  const pending = [root];
  const seen = new Set<Type>();
  while (pending.length !== 0) {
    const type = pending.pop();
    if (type === undefined || seen.has(type)) {
      continue;
    }
    if (seen.size >= maximumValueContractTypeCount) {
      return fallback;
    }
    seen.add(type);
    const selected = semantics.removeMissingOrUndefined(type);
    if (selected === undefined || isPrimitiveType(semantics, selected)) {
      continue;
    }
    for (const contract of directTypeContracts(
      semantics,
      selected,
      source,
      contracts,
    )) {
      result.add(contract);
    }
    if (semantics.isUnion(selected) || semantics.isIntersection(selected)) {
      appendTypes(pending, semantics.getUnionOrIntersectionTypes(selected));
      continue;
    }
    if (semantics.isTuple(selected)) {
      appendTypes(pending, semantics.getTupleElementTypes(selected));
      continue;
    }
    if (
      semantics.getCallSignatures(selected).length !== 0 ||
      semantics.getConstructSignatures(selected).length !== 0
    ) {
      continue;
    }
    if (semantics.isArrayLike(selected)) {
      appendTypes(pending, semantics.getTypeArguments(selected));
      appendTypes(
        pending,
        semantics.getIndexInfos(selected).map((index) => index.valueType),
      );
      continue;
    }
    appendTypes(
      pending,
      semantics.getPropertyInfos(selected).map((property) => property.type),
    );
    appendTypes(
      pending,
      semantics.getIndexInfos(selected).map((index) => index.valueType),
    );
  }
  return result.size === 0
    ? noContracts
    : Object.freeze([...result]);
}

function appendStructuralTypes(
  semantics: SourceFileSemantics,
  type: Type,
  pending: Type[],
): void {
  if (semantics.isUnion(type) || semantics.isIntersection(type)) {
    appendTypes(pending, semantics.getUnionOrIntersectionTypes(type));
  }
  if (
    semantics.isTypeReference(type) &&
    semantics.getTypeReferenceTarget(type) !== undefined
  ) {
    appendTypes(pending, semantics.getTypeArguments(type));
  }
  if (semantics.isTuple(type)) {
    appendTypes(pending, semantics.getTupleElementTypes(type));
  }
}

function appendTypes(
  pending: Type[],
  types: readonly (Type | undefined)[],
): void {
  for (const type of types) {
    if (type !== undefined) {
      pending.push(type);
    }
  }
}

function isPrimitiveType(
  semantics: SourceFileSemantics,
  type: Type,
): boolean {
  return semantics.isAny(type) ||
    semantics.isUnknown(type) ||
    semantics.isNever(type) ||
    semantics.isVoidLike(type) ||
    semantics.isNullish(type) ||
    semantics.isStringLike(type) ||
    semantics.isNumberLike(type) ||
    semantics.isBooleanLike(type) ||
    semantics.isBigIntLike(type);
}
