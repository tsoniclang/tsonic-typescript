import {
  pointerFactKey,
  pointerOperationFactKey,
} from "@tsonic/tsts";
import type {
  Node,
  PointerOperationFact,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  KindCallExpression,
  KindTypeReference,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";
import type {
  PointerFlowBlockerOccurrence,
  PointerFlowComponent,
} from "./flow-graph.js";
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
  canonicalDirectReferenceFamilyEvidence,
  requireCanonicalDirectReferenceFamily,
  type DirectReferenceFamilyDecision,
  type DirectReferenceFamilyRepresentation,
  type MutableDirectReferenceFamily,
} from "./flow-family-state.js";
import { describePointerPointee } from "./pointee-classification.js";

export interface DirectReferenceFamilyPlan {
  readonly representations: ReadonlyMap<Node, DirectReferenceFamilyDecision>;
  canonicalRetentionFor(node: Node): readonly PointerFlowBlockerOccurrence[] | undefined;
  readonly familyCount: number;
  readonly fallbackReasons: readonly DirectReferenceFamilyFallback[];
}

export function planDirectReferenceFamilies(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  components: readonly PointerFlowComponent[],
): DirectReferenceFamilyPlan {
  const families = new Map<Node, MutableDirectReferenceFamily>();
  const operationFamilies = new Map<Node, MutableDirectReferenceFamily>();
  for (const node of program.nodesOfKind(KindTypeReference)) {
    collectPointerType(source, node, families);
  }
  for (const node of program.nodesOfKind(KindCallExpression)) {
    collectPointerOperation(
      source,
      node,
      families,
      operationFamilies,
    );
  }
  applyGenericPointerBoundaries(
    source,
    program,
    families,
    operationFamilies,
  );
  applyCheckerBoundaries(source, operationFamilies);
  applyComponentBoundaries(
    source,
    components,
    families,
    operationFamilies,
  );
  const familyRepresentations = selectFamilyRepresentations(families);
  applyIdentityBoundaries(
    source,
    families,
    familyRepresentations,
    program.hasBindingWrite,
  );
  const representations = new Map<Node, DirectReferenceFamilyDecision>();
  const canonicalRetentions = new Map<
    Node,
    readonly PointerFlowBlockerOccurrence[]
  >();
  const fallbackReasons: FamilyFallbackLedger = new Map();
  let familyCount = 0;
  for (const family of families.values()) {
    const representation = familyRepresentations.get(family);
    if (family.blockers.size !== 0) {
      appendFamilyFallback(fallbackReasons, family.blockers);
      if (family.canonicalBlockers.size !== 0) {
        const retention = canonicalDirectReferenceFamilyEvidence(family);
        for (const pointerType of family.pointerTypes) {
          representations.set(pointerType, "location");
          canonicalRetentions.set(pointerType, retention);
        }
        for (const operation of family.operations.keys()) {
          representations.set(operation, "location");
          canonicalRetentions.set(operation, retention);
        }
      }
      continue;
    }
    if (representation === undefined) {
      throw new Error("unblocked pointer family has no representation");
    }
    familyCount += 1;
    for (const pointerType of family.pointerTypes) {
      representations.set(pointerType, representation);
    }
    for (const operation of family.operations.keys()) {
      representations.set(operation, representation);
    }
  }
  return Object.freeze({
    representations,
    canonicalRetentionFor(node: Node): readonly PointerFlowBlockerOccurrence[] | undefined {
      return canonicalRetentions.get(node);
    },
    familyCount,
    fallbackReasons: sealFamilyFallback(fallbackReasons),
  });
}

function applyCheckerBoundaries(
  source: TargetSourceProgram,
  operationFamilies: ReadonlyMap<Node, MutableDirectReferenceFamily>,
): void {
  for (const [node, family] of operationFamilies) {
    const operation = source.sourceFacts.getFact(node, pointerOperationFactKey);
    if (operation === undefined) {
      continue;
    }
    for (const expression of pointerExpressions(operation)) {
      const semantics = source.semantics.forNode(expression);
      const type = semantics.getTypeAtLocation(expression);
      if (type !== undefined && semantics.isNever(type)) {
        blockFamily(family, "checker-never", expression);
      }
    }
  }
}

function pointerExpressions(operation: PointerOperationFact): readonly Node[] {
  switch (operation.operation) {
    case "load":
    case "store":
    case "hash-pointer":
    case "project-pointer":
      return [operation.pointerExpression];
    case "equal-pointer":
      return [operation.leftExpression, operation.rightExpression];
    case "address-of":
    case "allocate":
    case "bind-pointer":
      return [];
  }
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
    case "load":
    case "equal-pointer":
    case "hash-pointer":
    case "store":
      break;
    case "bind-pointer":
      requireCanonicalDirectReferenceFamily(
        family,
        "provider-binding",
        operation.call,
      );
      break;
    case "project-pointer":
      requireCanonicalDirectReferenceFamily(
        family,
        "projection-observed",
        operation.call,
      );
      break;
  }
}

function applyIdentityBoundaries(
  source: TargetSourceProgram,
  families: ReadonlyMap<Node, MutableDirectReferenceFamily>,
  representations: ReadonlyMap<
    MutableDirectReferenceFamily,
    DirectReferenceFamilyRepresentation
  >,
  hasBindingWrite: (declaration: Node | undefined) => boolean,
): void {
  for (const family of families.values()) {
    if (representations.get(family) !== "direct-object") {
      continue;
    }
    for (const occurrence of nonBijectiveIdentityOccurrences(
      source,
      family.identity,
      family.operations.values(),
      hasBindingWrite,
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
    canonicalBlockers: new Set(),
  };
  families.set(description.identity, created);
  return created;
}

function selectFamilyRepresentations(
  families: ReadonlyMap<Node, MutableDirectReferenceFamily>,
): ReadonlyMap<
  MutableDirectReferenceFamily,
  DirectReferenceFamilyRepresentation
> {
  const representations = new Map<
    MutableDirectReferenceFamily,
    DirectReferenceFamilyRepresentation
  >();
  for (const family of families.values()) {
    let producerCount = 0;
    let hasAddressedProducer = false;
    const stores: PointerOperationFact[] = [];
    for (const operation of family.operations.values()) {
      switch (operation.operation) {
        case "allocate":
          producerCount += 1;
          break;
        case "address-of":
          producerCount += 1;
          hasAddressedProducer = true;
          break;
        case "store":
          stores.push(operation);
          break;
        case "load":
        case "equal-pointer":
        case "hash-pointer":
        case "bind-pointer":
        case "project-pointer":
          break;
      }
    }
    if (producerCount === 0) {
      blockFamily(family, "unsupported-producer", family.identity);
    }
    if (family.operations.size === 0) {
      blockFamily(family, "unsupported-flow", family.identity);
    }
    if (stores.length !== 0 && hasAddressedProducer) {
      for (const store of stores) {
        blockFamily(family, "pointee-replacement", store.call);
      }
    }
    representations.set(
      family,
      stores.length !== 0 && !hasAddressedProducer
        ? "mutable-cell"
        : "direct-object",
    );
  }
  return representations;
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
