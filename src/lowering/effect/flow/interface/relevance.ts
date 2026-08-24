import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";

import type { InterfaceContractIndex } from "./graph.js";
import {
  interfaceContractTypeDeclaration,
  isExactInterfaceSourceDeclaration,
} from "./declarations.js";
import type { ExactSourceBodyInspection } from "../../model/source-membership.js";
import {
  createTransitivePredicateIndex,
  type TransitivePredicateExpansion,
  type TransitivePredicateIndex,
} from "./relevance/transitive-predicate.js";

export interface InterfaceContractRelevance {
  contains(semantics: SourceFileSemantics, type: Type): boolean;
  contracts(semantics: SourceFileSemantics, type: Type): readonly Node[];
  valueContracts(semantics: SourceFileSemantics, type: Type): readonly Node[];
  valueImplementationContracts(
    semantics: SourceFileSemantics,
    type: Type,
  ): readonly Node[];
  directContracts(semantics: SourceFileSemantics, type: Type): readonly Node[];
  measurements(): InterfaceContractRelevanceMeasurements;
}

export interface InterfaceContractRelevanceMeasurements {
  readonly containsQueries: number;
  readonly containsExpansions: number;
  readonly contractQueries: number;
  readonly contractExpansions: number;
  readonly valueQueries: number;
  readonly valueExpansions: number;
}

interface InterfaceContractRelevanceCache {
  readonly contains: TransitivePredicateIndex<Type>;
  readonly contracts: WeakMap<Type, readonly Node[]>;
  readonly directContracts: WeakMap<Type, readonly Node[]>;
  readonly implementationContracts: WeakMap<Type, readonly Node[]>;
  readonly valueContracts: WeakMap<Type, readonly Node[]>;
}

