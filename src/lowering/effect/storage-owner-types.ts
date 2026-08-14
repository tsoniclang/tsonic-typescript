import type { Node, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import { KindClassDeclaration } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";

type SourceSemantics = ReturnType<TargetSourceProgram["semantics"]["forNode"]>;

export interface StorageOwnerCarrierIndex {
  readonly carriers: ReadonlyMap<Node, ReadonlySet<Node>>;
  readonly operationCount: number;
}

export function storageValueTypeIsClosed(
  semantics: SourceSemantics,
  type: Type,
  owners: ReadonlySet<Node>,
  pending: Set<Type>,
): boolean {
  if (
    semantics.isNever(type) ||
    semantics.isVoidLike(type) ||
    semantics.isNullish(type) ||
    semantics.isStringLike(type) ||
    semantics.isNumberLike(type) ||
    semantics.isBooleanLike(type) ||
    semantics.isBigIntLike(type)
  ) {
    return true;
  }
  if (semantics.isAny(type) || semantics.isUnknown(type)) {
    return false;
  }
  if (directCandidateOwners(semantics, type, owners).size !== 0) {
    return true;
  }
  if (!semantics.isUnion(type) || pending.has(type)) {
    return false;
  }
  pending.add(type);
  const result = semantics.getUnionOrIntersectionTypes(type).every((member) =>
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
  carriers: ReadonlyMap<Node, ReadonlySet<Node>>,
  cache: Map<Type, ReadonlySet<Node>>,
  pending: Set<Type>,
): ReadonlySet<Node> {
  const existing = cache.get(type);
  if (existing !== undefined) {
    return existing;
  }
  if (pending.has(type)) {
    return new Set();
  }
  if (storageTypeCannotCarryOwner(semantics, type)) {
    const empty = new Set<Node>();
    cache.set(type, empty);
    return empty;
  }
  pending.add(type);
  const result = ownersForDirectType(semantics, type, carriers);
  for (const member of nestedStorageTypes(semantics, type)) {
    for (const owner of ownersWithinStorageType(
      semantics,
      member,
      carriers,
      cache,
      pending,
    )) {
      result.add(owner);
    }
  }
  pending.delete(type);
  cache.set(type, result);
  return result;
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
      const type = semantics.getTypeAtLocation(name ?? member);
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
      new Set(carried),
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
  carriers: ReadonlyMap<Node, ReadonlySet<Node>>,
): Set<Node> {
  const result = new Set<Node>();
  for (const declaration of directTypeDeclarations(semantics, type)) {
    for (const owner of carriers.get(declaration) ?? []) {
      result.add(owner);
    }
  }
  return result;
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
  const direct = semantics.getPrimarySymbolDeclaration(
    semantics.getTypeSymbol(type),
  );
  if (direct !== undefined) {
    declarations.push(direct);
  }
  const target = semantics.isTypeReference(type)
    ? semantics.getTypeReferenceTarget(type)
    : undefined;
  const targetDeclaration = target === undefined
    ? undefined
    : semantics.getPrimarySymbolDeclaration(semantics.getTypeSymbol(target));
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
    ...(semantics.isUnion(type) || semantics.isIntersection(type)
      ? semantics.getUnionOrIntersectionTypes(type)
      : []),
    ...(semantics.isTypeReference(type) ? semantics.getTypeArguments(type) : []),
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
