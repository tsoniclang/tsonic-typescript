import type {
  Node,
  Type,
  TypeIndexInfo,
  TypePropertyInfo,
} from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api";

import { typeHasTrustedSynchronousCallSignatures } from "../../../model/synchronous.js";
import {
  interfaceContractsForProperty,
} from "../declarations.js";
import { linkInterfaceContracts } from "../graph.js";
import {
  indexCoversProperty,
  indexDomainCovers,
} from "../index-domain.js";
import {
  type InterfaceContractTypePairEnqueue,
  type InterfaceContractTypePairState,
  markContractBoundaries,
  markInterfaceContractsExposed,
  markNestedTypeMismatch,
} from "./state.js";

export function pairObjectMembers(
  semantics: SourceFileSemantics,
  sourceType: Type,
  targetType: Type,
  sourceDeclaration: Node | undefined,
  targetDeclaration: Node | undefined,
  state: InterfaceContractTypePairState,
  enqueue: InterfaceContractTypePairEnqueue,
): void {
  const sourceProperties = new Map(
    semantics.getPropertyInfos(sourceType).map((property) => [
      property.name,
      property,
    ]),
  );
  const sourceIndexes = semantics.getIndexInfos(sourceType);
  for (const targetProperty of semantics.getPropertyInfos(targetType)) {
    const sourceProperty = sourceProperties.get(targetProperty.name);
    if (sourceProperty === undefined) {
      pairMissingProperty(
        semantics,
        sourceType,
        targetProperty,
        targetDeclaration,
        sourceIndexes,
        state,
        enqueue,
      );
      continue;
    }
    pairProperty(
      semantics,
      sourceType,
      targetType,
      sourceProperty,
      targetProperty,
      sourceDeclaration,
      targetDeclaration,
      state,
      enqueue,
    );
  }
  pairIndexMembers(
    semantics,
    sourceType,
    targetType,
    [...sourceProperties.values()],
    sourceIndexes,
    semantics.getIndexInfos(targetType),
    state,
    enqueue,
  );
}

function pairProperty(
  semantics: SourceFileSemantics,
  sourceType: Type,
  targetType: Type,
  sourceProperty: TypePropertyInfo,
  targetProperty: TypePropertyInfo,
  sourceDeclaration: Node | undefined,
  targetDeclaration: Node | undefined,
  state: InterfaceContractTypePairState,
  enqueue: InterfaceContractTypePairEnqueue,
): void {
  const targetContracts = propertyContracts(
    semantics,
    targetProperty,
    targetDeclaration,
    state,
  );
  if (sourceProperty.optional && !targetProperty.optional) {
    markContractBoundaries(
      state,
      targetContracts,
      "missing-transport-member",
    );
    markInterfaceContractsExposed(
      semantics,
      targetProperty.type,
      state,
      "missing-transport-member",
    );
    return;
  }
  const sourceContracts = propertyContracts(
    semantics,
    sourceProperty,
    sourceDeclaration,
    state,
  );
  const exactImplicitImplementation = sourceContracts.length === 0 &&
    targetContracts.length !== 0 &&
    state.contracts.implementations.recordTypeImplementations(
      semantics,
      sourceType,
      targetContracts,
    );
  const exactReverseImplicitImplementation = sourceContracts.length !== 0 &&
    targetContracts.length === 0 &&
    state.contracts.implementations.recordTypeImplementations(
      semantics,
      targetType,
      sourceContracts,
    );
  if (sourceContracts.length !== 0 && targetContracts.length !== 0) {
    for (const sourceContract of sourceContracts) {
      for (const targetContract of targetContracts) {
        linkInterfaceContracts(
          sourceContract,
          targetContract,
          state.contracts.links,
        );
      }
    }
  } else if (
    sourceContracts.length !== 0 &&
    !exactReverseImplicitImplementation &&
    !typeHasTrustedSynchronousCallSignatures(
      state.source,
      semantics,
      targetProperty.type,
    )
  ) {
    markContractBoundaries(
      state,
      sourceContracts,
      "untrusted-callable-member",
    );
    markInterfaceContractsExposed(
      semantics,
      sourceProperty.type,
      state,
      "untrusted-callable-member",
    );
    return;
  } else if (
    targetContracts.length !== 0 &&
    !exactImplicitImplementation &&
    !typeHasTrustedSynchronousCallSignatures(
      state.source,
      semantics,
      sourceProperty.type,
    )
  ) {
    markContractBoundaries(
      state,
      targetContracts,
      "untrusted-callable-member",
    );
    markInterfaceContractsExposed(
      semantics,
      targetProperty.type,
      state,
      "untrusted-callable-member",
    );
    return;
  }
  enqueue(
    semantics,
    sourceProperty.type,
    targetProperty.type,
    state,
  );
}