export function createInterfaceContractRelevance(
  source: TargetSourceProgram,
  contracts: InterfaceContractIndex,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
): InterfaceContractRelevance {
  let containsQueries = 0;
  let containsExpansions = 0;
  let contractQueries = 0;
  let contractExpansions = 0;
  let valueQueries = 0;
  let valueExpansions = 0;
  const caches = new WeakMap<Node, InterfaceContractRelevanceCache>();
  const cacheFor = (
    semantics: SourceFileSemantics,
  ): InterfaceContractRelevanceCache => {
    let selected = caches.get(semantics.sourceFile);
    if (selected === undefined) {
      const directContracts = new WeakMap<Type, readonly Node[]>();
      selected = {
        contains: createTransitivePredicateIndex((type) => {
          containsExpansions += 1;
          return contractPredicateExpansion(
            semantics,
            type,
            source,
            contracts,
            directContracts,
            bodyInspectionIsCertified,
          );
        }),
        contracts: new WeakMap<Type, readonly Node[]>(),
        directContracts,
        implementationContracts: new WeakMap<Type, readonly Node[]>(),
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
    contractQueries += 1;
    const cache = cacheFor(semantics);
    const existing = cache.contracts.get(type);
    if (existing !== undefined) {
      return existing;
    }
    contractExpansions += 1;
    const result = collectContracts(
      semantics,
      type,
      source,
      contracts,
      cache.directContracts,
      bodyInspectionIsCertified,
    );
    cache.contracts.set(type, result);
    return result;
  };
  const selectedValueContracts = (
    semantics: SourceFileSemantics,
    type: Type,
  ): readonly Node[] => {
    valueQueries += 1;
    const selected = cacheFor(semantics).valueContracts;
    const cached = selected.get(type);
    if (cached !== undefined) {
      return cached;
    }
    valueExpansions += 1;
    const result = collectValueContracts(
      semantics,
      type,
      source,
      contracts,
      selectedContracts(semantics, type),
      cacheFor(semantics).directContracts,
      bodyInspectionIsCertified,
    );
    selected.set(type, result);
    return result;
  };
  return Object.freeze({
    contains(semantics: SourceFileSemantics, type: Type): boolean {
      containsQueries += 1;
      return cacheFor(semantics).contains.matches(type);
    },
    contracts: selectedContracts,
    valueContracts(
      semantics: SourceFileSemantics,
      type: Type,
    ): readonly Node[] {
      return selectedValueContracts(semantics, type);
    },
    valueImplementationContracts(
      semantics: SourceFileSemantics,
      type: Type,
    ): readonly Node[] {
      const cache = cacheFor(semantics);
      const existing = cache.implementationContracts.get(type);
      if (existing !== undefined) {
        return existing;
      }
      const result = collectValueImplementationContracts(
        semantics,
        type,
        source,
        contracts,
        cache.directContracts,
        bodyInspectionIsCertified,
      );
      cache.implementationContracts.set(type, result);
      return result;
    },
    directContracts(semantics: SourceFileSemantics, type: Type): readonly Node[] {
      return cachedDirectTypeContracts(
        semantics,
        type,
        source,
        contracts,
        cacheFor(semantics).directContracts,
        bodyInspectionIsCertified,
      );
    },
    measurements(): InterfaceContractRelevanceMeasurements {
      return Object.freeze({
        containsQueries,
        containsExpansions,
        contractQueries,
        contractExpansions,
        valueQueries,
        valueExpansions,
      });
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
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
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
      bodyInspectionIsCertified,
    ).length !== 0
  ) {
    return { matches: true, dependencies: noTypes };
  }
  const dependencies: Type[] = [];
  for (const signature of semantics.types.callSignatures(selected)) {
    const declaration = semantics.declarations.signatureDeclaration(signature);
    if (
      declaration === undefined ||
      !isExactInterfaceSourceDeclaration(
        source,
        declaration,
        bodyInspectionIsCertified,
      )
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
  if (!appendStructuralTypes(semantics, selected, dependencies)) {
    return { matches: true, dependencies: noTypes };
  }
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
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
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
      bodyInspectionIsCertified,
    )) {
      result.add(contract);
    }
    for (const signature of semantics.types.callSignatures(selected)) {
      const declaration = semantics.declarations.signatureDeclaration(signature);
      if (
        declaration === undefined ||
        !isExactInterfaceSourceDeclaration(
          source,
          declaration,
          bodyInspectionIsCertified,
        )
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
    if (!appendStructuralTypes(semantics, selected, pending)) {
      for (const contract of contracts.entries.keys()) {
        result.add(contract);
      }
    }
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
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
): readonly Node[] {
  const selected = semantics.types.withoutMissingOrUndefined(type);
  if (selected === undefined) {
    return noContracts;
  }
  const existing = cache.get(selected);
  if (existing !== undefined) {
    return existing;
  }
  const result = directTypeContracts(
    semantics,
    selected,
    source,
    contracts,
    bodyInspectionIsCertified,
  );
  cache.set(selected, result);
  return result;
}

function directTypeContracts(
  semantics: SourceFileSemantics,
  type: Type,
  source: TargetSourceProgram,
  contracts: InterfaceContractIndex,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
): readonly Node[] {
  const declaration = interfaceContractTypeDeclaration(semantics, type);
  if (
    declaration !== undefined &&
    isExactInterfaceSourceDeclaration(
      source,
      declaration,
      bodyInspectionIsCertified,
    ) &&
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
    !isExactInterfaceSourceDeclaration(
      source,
      declaration,
      bodyInspectionIsCertified,
    )
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
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
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
      bodyInspectionIsCertified,
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
      const arguments_ = semantics.types.effectiveTypeArguments(selected);
      if (arguments_ === undefined) {
        return fallback;
      }
      appendTypes(pending, arguments_);
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

function collectValueImplementationContracts(
  semantics: SourceFileSemantics,
  root: Type,
  source: TargetSourceProgram,
  contracts: InterfaceContractIndex,
  directContracts: WeakMap<Type, readonly Node[]>,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
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
    if (semantics.types.isUnion(selected) || semantics.types.isIntersection(selected)) {
      appendTypes(pending, semantics.types.unionOrIntersectionTypes(selected));
      continue;
    }
    for (const contract of cachedDirectTypeContracts(
      semantics,
      selected,
      source,
      contracts,
      directContracts,
      bodyInspectionIsCertified,
    )) {
      result.add(contract);
    }
  }
  return result.size === 0 ? noContracts : Object.freeze([...result]);
}

function appendStructuralTypes(
  semantics: SourceFileSemantics,
  type: Type,
  pending: Type[],
): boolean {
  if (semantics.types.isUnion(type) || semantics.types.isIntersection(type)) {
    appendTypes(pending, semantics.types.unionOrIntersectionTypes(type));
  }
  if (
    semantics.types.isTypeReference(type) &&
    semantics.types.typeReferenceTarget(type) !== undefined
  ) {
    const arguments_ = semantics.types.effectiveTypeArguments(type);
    if (arguments_ === undefined) {
      return false;
    }
    appendTypes(pending, arguments_);
  }
  if (semantics.types.isTuple(type)) {
    appendTypes(pending, semantics.types.tupleElementTypes(type));
  }
  appendTypes(
    pending,
    semantics.types.propertyInfos(type).map((property) => property.type),
  );
  appendTypes(
    pending,
    semantics.types.indexInfos(type).map((index) => index.valueType),
  );
  return true;
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
