import type {
  Node,
  PointerFact,
  PointerOperationFact,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../program-index.js";
import type { ProgramGeneratedNames } from "../generated-names.js";
import {
  planDirectObjectReplacement,
  type DirectObjectReplacement,
} from "./direct-object-replacement.js";
import type { PointerTypedFactLedger } from "./flow-fact-ledger.js";
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
  canonicalDirectReferenceNodeEvidence,
  requireCanonicalDirectReferenceFamily,
  type DirectReferenceFamilyDecision,
  type DirectReferenceFamilyRepresentation,
  type MutableDirectReferenceFamily,
} from "./flow-family-state.js";
import { describePointerPointee } from "./pointee-classification.js";
import type { PointerPlanningLedger } from "./planning-ledger.js";

export interface DirectReferenceFamilyPlan {
  readonly representations: ReadonlyMap<Node, DirectReferenceFamilyDecision>;
  canonicalRetentionFor(node: Node): readonly PointerFlowBlockerOccurrence[] | undefined;
  directObjectReplacementForStore(node: Node): DirectObjectReplacement | undefined;
  readonly directObjectReplacements: readonly DirectObjectReplacement[];
  readonly familyCount: number;
  readonly fallbackReasons: readonly DirectReferenceFamilyFallback[];
  readonly retainedFamilies: readonly DirectReferenceFamilyRetention[];
}

export interface DirectReferenceFamilyRetention {
  readonly identity: Node;
  readonly pointerTypeCount: number;
  readonly operationCount: number;
  readonly blockerEvidence: readonly PointerFlowBlockerOccurrence[];
}

export function planDirectReferenceFamilies(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  generatedNames: ProgramGeneratedNames,
  components: readonly PointerFlowComponent[],
  facts: PointerTypedFactLedger,
  ledger: PointerPlanningLedger,
): DirectReferenceFamilyPlan {
  const families = new Map<Node, MutableDirectReferenceFamily>();
  const operationFamilies = new Map<Node, MutableDirectReferenceFamily>();
  for (const { node, fact } of facts.pointerTypeEntries) {
    ledger.record("direct-family");
    collectPointerType(source, node, fact, families);
  }
  for (const { node, fact } of facts.operationEntries) {
    ledger.record("direct-family");
    collectPointerOperation(
      source,
      node,
      fact,
      families,
      operationFamilies,
    );
  }
  applyGenericPointerBoundaries(
    source,
    program,
    facts,
    families,
    operationFamilies,
    ledger,
  );
  applyCheckerBoundaries(source, operationFamilies, facts, ledger);
  applyComponentBoundaries(
    source,
    components,
    families,
    operationFamilies,
    ledger,
  );
  const replacementCandidates = new Map<
    MutableDirectReferenceFamily,
    DirectObjectReplacement
  >();
  const familyRepresentations = selectFamilyRepresentations(
    source,
    program,
    generatedNames,
    families,
    replacementCandidates,
    ledger,
  );
  applyIdentityBoundaries(
    source,
    families,
    familyRepresentations,
    program,
    ledger,
  );
  const representations = new Map<Node, DirectReferenceFamilyDecision>();
  const canonicalRetentions = new Map<
    Node,
    readonly PointerFlowBlockerOccurrence[]
  >();
  const fallbackReasons: FamilyFallbackLedger = new Map();
  const directObjectReplacements: DirectObjectReplacement[] = [];
  const directObjectReplacementsByStore = new Map<
    Node,
    DirectObjectReplacement
  >();
  const retainedFamilies: DirectReferenceFamilyRetention[] = [];
  let familyCount = 0;
  for (const family of families.values()) {
    ledger.record("direct-family");
    const representation = familyRepresentations.get(family);
    const replacement = replacementCandidates.get(family);
    if (replacement !== undefined) {
      directObjectReplacements.push(replacement);
      for (const storeCall of replacement.storeCalls) {
        if (directObjectReplacementsByStore.has(storeCall)) {
          throw new Error(
            "direct-object store belongs to multiple class families",
          );
        }
        directObjectReplacementsByStore.set(storeCall, replacement);
      }
    }
    if (family.blockers.size !== 0) {
      appendFamilyFallback(fallbackReasons, family.blockers, ledger);
      retainedFamilies.push(sealRetainedFamily(family, ledger));
      for (const node of family.canonicalNodes.keys()) {
        ledger.record("direct-family");
        if (!family.pointerTypes.has(node) && !family.operations.has(node)) {
          throw new Error("canonical pointer-family node is outside its family");
        }
        representations.set(node, "location");
        canonicalRetentions.set(
          node,
          canonicalDirectReferenceNodeEvidence(family, node, ledger),
        );
      }
      continue;
    }
    if (representation === undefined) {
      throw new Error("unblocked pointer family has no representation");
    }
    if (replacement !== undefined) {
      if (representation !== "direct-object") {
        throw new Error(
          "direct-object replacement selected a non-object representation",
        );
      }
    }
    familyCount += 1;
    for (const pointerType of family.pointerTypes) {
      ledger.record("direct-family");
      representations.set(pointerType, representation);
    }
    for (const operation of family.operations.keys()) {
      ledger.record("direct-family");
      representations.set(operation, representation);
    }
  }
  return Object.freeze({
    representations,
    canonicalRetentionFor(node: Node): readonly PointerFlowBlockerOccurrence[] | undefined {
      return canonicalRetentions.get(node);
    },
    directObjectReplacementForStore(node: Node): DirectObjectReplacement | undefined {
      return directObjectReplacementsByStore.get(node);
    },
    directObjectReplacements: Object.freeze(directObjectReplacements),
    familyCount,
    fallbackReasons: sealFamilyFallback(fallbackReasons, ledger),
    retainedFamilies: Object.freeze(retainedFamilies),
  });
}

