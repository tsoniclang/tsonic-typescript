import type { Node, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { KindClassDeclaration } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";

type SourceSemantics = ReturnType<TargetSourceProgram["semantics"]["forNode"]>;
export type StorageOwnerMembership = readonly Node[];

export const emptyStorageOwnerMembership: StorageOwnerMembership = Object.freeze([]);

export interface StorageOwnerCarrierIndex {
  readonly carriers: ReadonlyMap<Node, StorageOwnerMembership>;
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
  if (!semantics.types.isUnion(type) || pending.has(type)) {
    return false;
  }
  pending.add(type);
  const result = semantics.types.unionOrIntersectionTypes(type).every((member) =>
    member !== undefined && storageValueTypeIsClosed(
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
): StorageOwnerMembership {
  return collectOwnersWithinStorageType(
    semantics,
    type,
    carriers,
    cache,
    undefined,
  );
}

function collectOwnersWithinStorageType(
  semantics: SourceSemantics,
  type: Type,
  carriers: ReadonlyMap<Node, StorageOwnerMembership>,
  cache: Map<Type, StorageOwnerMembership>,
  pending: Set<Type> | undefined,
): StorageOwnerMembership {
  const existing = cache.get(type);
  if (existing !== undefined) {
    return existing;
  }
  if (pending?.has(type) === true) {
    return emptyStorageOwnerMembership;
  }
  if (storageTypeCannotCarryOwner(semantics, type)) {
    return emptyStorageOwnerMembership;
  }
  const result = [...ownersForDirectType(semantics, type, carriers)];
  const nested = nestedStorageTypes(semantics, type);
  if (nested.length !== 0) {
    const active = pending ?? new Set<Type>();
    active.add(type);
    for (const member of nested) {
      for (const owner of collectOwnersWithinStorageType(
        semantics,
        member,
        carriers,
        cache,
        active,
      )) {
        appendUnique(result, owner);
      }
    }
    active.delete(type);
  }
  const sealed = result.length === 0
    ? emptyStorageOwnerMembership
    : Object.freeze(result);
  if (sealed.length !== 0) {
    cache.set(type, sealed);
  }
  return sealed;
}

export function collectStorageOwnerCarriers(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  owners: ReadonlySet<Node>,
): StorageOwnerCarrierIndex {
  let operationCount = 0;
  const reverse = new Map<Node, Set<Node>>();
  for (const declaration of program.nodesOfKind(KindClassDeclaration)) {
    operationCount += 1;
    if (!source.navigation.isProjectDeclaration(declaration)) {
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
      for (const referenced of projectClassesWithinType(
        source,
        semantics,
        type,
        new Set(),
        () => {
          operationCount += 1;
        },
      )) {
        operationCount += 1;
        appendReverseCarrier(reverse, referenced, declaration);
      }
    }
  }
  const mutable = new Map<Node, Set<Node>>();
  const pending: Node[] = [];
  for (const owner of owners) {
    mutable.set(owner, new Set([owner]));
    pending.push(owner);
  }
  while (pending.length !== 0) {
    const contained = pending.pop();
    const carried = contained === undefined ? undefined : mutable.get(contained);
    if (contained === undefined || carried === undefined) {
      continue;
    }
    for (const carrier of reverse.get(contained) ?? []) {
      operationCount += 1;
      const carrierOwners = mutable.get(carrier) ?? new Set<Node>();
      const size = carrierOwners.size;
      for (const owner of carried) {
        carrierOwners.add(owner);
      }
      if (carrierOwners.size !== size) {
        mutable.set(carrier, carrierOwners);
        pending.push(carrier);
      }
    }
  }
  return Object.freeze({
    carriers: new Map([...mutable].map(([declaration, carried]) => [
      declaration,
      Object.freeze([...carried]),
    ])),
    operationCount,
  });
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
  const result: Node[] = [];
  for (const declaration of directTypeDeclarations(semantics, type)) {
    for (const owner of carriers.get(declaration) ?? []) {
      appendUnique(result, owner);
    }
  }
  return result;
}

function appendUnique(target: Node[], owner: Node): void {
  if (!target.includes(owner)) {
    target.push(owner);
  }
}

function projectClassesWithinType(
  source: TargetSourceProgram,
  semantics: SourceSemantics,
  type: Type,
  pending: Set<Type>,
  record: () => void,
): ReadonlySet<Node> {
  record();
  if (pending.has(type) || storageTypeCannotCarryOwner(semantics, type)) {
    return new Set();
  }
  pending.add(type);
  const result = new Set<Node>();
  for (const declaration of directTypeDeclarations(semantics, type)) {
    if (
      source.navigation.isProjectDeclaration(declaration) &&
      source.ast.is.IsClassDeclaration(declaration)
    ) {
      result.add(declaration);
    }
  }
  for (const member of nestedStorageTypes(semantics, type)) {
    for (const declaration of projectClassesWithinType(
      source,
      semantics,
      member,
      pending,
      record,
    )) {
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
): readonly Type[] {
  return [
    ...(semantics.types.isUnion(type) || semantics.types.isIntersection(type)
      ? semantics.types.unionOrIntersectionTypes(type)
      : []),
    ...(semantics.types.isTypeReference(type) ? semantics.types.typeArguments(type) : []),
  ].filter((member): member is Type => member !== undefined);
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
