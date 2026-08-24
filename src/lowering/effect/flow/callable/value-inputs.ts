import type { Node, Symbol } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { TypeScriptPlanningObserver } from "../../../planning-observer.js";
import {
  createExactInvocationInputIndex,
  type ExactInvocationInputIndex,
} from "../invocation/inputs.js";

import {
  collectCallableCollectionInputs,
  type CallableCollectionContract,
  type CallableCollectionInputs,
} from "../collection/inputs.js";
import {
  collectCallableStorageInputs,
  type CallableStorageInputs,
} from "../storage/inputs.js";
import type { CallableStorageContract } from "../storage/contracts.js";
import type { CallableFields } from "../storage/fields.js";
import type { ExactObjectPropertyProjectionIndex } from "../object/projection.js";
import type { StorageOwnerBoundaryDependencies } from "../storage/owner-boundaries.js";
import {
  directContainingCall,
} from "../../model/syntax.js";
import type { CallableInputUseContract } from "./input-use.js";
import type {
  ExactCallableBodyInspection,
  ExactCallImplementations,
} from "./result-inputs.js";
import type { TypeScriptActiveCooperativeEffectProfile } from "../../../profile.js";
import {
  indexDeclarationSymbols,
  isCallableNonEscapingObservation,
  isTransparentParent,
  trackedInputDestination,
  transportedCallableDestinations,
} from "./input-reference.js";
import { sameValueAlternatives } from "../value/alternatives.js";
import { isExactValueAssignmentOperator } from "../storage/assignment.js";

export interface CallableValueInputs {
  readonly contracts: readonly CallableCollectionContract[];
  readonly storageContracts: readonly CallableStorageContract[];
  valuesFor(declaration: Node): readonly Node[] | undefined;
  isClosed(declaration: Node): boolean;
  referenceConsumerIsClosed(reference: Node): boolean;
  projectionConsumersAreClosed(consumers: readonly Node[]): boolean;
}

interface CallableValueInputEvidence {
  readonly source: TargetSourceProgram;
  readonly invocationInputs: ExactInvocationInputIndex;
  readonly collections: CallableCollectionInputs;
  readonly storage: CallableStorageInputs;
  readonly objectValues: ReadonlyMap<Node, readonly Node[]>;
  readonly objectValueInitializers: ReadonlySet<Node>;
  readonly closedStorageSymbols: ReadonlyMap<Symbol, Node>;
  readonly inputUses: CallableInputUseContract | undefined;
  readonly callableReferenceIsClosed:
    ((reference: Node) => boolean) | undefined;
}

export function collectCallableValueInputs(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  inputUses?: CallableInputUseContract,
  exactInvocationInputs?: ExactInvocationInputIndex,
  exactCallImplementations?: ExactCallImplementations,
  callableReferenceIsClosed?: (reference: Node) => boolean,
  planningObserver?: TypeScriptPlanningObserver,
  callableFields?: CallableFields,
  objectProjections?: ExactObjectPropertyProjectionIndex,
  boundaryDependencies?: StorageOwnerBoundaryDependencies,
  bodyInspectionIsCertified?: ExactCallableBodyInspection,
  cooperativeEffects: TypeScriptActiveCooperativeEffectProfile = "closed-direct",
): CallableValueInputs {
  const evidence = collectCallableValueInputEvidence(
    source,
    program,
    inputUses,
    exactInvocationInputs,
    exactCallImplementations,
    callableReferenceIsClosed,
    planningObserver,
    callableFields,
    objectProjections,
    boundaryDependencies,
    bodyInspectionIsCertified,
    cooperativeEffects,
  );
  return finalizeCallableValueInputs(evidence);
}

