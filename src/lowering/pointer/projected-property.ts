import type { Node, PointerOperationFact } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { PointerTypedFactLedger } from "./flow-fact-ledger.js";
import type { PointerFlowRepresentation } from "./flow-representation.js";
import { transparentExpression } from "./flow-syntax.js";
import { pointerTypeCanBeUndefined } from "./nullability.js";
import type { PointerPlanningLedger } from "./planning-ledger.js";

type ProjectionOperation = Extract<
  PointerOperationFact,
  { readonly operation: "project-pointer" }
>;

type AddressOperation = Extract<
  PointerOperationFact,
  { readonly operation: "address-of" }
>;

export interface ProjectedPropertyLocationFusion {
  readonly projection: ProjectionOperation;
  readonly address: AddressOperation;
}

export interface ProjectedPropertyLocationPlan {
  fusionForProjection(node: Node): ProjectedPropertyLocationFusion | undefined;
  ownsAddress(node: Node): boolean;
  readonly count: number;
}

export function planProjectedPropertyLocations(
  source: TargetSourceProgram,
  facts: PointerTypedFactLedger,
  representationFor: (node: Node) => PointerFlowRepresentation,
  ownsImmediateProjection: (node: Node) => boolean,
  ledger: PointerPlanningLedger,
): ProjectedPropertyLocationPlan {
  const byProjection = new Map<Node, ProjectedPropertyLocationFusion>();
  const addresses = new Set<Node>();
  for (const { fact: projection } of facts.operationEntries) {
    ledger.record("projection");
    if (
      projection?.operation !== "project-pointer" ||
      ownsImmediateProjection(projection.call) ||
      representationFor(projection.call) !== "location" ||
      pointerTypeCanBeUndefined(
        source,
        projection.pointerExpression,
        projection.pointerType,
      )
    ) {
      continue;
    }
    const sourcePointer = transparentExpression(
      source,
      projection.pointerExpression,
    );
    const address = sourcePointer === undefined
      ? undefined
      : facts.operationFor(sourcePointer);
    if (
      address?.operation !== "address-of" ||
      address.call !== sourcePointer ||
      representationFor(address.call) !== "location" ||
      !hasDirectPropertyStorage(source, facts, address)
    ) {
      continue;
    }
    if (addresses.has(address.call)) {
      throw new Error(
        "one addressed property cannot own multiple projected-location fusions",
      );
    }
    byProjection.set(
      projection.call,
      Object.freeze({ projection, address }),
    );
    addresses.add(address.call);
  }
  return Object.freeze({
    fusionForProjection(node: Node): ProjectedPropertyLocationFusion | undefined {
      return byProjection.get(node);
    },
    ownsAddress(node: Node): boolean {
      return addresses.has(node);
    },
    count: byProjection.size,
  });
}

function hasDirectPropertyStorage(
  source: TargetSourceProgram,
  facts: PointerTypedFactLedger,
  address: AddressOperation,
): boolean {
  const storage = address.storageExpression;
  if (source.ast.is.IsPropertyAccessExpression(storage)) {
    return directStorageOwner(
      source,
      facts,
      address,
      source.ast.as.AsPropertyAccessExpression(storage)?.Expression,
    );
  }
  if (source.ast.is.IsElementAccessExpression(storage)) {
    return directStorageOwner(
      source,
      facts,
      address,
      source.ast.as.AsElementAccessExpression(storage)?.Expression,
    );
  }
  return false;
}

function directStorageOwner(
  source: TargetSourceProgram,
  facts: PointerTypedFactLedger,
  address: AddressOperation,
  owner: Node | undefined,
): boolean {
  if (owner === undefined) {
    return false;
  }
  if (
    source.ast.is.IsPropertyAccessExpression(owner) ||
    source.ast.is.IsElementAccessExpression(owner)
  ) {
    return false;
  }
  const ownerRoot = transparentExpression(source, owner);
  if (ownerRoot === undefined) {
    return false;
  }
  if (facts.operationFor(ownerRoot)?.operation === "load") {
    return false;
  }
  if (!source.ast.is.IsIdentifier(ownerRoot)) {
    return true;
  }
  const reference = source.navigation.sourceReferenceFor(ownerRoot);
  if (reference === undefined) {
    return false;
  }
  const declarationFile = source.ast.getSourceFile(reference.declaration);
  const addressFile = source.ast.getSourceFile(address.call);
  if (declarationFile === undefined || addressFile === undefined) {
    return false;
  }
  if (declarationFile !== addressFile) {
    return true;
  }
  return source.ast.is.IsVariableDeclaration(reference.declaration) &&
    source.ast.variableDeclarationKind(reference.declaration) === "const";
}
