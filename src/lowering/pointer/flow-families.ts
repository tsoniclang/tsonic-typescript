import {
  pointerFactKey,
  pointerOperationFactKey,
} from "@tsonic/tsts";
import type {
  Node,
  PointerOperationFact,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import type { PointerFlowComponent } from "./flow-graph.js";
import {
  appendFamilyFallback,
  sealFamilyFallback,
  type DirectReferenceFamilyFallback,
  type FamilyFallbackLedger,
} from "./flow-family-evidence.js";
import { applyGenericPointerBoundaries } from "./flow-family-generics.js";
import { nonBijectiveIdentityOccurrences } from "./flow-family-identity.js";
import {
  blockDirectReferenceFamily as blockFamily,
  type MutableDirectReferenceFamily,
} from "./flow-family-state.js";
import { describePointerPointee } from "./pointee-classification.js";

export interface DirectReferenceFamilyPlan {
  readonly representations: ReadonlyMap<Node, "direct-object">;
  readonly familyCount: number;
  readonly fallbackReasons: readonly DirectReferenceFamilyFallback[];
}

export function planDirectReferenceFamilies(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  components: readonly PointerFlowComponent[],
): DirectReferenceFamilyPlan {
  const families = new Map<Node, MutableDirectReferenceFamily>();
  const operationFamilies = new Map<Node, MutableDirectReferenceFamily>();
  for (const node of nodes) {
    collectPointerType(source, node, families);
    collectPointerOperation(
      source,
      node,
      families,
      operationFamilies,
    );
  }
  applyGenericPointerBoundaries(
    source,
    nodes,
    families,
    operationFamilies,
  );
  applyComponentBoundaries(
    source,
    components,
    families,
    operationFamilies,
  );
  applyIdentityBoundaries(source, families);
  const representations = new Map<Node, "direct-object">();
  const fallbackReasons: FamilyFallbackLedger = new Map();
  let familyCount = 0;
  for (const family of families.values()) {
    if (family.producerCount === 0) {
      blockFamily(family, "unsupported-producer", family.identity);
    }
    if (family.operations.size === 0) {
      blockFamily(family, "unsupported-flow", family.identity);
    }
    if (family.blockers.size !== 0) {
      appendFamilyFallback(fallbackReasons, family.blockers);
      continue;
    }
    familyCount += 1;
    for (const pointerType of family.pointerTypes) {
      representations.set(pointerType, "direct-object");
    }
    for (const operation of family.operations.keys()) {
      representations.set(operation, "direct-object");
    }
  }
  return Object.freeze({
    representations,
    familyCount,
    fallbackReasons: sealFamilyFallback(fallbackReasons),
  });
}

function collectPointerType(
  source: TargetSourceProgram,
  node: Node,
  families: Map<Node, MutableDirectReferenceFamily>,
): void {
  if (!source.ast.is.IsTypeReferenceNode(node)) {
    return;
  }
  const fact = source.sourceFacts.getFact(node, pointerFactKey);
  if (fact === undefined) {
    return;
  }
  const semantics = source.semantics.forNode(node);
  const pointee = semantics.getTypeFromTypeNode(fact.pointee);
  const family = pointee === undefined
    ? undefined
    : directReferenceFamily(source, node, pointee, families);
  if (family === undefined) {
    return;
  }
  family.pointerTypes.add(node);
  const sourceFile = source.ast.getSourceFile(node);
  if (
    sourceFile === undefined ||
    source.ast.isDeclarationFile(sourceFile)
  ) {
    blockFamily(family, "declaration-boundary", node);
  }
}

function collectPointerOperation(
  source: TargetSourceProgram,
  node: Node,
  families: Map<Node, MutableDirectReferenceFamily>,
  operationFamilies: Map<Node, MutableDirectReferenceFamily>,
): void {
  const operation = source.sourceFacts.getFact(node, pointerOperationFactKey);
  if (operation === undefined) {
    return;
  }
  const family = directReferenceFamily(
    source,
    operation.explicitPointeeTypeNode ?? operation.call,
    operation.pointeeType,
    families,
  );
  if (family === undefined) {
    return;
  }
  family.operations.set(node, operation);
  operationFamilies.set(node, family);
  switch (operation.operation) {
    case "allocate":
    case "address-of":
      family.producerCount += 1;
      break;
    case "load":
      break;
    case "equal-pointer":
    case "hash-pointer":
      break;
    case "store":
      blockFamily(family, "pointee-replacement", operation.call);
      break;
    default:
      blockFamily(family, "unsupported-producer", operation.call);
      break;
  }
}

function applyIdentityBoundaries(
  source: TargetSourceProgram,
  families: ReadonlyMap<Node, MutableDirectReferenceFamily>,
): void {
  for (const family of families.values()) {
    for (const occurrence of nonBijectiveIdentityOccurrences(
      source,
      family.identity,
      family.operations.values(),
    )) {
      blockFamily(family, "non-bijective-identity", occurrence);
    }
  }
}

function directReferenceFamily(
  source: TargetSourceProgram,
  anchor: Node,
  pointee: PointerOperationFact["pointeeType"],
  families: Map<Node, MutableDirectReferenceFamily>,
): MutableDirectReferenceFamily | undefined {
  const description = describePointerPointee(source, anchor, pointee);
  if (
    description?.category !== "direct-reference" ||
    typeof description.identity === "string"
  ) {
    return undefined;
  }
  const existing = families.get(description.identity);
  if (existing !== undefined) {
    return existing;
  }
  const created: MutableDirectReferenceFamily = {
    identity: description.identity,
    pointerTypes: new Set(),
    operations: new Map(),
    blockers: new Map(),
    producerCount: 0,
  };
  families.set(description.identity, created);
  return created;
}

function applyComponentBoundaries(
  source: TargetSourceProgram,
  components: readonly PointerFlowComponent[],
  families: ReadonlyMap<Node, MutableDirectReferenceFamily>,
  operationFamilies: ReadonlyMap<Node, MutableDirectReferenceFamily>,
): void {
  for (const component of components) {
    const touched = new Set<MutableDirectReferenceFamily>();
    const nonDirectPointees: Node[] = [];
    for (const evidence of component.pointees) {
      const description = describePointerPointee(
        source,
        evidence.anchor,
        evidence.type,
      );
      if (
        description?.category !== "direct-reference" ||
        typeof description.identity === "string"
      ) {
        nonDirectPointees.push(evidence.anchor);
        continue;
      }
      const family = families.get(description.identity);
      if (family !== undefined) {
        touched.add(family);
      }
    }
    for (const operation of component.operations) {
      const family = operationFamilies.get(operation);
      if (family !== undefined) {
        touched.add(family);
      }
    }
    if (nonDirectPointees.length !== 0) {
      for (const family of touched) {
        for (const occurrence of nonDirectPointees) {
          blockFamily(family, "mixed-pointee", occurrence);
        }
      }
    }
    for (const evidence of component.blockerEvidence) {
      if (
        evidence.reason !== "addressed-storage-may-change" &&
        evidence.reason !== "external-boundary" &&
        evidence.reason !== "unsupported-producer"
      ) {
        continue;
      }
      for (const family of touched) {
        for (const occurrence of evidence.occurrences) {
          blockFamily(family, evidence.reason, occurrence);
        }
      }
    }
  }
}