function sealRetainedFamily(
  family: MutableDirectReferenceFamily,
  ledger: PointerPlanningLedger,
): DirectReferenceFamilyRetention {
  const blockerEvidence = [...family.blockers]
    .sort(([left], [right]) => {
      ledger.record("evidence");
      return left < right ? -1 : left > right ? 1 : 0;
    })
    .map(([reason, occurrences]) => {
      ledger.record("evidence");
      return Object.freeze({
        reason,
        occurrences: Object.freeze([...occurrences]),
      });
    });
  return Object.freeze({
    identity: family.identity,
    pointerTypeCount: family.pointerTypes.size,
    operationCount: family.operations.size,
    blockerEvidence: Object.freeze(blockerEvidence),
  });
}

function applyCheckerBoundaries(
  source: TargetSourceProgram,
  operationFamilies: ReadonlyMap<Node, MutableDirectReferenceFamily>,
  facts: PointerTypedFactLedger,
  ledger: PointerPlanningLedger,
): void {
  for (const [node, family] of operationFamilies) {
    ledger.record("direct-family");
    const operation = facts.operationFor(node);
    if (operation === undefined) {
      continue;
    }
    for (const expression of pointerExpressions(operation)) {
      ledger.record("direct-family");
      const semantics = source.semantics.forNode(expression);
      const type = semantics.types.expressionType(expression);
      if (type !== undefined && semantics.types.isNever(type)) {
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
  fact: PointerFact,
  families: Map<Node, MutableDirectReferenceFamily>,
): void {
  if (!source.ast.is.IsTypeReferenceNode(node)) {
    return;
  }
  const semantics = source.semantics.forNode(node);
  const pointee = semantics.types.authoredType(fact.pointee);
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
  operation: PointerOperationFact,
  families: Map<Node, MutableDirectReferenceFamily>,
  operationFamilies: Map<Node, MutableDirectReferenceFamily>,
): void {
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
  program: TargetProgramIndex,
  ledger: PointerPlanningLedger,
): void {
  for (const family of families.values()) {
    ledger.record("direct-family");
    if (representations.get(family) !== "direct-object") {
      continue;
    }
    for (const occurrence of nonBijectiveIdentityOccurrences(
      source,
      family.identity,
      family.operations.values(),
      program,
      ledger,
    )) {
      ledger.record("direct-family");
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
    canonicalNodes: new Map(),
  };
  families.set(description.identity, created);
  return created;
}

function selectFamilyRepresentations(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  generatedNames: ProgramGeneratedNames,
  families: ReadonlyMap<Node, MutableDirectReferenceFamily>,
  replacements: Map<MutableDirectReferenceFamily, DirectObjectReplacement>,
  ledger: PointerPlanningLedger,
): ReadonlyMap<
  MutableDirectReferenceFamily,
  DirectReferenceFamilyRepresentation
> {
  const representations = new Map<
    MutableDirectReferenceFamily,
    DirectReferenceFamilyRepresentation
  >();
  for (const family of families.values()) {
    ledger.record("direct-family");
    let producerCount = 0;
    let hasAddressedProducer = false;
    const stores: PointerOperationFact[] = [];
    for (const operation of family.operations.values()) {
      ledger.record("direct-family");
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
      const replacement = planDirectObjectReplacement(
        source,
        program,
        generatedNames,
        family.identity,
        stores.map((store) => store.call),
      );
      if (replacement === undefined) {
        for (const store of stores) {
          ledger.record("direct-family");
          blockFamily(family, "pointee-replacement", store.call);
        }
      } else {
        replacements.set(family, replacement);
      }
    }
    representations.set(
      family,
      stores.length !== 0 &&
          (!hasAddressedProducer || replacements.has(family))
        ? hasAddressedProducer
          ? "direct-object"
          : "mutable-cell"
        : stores.length !== 0
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
  ledger: PointerPlanningLedger,
): void {
  for (const component of components) {
    ledger.record("direct-family");
    const touched = new Set<MutableDirectReferenceFamily>();
    const nonDirectPointees: Node[] = [];
    for (const evidence of component.pointees) {
      ledger.record("direct-family");
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
      ledger.record("direct-family");
      const family = operationFamilies.get(operation);
      if (family !== undefined) {
        touched.add(family);
      }
    }
    if (nonDirectPointees.length !== 0) {
      for (const family of touched) {
        ledger.record("direct-family");
        for (const occurrence of nonDirectPointees) {
          ledger.record("direct-family");
          blockFamily(family, "mixed-pointee", occurrence);
        }
      }
    }
    for (const evidence of component.blockerEvidence) {
      ledger.record("direct-family");
      if (
        evidence.reason !== "addressed-storage-may-change" &&
        evidence.reason !== "external-boundary" &&
        evidence.reason !== "unsupported-producer"
      ) {
        continue;
      }
      for (const family of touched) {
        ledger.record("direct-family");
        for (const occurrence of evidence.occurrences) {
          ledger.record("direct-family");
          blockFamily(family, evidence.reason, occurrence);
        }
      }
    }
  }
}
