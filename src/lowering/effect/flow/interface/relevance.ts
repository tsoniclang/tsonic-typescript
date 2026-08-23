import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";

import type { InterfaceContractIndex } from "./graph.js";
import {
  interfaceContractTypeDeclaration,
  isExactInterfaceProjectDeclaration,
} from "./declarations.js";
import {
  createTransitivePredicateIndex,
  type TransitivePredicateExpansion,
  type TransitivePredicateIndex,
} from "./relevance/transitive-predicate.js";

export interface InterfaceContractRelevance {
  contains(semantics: SourceFileSemantics, type: Type): boolean;
  contracts(semantics: SourceFileSemantics, type: Type): readonly Node[];
  valueContracts(semantics: SourceFileSemantics, type: Type): readonly Node[];
  directContracts(semantics: SourceFileSemantics, type: Type): readonly Node[];
}

interface InterfaceContractRelevanceCache {
  readonly contains: TransitivePredicateIndex<Type>;
  readonly contracts: WeakMap<Type, readonly Node[]>;
  readonly directContracts: WeakMap<Type, readonly Node[]>;
  readonly valueContracts: WeakMap<Type, readonly Node[]>;
}

export function createInterfaceContractRelevance(
  source: TargetSourceProgram,
  contracts: InterfaceContractIndex,
): InterfaceContractRelevance {
  const caches = new WeakMap<Node, InterfaceContractRelevanceCache>();
  const cacheFor = (
    semantics: SourceFileSemantics,
  ): InterfaceContractRelevanceCache => {
    let selected = caches.get(semantics.sourceFile);
    if (selected === undefined) {
      const directContracts = new WeakMap<Type, readonly Node[]>();
      selected = {
        contains: createTransitivePredicateIndex((type) =>
          contractPredicateExpansion(
            semantics,
            type,
            source,
            contracts,
            directContracts,
          )
        ),
        contracts: new WeakMap<Type, readonly Node[]>(),
        directContracts,
        valueContracts: new WeakMap<Type, readonly Node[]>(),
      };
      caches.set(semantics.sourceFile, selected);
    }
    return selected;
  };
  const selectedContracts = (
    semantics: SourceFileSemantics,
    type: Type,
  ): readonly Node[] => {
    const cache = cacheFor(semantics);
    const existing = cache.contracts.get(type);
    if (existing !== undefined) {
      return existing;
    }
    const result = collectContracts(
      semantics,
      type,
      source,
      contracts,
      cache.directContracts,
    );
    cache.contracts.set(type, result);
    return result;
  };
  const selectedValueContracts = (
    semantics: SourceFileSemantics,
    type: Type,
  ): readonly Node[] => {
    const selected = cacheFor(semantics).valueContracts;
    const cached = selected.get(type);
    if (cached !== undefined) {
      return cached;
    }
    const result = collectValueContracts(
      semantics,
      type,
      source,
      contracts,
      selectedContracts(semantics, type),
      cacheFor(semantics).directContracts,
    );
    selected.set(type, result);
    return result;
  };
  return Object.freeze({
    contains(semantics: SourceFileSemantics, type: Type): boolean {
      return cacheFor(semantics).contains.matches(type);
    },
    contracts: selectedContracts,
    valueContracts(
      semantics: SourceFileSemantics,
      type: Type,
    ): readonly Node[] {
      return selectedValueContracts(semantics, type);
    },
    directContracts(semantics: SourceFileSemantics, type: Type): readonly Node[] {
      return cachedDirectTypeContracts(
        semantics,
        type,
        source,
        contracts,
        cacheFor(semantics).directContracts,
      );
    },
  });
}

const noContracts = Object.freeze([]) as readonly Node[];
const noTypes = Object.freeze([]) as readonly Type[];
const maximumValueContractTypeCount = 4_096;

function contractPredicateExpansion(
  semantics: SourceFileSemantics,
  type: Type,
  source: TargetSourceProgram,
  contracts: InterfaceContractIndex,
  directContracts: WeakMap<Type, readonly Node[]>,
): TransitivePredicateExpansion<Type> {
  const selected = semantics.types.withoutMissingOrUndefined(type);
  if (selected === undefined || isPrimitiveType(semantics, selected)) {
    return { matches: false, dependencies: noTypes };
  }
  if (
    cachedDirectTypeContracts(
      semantics,
      selected,
      source,
      contracts,
      directContracts,
    ).length !== 0
  ) {
    return { matches: true, dependencies: noTypes };
  }
  const dependencies: Type[] = [];
  for (const signature of semantics.types.callSignatures(selected)) {
    const declaration = semantics.declarations.signatureDeclaration(signature);
    if (
      declaration === undefined ||
      !isExactInterfaceProjectDeclaration(source, declaration)
    ) {
      continue;
    }
    for (const parameter of semantics.declarations.signatureParameters(signature)) {
      const parameterType = semantics.types.typeOfSymbol(parameter);
      if (parameterType !== undefined) {
        dependencies.push(parameterType);
      }
    }
    const returnType = semantics.types.returnType(signature);
    if (returnType !== undefined) {
      dependencies.push(returnType);
    }
  }
  appendStructuralTypes(semantics, selected, dependencies);
  return {
    matches: false,
    dependencies: dependencies.length === 0
      ? noTypes
      : Object.freeze(dependencies),
  };
}

