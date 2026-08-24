import type { Node, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { KindClassDeclaration } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import {
  type ExactSourceBodyInspection,
  sourceBodyInspectionIsExact,
} from "../../model/source-membership.js";

type SourceSemantics = ReturnType<TargetSourceProgram["semantics"]["forNode"]>;
export type StorageOwnerMembership =
  | { readonly kind: "empty" }
  | { readonly kind: "sparse"; readonly owners: readonly Node[] }
  | { readonly kind: "universal" };

export const emptyStorageOwnerMembership: StorageOwnerMembership = Object.freeze({
  kind: "empty",
});

export const universalStorageOwnerMembership: StorageOwnerMembership = Object.freeze({
  kind: "universal",
});

export function storageOwnerMembershipIsEmpty(
  membership: StorageOwnerMembership,
): boolean {
  return membership.kind === "empty";
}

export function storageOwnerMembershipContains(
  membership: StorageOwnerMembership,
  owner: Node,
): boolean {
  return membership.kind === "universal" ||
    (membership.kind === "sparse" && membership.owners.includes(owner));
}

export function selectedStorageOwners(
  membership: StorageOwnerMembership,
  selectedOwners: ReadonlySet<Node>,
): Iterable<Node> {
  if (membership.kind === "universal") {
    return selectedOwners;
  }
  return membership.kind === "sparse"
    ? membership.owners.filter((owner) => selectedOwners.has(owner))
    : [];
}

export interface StorageOwnerCarrierIndex {
  readonly carriers: ReadonlyMap<Node, StorageOwnerMembership>;
  readonly owners: readonly Node[];
  readonly operationCount: number;
}

export function storageValueTypeIsClosed(
  semantics: SourceSemantics,
  type: Type,
  owners: ReadonlySet<Node>,
  pending: Set<Type>,
): boolean {
  if (
    semantics.types.isNever(type) ||
    semantics.types.isVoidLike(type) ||
    semantics.types.isNullish(type) ||
    semantics.types.isStringLike(type) ||
    semantics.types.isNumberLike(type) ||
    semantics.types.isBooleanLike(type) ||
    semantics.types.isBigIntLike(type)
  ) {
    return true;
  }
  if (semantics.types.isAny(type) || semantics.types.isUnknown(type)) {
    return false;
  }
  if (directCandidateOwners(semantics, type, owners).size !== 0) {
    return true;
  }
  if (pending.has(type)) {
    return true;
  }
  const nested = nestedStorageTypes(semantics, type);
  if (nested === undefined || nested.length === 0) {
    return false;
  }
  pending.add(type);
  const result = nested.every((member) =>
    storageValueTypeIsClosed(
      semantics,
      member,
      owners,
      pending,
    )
  );
  pending.delete(type);
  return result;
}

export function ownersWithinStorageType(
  semantics: SourceSemantics,
  type: Type,
  carriers: ReadonlyMap<Node, StorageOwnerMembership>,
  cache: Map<Type, StorageOwnerMembership>,
  allOwners: readonly Node[],
): StorageOwnerMembership {
  if (allOwners.length === 0) {
    return emptyStorageOwnerMembership;
  }
  const existing = cache.get(type);
  if (existing !== undefined) {
    return existing;
  }
  const selected = collectOwnersWithinStorageType(
    semantics,
    type,
    carriers,
    cache,
    new Set(),
    allOwners,
  );
  if (!storageOwnerMembershipIsEmpty(selected)) {
    cache.set(type, selected);
  }
  return selected;
}

function collectOwnersWithinStorageType(
  semantics: SourceSemantics,
  type: Type,
  carriers: ReadonlyMap<Node, StorageOwnerMembership>,
  cache: Map<Type, StorageOwnerMembership>,
  pending: Set<Type>,
  allOwners: readonly Node[],
): StorageOwnerMembership {
  const existing = cache.get(type);
  if (existing !== undefined) {
    return existing;
  }
  if (pending.has(type)) {
    return emptyStorageOwnerMembership;
  }
  if (storageTypeCannotCarryOwner(semantics, type)) {
    return emptyStorageOwnerMembership;
  }
  if (semantics.types.isAny(type) || semantics.types.isUnknown(type)) {
    return universalStorageOwnerMembership;
  }
  const result = ownersForDirectType(semantics, type, carriers);
  if (result.kind === "universal") {
    return result;
  }
  const selected = new Set(result.kind === "sparse" ? result.owners : []);
  const nested = nestedStorageTypes(semantics, type);
  if (nested === undefined) {
    pending.delete(type);
    return universalStorageOwnerMembership;
  } else if (nested.length !== 0) {
    pending.add(type);
    for (const member of nested) {
      const carried = collectOwnersWithinStorageType(
        semantics,
        member,
        carriers,
        cache,
        pending,
        allOwners,
      );
      if (carried.kind === "universal") {
        pending.delete(type);
        return universalStorageOwnerMembership;
      }
      if (carried.kind === "sparse") {
        for (const owner of carried.owners) {
          selected.add(owner);
        }
      }
      if (selected.size === allOwners.length) {
        pending.delete(type);
        return universalStorageOwnerMembership;
      }
    }
    pending.delete(type);
  }
  return storageOwnerMembershipFrom(selected);
}

export function collectStorageOwnerCarriers(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  owners: ReadonlySet<Node>,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
): StorageOwnerCarrierIndex {
  let operationCount = 0;
  const reverse = new Map<Node, Set<Node>>();
  const universalCarriers = new Set<Node>();
  for (const declaration of program.nodesOfKind(KindClassDeclaration)) {
    operationCount += 1;
    if (!sourceBodyInspectionIsExact(
      source,
      declaration,
      bodyInspectionIsCertified,
    )) {
      continue;
    }
    for (const member of storageMembers(source, declaration)) {
      operationCount += 1;
      const name = source.ast.name(member);
      const semantics = source.semantics.forNode(member);
      const type = semantics.types.expressionType(name ?? member);
      if (type === undefined) {
        continue;
      }
      const referenced = exactClassesWithinType(
        source,
        semantics,
        type,
        new Set(),
        bodyInspectionIsCertified,
        () => {
          operationCount += 1;
        },
      );
      if (referenced === undefined) {
        if (owners.size !== 0) {
          universalCarriers.add(declaration);
          operationCount += 1;
        }
        continue;
      }
      for (const candidate of referenced) {
        operationCount += 1;
        appendReverseCarrier(reverse, candidate, declaration);
      }
    }
  }
  const allOwners = Object.freeze([...owners]);
  const mutable = new Map<Node, MutableStorageOwnerMembership>();
  const pending: Node[] = [];
  for (const owner of owners) {
    mutable.set(owner, { universal: false, owners: new Set([owner]) });
    pending.push(owner);
  }
  for (const carrier of universalCarriers) {
    mutable.set(carrier, { universal: true, owners: new Set() });
    pending.push(carrier);
  }
  while (pending.length !== 0) {
    const contained = pending.pop();
    const carried = contained === undefined ? undefined : mutable.get(contained);
    if (contained === undefined || carried === undefined) {
      continue;
    }
    for (const carrier of reverse.get(contained) ?? []) {
      operationCount += 1;
      const carrierOwners = mutable.get(carrier) ?? {
        universal: false,
        owners: new Set<Node>(),
      };
      if (carrierOwners.universal) {
        continue;
      }
      const size = carrierOwners.owners.size;
      if (carried.universal) {
        carrierOwners.universal = true;
        carrierOwners.owners.clear();
      } else {
        for (const owner of carried.owners) {
          carrierOwners.owners.add(owner);
        }
        if (carrierOwners.owners.size === allOwners.length) {
          carrierOwners.universal = true;
          carrierOwners.owners.clear();
        }
      }
      if (carrierOwners.universal || carrierOwners.owners.size !== size) {
        mutable.set(carrier, carrierOwners);
        pending.push(carrier);
      }
    }
  }
  return Object.freeze({
    carriers: new Map([...mutable].map(([declaration, carried]) => {
      const selected = carried.universal
        ? universalStorageOwnerMembership
        : storageOwnerMembershipFrom(carried.owners);
      return [declaration, selected] as const;
    })),
    owners: allOwners,
    operationCount,
  });
}

interface MutableStorageOwnerMembership {
  universal: boolean;
  readonly owners: Set<Node>;
}

function directCandidateOwners(
  semantics: SourceSemantics,
  type: Type,
  candidates: ReadonlySet<Node>,
): Set<Node> {
  return new Set(directTypeDeclarations(semantics, type).filter((declaration) =>
    candidates.has(declaration)
  ));
}

function ownersForDirectType(
  semantics: SourceSemantics,
  type: Type,
  carriers: ReadonlyMap<Node, StorageOwnerMembership>,
): StorageOwnerMembership {
  const result = new Set<Node>();
  for (const declaration of directTypeDeclarations(semantics, type)) {
    const carried = carriers.get(declaration);
    if (carried?.kind === "universal") {
      return universalStorageOwnerMembership;
    }
    if (carried?.kind === "sparse") {
      for (const owner of carried.owners) {
        result.add(owner);
      }
    }
  }
  return storageOwnerMembershipFrom(result);
}

function storageOwnerMembershipFrom(
  owners: ReadonlySet<Node>,
): StorageOwnerMembership {
  return owners.size === 0
    ? emptyStorageOwnerMembership
    : Object.freeze({
        kind: "sparse",
        owners: Object.freeze([...owners]),
      });
}

function exactClassesWithinType(
  source: TargetSourceProgram,
  semantics: SourceSemantics,
  type: Type,
  pending: Set<Type>,
  bodyInspectionIsCertified: ExactSourceBodyInspection | undefined,
  record: () => void,
): ReadonlySet<Node> | undefined {
  record();
  if (pending.has(type) || storageTypeCannotCarryOwner(semantics, type)) {
    return new Set();
  }
  if (semantics.types.isAny(type) || semantics.types.isUnknown(type)) {
    return undefined;
  }
  pending.add(type);
  const result = new Set<Node>();
  for (const declaration of directTypeDeclarations(semantics, type)) {
    if (
      sourceBodyInspectionIsExact(
        source,
        declaration,
        bodyInspectionIsCertified,
      ) &&
      source.ast.is.IsClassDeclaration(declaration)
    ) {
      result.add(declaration);
    }
  }
  const nested = nestedStorageTypes(semantics, type);
  if (nested === undefined) {
    pending.delete(type);
    return undefined;
  }
  for (const member of nested) {
    const declarations = exactClassesWithinType(
      source,
      semantics,
      member,
      pending,
      bodyInspectionIsCertified,
      record,
    );
    if (declarations === undefined) {
      pending.delete(type);
      return undefined;
    }
    for (const declaration of declarations) {
      result.add(declaration);
    }
  }
  pending.delete(type);
  return result;
}

function directTypeDeclarations(
  semantics: SourceSemantics,
  type: Type,
): readonly Node[] {
  const declarations: Node[] = [];
  const directSymbol = semantics.declarations.typeSymbol(type);
  const direct = directSymbol === undefined
    ? undefined
    : semantics.declarations.primarySymbolDeclaration(directSymbol);
  if (direct !== undefined) {
    declarations.push(direct);
  }
  const target = semantics.types.isTypeReference(type)
    ? semantics.types.typeReferenceTarget(type)
    : undefined;
  const targetSymbol = target === undefined
    ? undefined
    : semantics.declarations.typeSymbol(target);
  const targetDeclaration = targetSymbol === undefined
    ? undefined
    : semantics.declarations.primarySymbolDeclaration(targetSymbol);
  if (targetDeclaration !== undefined && targetDeclaration !== direct) {
    declarations.push(targetDeclaration);
  }
  return declarations;
}

function nestedStorageTypes(
  semantics: SourceSemantics,
  type: Type,
): readonly Type[] | undefined {
  const signatures = [
    ...semantics.types.callSignatures(type),
    ...semantics.types.constructSignatures(type),
  ];
  const signatureReturns = signatures.map((signature) =>
    semantics.types.returnType(signature)
  );
  if (signatureReturns.some((member) => member === undefined)) {
    return undefined;
  }
  const signatureParameters = signatures.flatMap((signature) =>
    semantics.types.signatureParameterInfos(signature).map((parameter) =>
      parameter.type
    )
  );
  const members = semantics.types.isUnion(type) ||
      semantics.types.isIntersection(type)
    ? semantics.types.unionOrIntersectionTypes(type)
    : [];
  if (members.some((member) => member === undefined)) {
    return undefined;
  }
  const arguments_ = semantics.types.isTypeReference(type)
    ? semantics.types.effectiveTypeArguments(type)
    : [];
  if (arguments_ === undefined) {
    return undefined;
  }
  const tupleElements = semantics.types.isTuple(type)
    ? semantics.types.tupleElementTypes(type)
    : [];
  if (tupleElements.some((member) => member === undefined)) {
    return undefined;
  }
  const inspectStructuralMembers =
    directTypeDeclarations(semantics, type).length === 0 &&
    !semantics.types.isTypeReference(type) &&
    !semantics.types.isTuple(type);
  const properties = inspectStructuralMembers
    ? semantics.types.propertyInfos(type).map((property) => property.type)
    : [];
  const indexes = inspectStructuralMembers
    ? semantics.types.indexInfos(type).map((index) => index.valueType)
    : [];
  if (indexes.some((member) => member === undefined)) {
    return undefined;
  }
  return Object.freeze([...new Set([
    ...(members as readonly Type[]),
    ...arguments_,
    ...(tupleElements as readonly Type[]),
    ...(signatureReturns as readonly Type[]),
    ...signatureParameters,
    ...properties,
    ...(indexes as readonly Type[]),
  ])]);
}

function storageMembers(
  source: TargetSourceProgram,
  declaration: Node,
): readonly Node[] {
  const members = source.ast.members(declaration).filter(
    (member): member is Node =>
      member !== undefined &&
      !source.ast.hasModifierKind(member, "static") &&
      source.ast.is.IsPropertyDeclaration(member),
  );
  for (const member of source.ast.members(declaration)) {
    if (member === undefined || !source.ast.is.IsConstructorDeclaration(member)) {
      continue;
    }
    for (const parameter of source.ast.parameters(member)) {
      if (parameter !== undefined && isParameterProperty(source, parameter)) {
        members.push(parameter);
      }
    }
  }
  return members;
}

function isParameterProperty(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  return (["public", "private", "protected", "readonly"] as const).some(
    (modifier) => source.ast.hasModifierKind(declaration, modifier),
  );
}

function appendReverseCarrier(
  reverse: Map<Node, Set<Node>>,
  contained: Node,
  carrier: Node,
): void {
  if (contained === carrier) {
    return;
  }
  const carriers = reverse.get(contained);
  if (carriers === undefined) {
    reverse.set(contained, new Set([carrier]));
  } else {
    carriers.add(carrier);
  }
}

function storageTypeCannotCarryOwner(
  semantics: SourceSemantics,
  type: Type,
): boolean {
  return semantics.types.isNever(type) ||
    semantics.types.isVoidLike(type) ||
    semantics.types.isNullish(type) ||
    semantics.types.isStringLike(type) ||
    semantics.types.isNumberLike(type) ||
    semantics.types.isBooleanLike(type) ||
    semantics.types.isBigIntLike(type);
}