function collectCallableValueInputEvidence(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  inputUses: CallableInputUseContract | undefined,
  exactInvocationInputs: ExactInvocationInputIndex | undefined,
  exactCallImplementations: ExactCallImplementations | undefined,
  callableReferenceIsClosed: ((reference: Node) => boolean) | undefined,
  planningObserver: TypeScriptPlanningObserver | undefined,
  callableFields: CallableFields | undefined,
  objectProjections: ExactObjectPropertyProjectionIndex | undefined,
  boundaryDependencies: StorageOwnerBoundaryDependencies | undefined,
  bodyInspectionIsCertified: ExactCallableBodyInspection | undefined,
  cooperativeEffects: TypeScriptActiveCooperativeEffectProfile,
): CallableValueInputEvidence {
  const invocationInputs = exactInvocationInputs ??
    createExactInvocationInputIndex(source, program);
  const collections = collectCallableCollectionInputs(
    source,
    program,
    exactCallImplementations,
    bodyInspectionIsCertified,
  );
  planningObserver?.("effect-indirect-value-collections");
  const storage = collectCallableStorageInputs(
    source,
    program,
    collections.closed,
    inputUses,
    invocationInputs,
    exactCallImplementations,
    callableReferenceIsClosed,
    planningObserver,
    callableFields,
    boundaryDependencies,
    bodyInspectionIsCertified,
    cooperativeEffects,
  );
  planningObserver?.("effect-indirect-value-storage");
  const closedStorageSymbols = indexDeclarationSymbols(
    source,
    storage.closed,
  );
  const objectValues = new Map<Node, readonly Node[]>(
    (objectProjections?.properties ?? []).map((property) => [
      property.declaration,
      property.initializers,
    ] as const),
  );
  const objectValueInitializers = new Set(
    [...objectValues.values()].flatMap((values) => values),
  );
  let valueCount = 0;
  for (const values of storage.values.values()) {
    valueCount += values.length;
  }
  for (const values of collections.values.values()) {
    valueCount += values.length;
  }
  for (const values of objectValues.values()) {
    valueCount += values.length;
  }
  planningObserver?.("effect-indirect-value-finalization", {
    closed: storage.closed.size + collections.closed.size + objectValues.size,
    contracts: collections.contracts.length + storage.contracts.length,
    declarations: storage.closed.size + collections.closed.size +
      objectValues.size,
    values: valueCount,
  });
  return Object.freeze({
    source,
    invocationInputs,
    collections,
    storage,
    objectValues,
    objectValueInitializers,
    closedStorageSymbols,
    inputUses,
    callableReferenceIsClosed,
  });
}

function finalizeCallableValueInputs(
  evidence: CallableValueInputEvidence,
): CallableValueInputs {
  const {
    source,
    invocationInputs,
    collections,
    storage,
    objectValues,
    objectValueInitializers,
    closedStorageSymbols,
    inputUses,
    callableReferenceIsClosed,
  } = evidence;
  const consumerIsClosed = (consumer: Node): boolean =>
      directContainingCall(source, consumer) !== undefined ||
      objectValueInitializers.has(consumer) ||
      callableReferenceIsClosed?.(consumer) === true ||
      isCallableNonEscapingObservation(source, consumer) ||
      invocationInputs.parametersFor(consumer)?.some((parameter) =>
        storage.closed.has(parameter)
      ) === true ||
      transportedCallableDestinations(
          source,
          consumer,
          storage.closed,
          closedStorageSymbols,
          inputUses,
        ) !== undefined ||
      trackedInputDestination(
          source,
          consumer,
          storage.closed,
          closedStorageSymbols,
        ) !== undefined;
  const consumersAreClosed = (consumers: readonly Node[]): boolean =>
    consumers.every((consumer) => {
      let current = consumer;
      for (;;) {
        if (consumerIsClosed(current)) {
          return true;
        }
        const parent = source.ast.parent(current);
        if (parent === undefined) {
          return false;
        }
        if (isTransparentParent(source, parent, current)) {
          current = parent;
          continue;
        }
        if (
          source.ast.is.IsBinaryExpression(parent) &&
          isExactValueAssignmentOperator(source.ast.operatorKindName(parent))
        ) {
          return false;
        }
        const alternatives = sameValueAlternatives(source, parent);
        if (alternatives?.includes(current) !== true) {
          return false;
        }
        current = parent;
      }
    });
  return Object.freeze({
    contracts: collections.contracts,
    storageContracts: storage.contracts,
    valuesFor(declaration: Node): readonly Node[] | undefined {
      return storage.values.get(declaration) ??
        collections.values.get(declaration) ??
        objectValues.get(declaration);
    },
    isClosed(declaration: Node): boolean {
      return storage.closed.has(declaration) ||
        collections.closed.has(declaration) ||
        objectValues.has(declaration);
    },
    referenceConsumerIsClosed(reference: Node): boolean {
      return consumersAreClosed([reference]);
    },
    projectionConsumersAreClosed(consumers: readonly Node[]): boolean {
      return consumersAreClosed(consumers);
    },
  });
}