function collectContracts(
  semantics: SourceFileSemantics,
  root: Type,
  source: TargetSourceProgram,
  contracts: InterfaceContractIndex,
  directContracts: WeakMap<Type, readonly Node[]>,
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
    const selected = semantics.types.withoutMissingOrUndefined(type);
    if (selected === undefined || isPrimitiveType(semantics, selected)) {
      continue;
    }
    for (const contract of cachedDirectTypeContracts(
      semantics,
      selected,
      source,
      contracts,
      directContracts,
    )) {
      result.add(contract);
    }
    for (const signature of semantics.types.callSignatures(selected)) {
      const declaration = semantics.declarations.signatureDeclaration(signature);
      if (
        declaration === undefined ||
        !isExactInterfaceProjectDeclaration(source, declaration)
      ) {
        continue;
      }
      for (const parameter of semantics.declarations.signatureParameters(signature)) {
        const parameterType = semantics.types.typeOfSymbol(parameter);
        if (parameterType !== undefined) {
          pending.push(parameterType);
        }
      }
      const returnType = semantics.types.returnType(signature);
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

function cachedDirectTypeContracts(
  semantics: SourceFileSemantics,
  type: Type,
  source: TargetSourceProgram,
  contracts: InterfaceContractIndex,
  cache: WeakMap<Type, readonly Node[]>,
): readonly Node[] {
  const selected = semantics.types.withoutMissingOrUndefined(type);
  if (selected === undefined) {
    return noContracts;
  }
  const existing = cache.get(selected);
  if (existing !== undefined) {
    return existing;
  }
  const result = directTypeContracts(semantics, selected, source, contracts);
  cache.set(selected, result);
  return result;
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
  for (const property of semantics.types.propertyInfos(type)) {
    for (const member of semantics.declarations.symbolDeclarations(property.symbol)) {
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
  directContracts: WeakMap<Type, readonly Node[]>,
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
    const selected = semantics.types.withoutMissingOrUndefined(type);
    if (selected === undefined || isPrimitiveType(semantics, selected)) {
      continue;
    }
    for (const contract of cachedDirectTypeContracts(
      semantics,
      selected,
      source,
      contracts,
      directContracts,
    )) {
      result.add(contract);
    }
    if (semantics.types.isUnion(selected) || semantics.types.isIntersection(selected)) {
      appendTypes(pending, semantics.types.unionOrIntersectionTypes(selected));
      continue;
    }
    if (semantics.types.isTuple(selected)) {
      appendTypes(pending, semantics.types.tupleElementTypes(selected));
      continue;
    }
    if (
      semantics.types.callSignatures(selected).length !== 0 ||
      semantics.types.constructSignatures(selected).length !== 0
    ) {
      continue;
    }
    if (semantics.types.isArrayLike(selected)) {
      appendTypes(pending, semantics.types.typeArguments(selected));
      appendTypes(
        pending,
        semantics.types.indexInfos(selected).map((index) => index.valueType),
      );
      continue;
    }
    appendTypes(
      pending,
      semantics.types.propertyInfos(selected).map((property) => property.type),
    );
    appendTypes(
      pending,
      semantics.types.indexInfos(selected).map((index) => index.valueType),
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
  if (semantics.types.isUnion(type) || semantics.types.isIntersection(type)) {
    appendTypes(pending, semantics.types.unionOrIntersectionTypes(type));
  }
  if (
    semantics.types.isTypeReference(type) &&
    semantics.types.typeReferenceTarget(type) !== undefined
  ) {
    appendTypes(pending, semantics.types.typeArguments(type));
  }
  if (semantics.types.isTuple(type)) {
    appendTypes(pending, semantics.types.tupleElementTypes(type));
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
  return semantics.types.isAny(type) ||
    semantics.types.isUnknown(type) ||
    semantics.types.isNever(type) ||
    semantics.types.isVoidLike(type) ||
    semantics.types.isNullish(type) ||
    semantics.types.isStringLike(type) ||
    semantics.types.isNumberLike(type) ||
    semantics.types.isBooleanLike(type) ||
    semantics.types.isBigIntLike(type);
}