function pairMissingProperty(
  semantics: SourceFileSemantics,
  sourceType: Type,
  targetProperty: TypePropertyInfo,
  targetDeclaration: Node | undefined,
  sourceIndexes: readonly TypeIndexInfo[],
  state: InterfaceContractTypePairState,
  enqueue: InterfaceContractTypePairEnqueue,
): void {
  const targetContracts = propertyContracts(
    semantics,
    targetProperty,
    targetDeclaration,
    state,
  );
  if (!targetProperty.optional) {
    markContractBoundaries(
      state,
      targetContracts,
      "missing-transport-member",
    );
    markInterfaceContractsExposed(
      semantics,
      targetProperty.type,
      state,
      "missing-transport-member",
    );
    return;
  }
  const values = sourceIndexes.filter((index) =>
    indexCoversProperty(state.source, semantics, index, targetProperty)
  ).map((index) => index.valueType).filter(
    (value): value is Type => value !== undefined,
  );
  if (values.length === 0) {
    return;
  }
  if (!allTypesIdentical(semantics, values)) {
    markNestedTypeMismatch(semantics, sourceType, targetProperty.type, state);
    return;
  }
  enqueue(semantics, values[0]!, targetProperty.type, state);
}

function pairIndexMembers(
  semantics: SourceFileSemantics,
  sourceType: Type,
  targetType: Type,
  sourceProperties: readonly TypePropertyInfo[],
  sourceIndexes: readonly TypeIndexInfo[],
  targetIndexes: readonly TypeIndexInfo[],
  state: InterfaceContractTypePairState,
  enqueue: InterfaceContractTypePairEnqueue,
): void {
  for (const targetIndex of targetIndexes) {
    if (targetIndex.keyType === undefined || targetIndex.valueType === undefined) {
      markNestedTypeMismatch(semantics, sourceType, targetType, state);
      continue;
    }
    let providerCount = 0;
    for (const sourceIndex of sourceIndexes) {
      if (
        sourceIndex.keyType !== undefined &&
        sourceIndex.valueType !== undefined &&
        indexDomainCovers(
          semantics,
          sourceIndex.keyType,
          targetIndex.keyType,
        )
      ) {
        providerCount += 1;
        enqueue(
          semantics,
          sourceIndex.valueType,
          targetIndex.valueType,
          state,
        );
      }
    }
    for (const sourceProperty of sourceProperties) {
      if (indexAcceptsProperty(state, semantics, targetIndex, sourceProperty)) {
        providerCount += 1;
        enqueue(
          semantics,
          sourceProperty.type,
          targetIndex.valueType,
          state,
        );
      }
    }
    if (providerCount === 0 && !state.rootSourceIsFresh) {
      markInterfaceContractsExposed(
        semantics,
        targetIndex.valueType,
        state,
        "missing-transport-member",
      );
    }
  }
}

function propertyContracts(
  semantics: SourceFileSemantics,
  property: TypePropertyInfo,
  owner: Node | undefined,
  state: InterfaceContractTypePairState,
): readonly Node[] {
  return interfaceContractsForProperty(
    state.source,
    semantics,
    property.symbol,
    owner,
    property.name,
    state.contracts.entries,
    state.contracts.declarationContracts,
  );
}

function indexAcceptsProperty(
  state: InterfaceContractTypePairState,
  semantics: SourceFileSemantics,
  index: TypeIndexInfo,
  property: TypePropertyInfo,
): boolean {
  return indexCoversProperty(state.source, semantics, index, property);
}

function allTypesIdentical(
  semantics: SourceFileSemantics,
  types: readonly Type[],
): boolean {
  return types.length !== 0 && types.slice(1).every((type) =>
    semantics.isTypeIdenticalTo(types[0]!, type)
  );
}
