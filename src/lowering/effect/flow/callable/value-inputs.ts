import type { Node, Symbol, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { KindConstructor } from "@tsonic/tsts/target-ast";

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
import {
  directContainingCall,
  isModuleForwardingReference,
} from "../../model/syntax.js";
import type { CallableInputUseContract } from "./input-use.js";
import type { ExactCallImplementations } from "./result-inputs.js";
import {
  indexDeclarationSymbols,
  isCallableNonEscapingObservation,
  isTransparentParent,
  trackedInputDestination,
  transportedCallableDestinations,
} from "./input-reference.js";

export interface CallableValueInputs {
  readonly contracts: readonly CallableCollectionContract[];
  readonly storageContracts: readonly CallableStorageContract[];
  valuesFor(declaration: Node): readonly Node[] | undefined;
  isClosed(declaration: Node): boolean;
  projectionConsumersAreClosed(consumers: readonly Node[]): boolean;
}

interface ReferenceCounts {
  total: number;
  admitted: number;
}

interface CallableValueInputEvidence {
  readonly source: TargetSourceProgram;
  readonly invocationInputs: ExactInvocationInputIndex;
  readonly collections: CallableCollectionInputs;
  readonly storage: CallableStorageInputs;
  readonly constructorValues: ReadonlyMap<Node, readonly Node[]>;
  readonly closedConstructors: ReadonlySet<Node>;
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
): CallableValueInputEvidence {
  const invocationInputs = exactInvocationInputs ??
    createExactInvocationInputIndex(source, program);
  const collections = collectCallableCollectionInputs(
    source,
    program,
    exactCallImplementations,
  );
  planningObserver?.("effect-indirect-value-collections");
  const mutableValues = new Map<Node, Node[]>();
  const constructorParameters = new Set<Node>();
  const constructorClasses = new Map<Node, Node>();
  const invalidConstructorParameters = new Set<Node>();
  for (const constructor of program.nodesOfKind(KindConstructor)) {
    const classDeclaration = source.ast.parent(constructor);
    if (
      classDeclaration === undefined ||
      !source.ast.is.IsClassDeclaration(classDeclaration)
    ) {
      continue;
    }
    constructorClasses.set(constructor, classDeclaration);
    for (const parameter of source.ast.parameters(constructor)) {
      if (parameter === undefined || !isReadonlyParameterProperty(source, parameter)) {
        continue;
      }
      if (invocationInputs.isInvalid(parameter)) {
        invalidConstructorParameters.add(parameter);
      }
      const inputs = invocationInputs.inputsFor(parameter);
      if (inputs === undefined) {
        continue;
      }
      constructorParameters.add(parameter);
      for (const input of inputs) {
        append(mutableValues, parameter, input);
      }
    }
  }
  planningObserver?.("effect-indirect-value-constructors");

  const classReferences = new Map<Node, ReferenceCounts>();
  for (const classDeclaration of constructorClasses.values()) {
    classReferences.set(classDeclaration, { total: 0, admitted: 0 });
  }
  for (const [classDeclaration, counts] of classReferences) {
    for (const reference of source.navigation.referencesToDeclaration(
      classDeclaration,
    )) {
      auditClassReference(source, reference, classDeclaration, counts);
    }
  }
  planningObserver?.("effect-indirect-value-class-references");
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
  );
  planningObserver?.("effect-indirect-value-storage");
  const propertyReferences = new Map<Node, ReferenceCounts>();
  for (const parameter of constructorParameters) {
    propertyReferences.set(parameter, { total: 0, admitted: 0 });
  }
  const closedStorageSymbols = indexDeclarationSymbols(
    source,
    storage.closed,
  );
  for (const [parameter, counts] of propertyReferences) {
    for (const reference of source.navigation.referencesToDeclaration(
      parameter,
    )) {
      auditPropertyReference(
        source,
        reference,
        parameter,
        counts,
        storage.closed,
        closedStorageSymbols,
        inputUses,
        invocationInputs,
        callableReferenceIsClosed,
      );
    }
  }
  planningObserver?.("effect-indirect-value-property-references");

  const constructorClosed = new Set<Node>();
  for (const [constructor, classDeclaration] of constructorClasses) {
    const classCounts = classReferences.get(classDeclaration);
    if (
      classCounts === undefined ||
      classCounts.total !== classCounts.admitted ||
      classCounts.admitted === 0
    ) {
      continue;
    }
    for (const parameter of source.ast.parameters(constructor)) {
      const propertyCounts = parameter === undefined
        ? undefined
        : propertyReferences.get(parameter);
      if (
        parameter !== undefined &&
        isReadonlyParameterProperty(source, parameter) &&
        !invalidConstructorParameters.has(parameter) &&
        mutableValues.has(parameter) &&
        propertyCounts !== undefined &&
        propertyCounts.total === propertyCounts.admitted &&
        propertyCounts.admitted !== 0
      ) {
        constructorClosed.add(parameter);
      }
    }
  }
  for (const values of mutableValues.values()) {
    Object.freeze(values);
  }
  let referenceCount = 0;
  for (const counts of classReferences.values()) {
    referenceCount += counts.total;
  }
  for (const counts of propertyReferences.values()) {
    referenceCount += counts.total;
  }
  let valueCount = 0;
  for (const values of mutableValues.values()) {
    valueCount += values.length;
  }
  for (const values of storage.values.values()) {
    valueCount += values.length;
  }
  for (const values of collections.values.values()) {
    valueCount += values.length;
  }
  planningObserver?.("effect-indirect-value-finalization", {
    closed: constructorClosed.size,
    contracts: collections.contracts.length + storage.contracts.length,
    declarations: constructorParameters.size + storage.closed.size +
      collections.closed.size,
    references: referenceCount,
    values: valueCount,
  });
  return Object.freeze({
    source,
    invocationInputs,
    collections,
    storage,
    constructorValues: mutableValues,
    closedConstructors: constructorClosed,
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
    constructorValues,
    closedConstructors,
    closedStorageSymbols,
    inputUses,
    callableReferenceIsClosed,
  } = evidence;
  return Object.freeze({
    contracts: collections.contracts,
    storageContracts: storage.contracts,
    valuesFor(declaration: Node): readonly Node[] | undefined {
      return storage.values.get(declaration) ??
        collections.values.get(declaration) ??
        constructorValues.get(declaration);
    },
    isClosed(declaration: Node): boolean {
      return storage.closed.has(declaration) ||
        collections.closed.has(declaration) ||
        closedConstructors.has(declaration);
    },
    projectionConsumersAreClosed(consumers: readonly Node[]): boolean {
      return consumers.every((consumer) =>
        directContainingCall(source, consumer) !== undefined ||
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
        ) !== undefined
      );
    },
  });
}

function auditClassReference(
  source: TargetSourceProgram,
  reference: Node,
  declaration: Node,
  counts: ReferenceCounts,
): void {
  if (!source.ast.is.IsIdentifier(reference)) {
    return;
  }
  if (
    reference === source.ast.name(declaration) ||
    isTypeOnlyReference(source, reference) ||
    isModuleForwardingReference(source, reference)
  ) {
    return;
  }
  counts.total += 1;
  if (directContainingNew(source, reference) !== undefined) {
    counts.admitted += 1;
  }
}

function auditPropertyReference(
  source: TargetSourceProgram,
  reference: Node,
  declaration: Node,
  counts: ReferenceCounts,
  closedStorage: ReadonlySet<Node>,
  closedStorageSymbols: ReadonlyMap<Symbol, Node>,
  inputUses?: CallableInputUseContract,
  invocationInputs?: ExactInvocationInputIndex,
  callableReferenceIsClosed?: (reference: Node) => boolean,
): void {
  if (source.ast.is.IsPropertyAccessExpression(reference)) {
    const selected = source.semantics.forNode(reference)
      .operations.propertyAccess(reference);
    countPropertyUse(
      selected?.selectedDeclaration === declaration ? counts : undefined,
      selected !== undefined &&
        propertyUseIsAdmitted(
          source,
          reference,
          closedStorage,
          closedStorageSymbols,
          inputUses,
          invocationInputs,
          callableReferenceIsClosed,
        ) &&
        selected.accessMode === "read" &&
        !selected.optionalChain,
    );
    return;
  }
  if (source.ast.is.IsElementAccessExpression(reference)) {
    const selected = source.semantics.forNode(reference)
      .operations.elementAccess(reference);
    countPropertyUse(
      selected?.selectedDeclaration === declaration ? counts : undefined,
      selected !== undefined &&
        propertyUseIsAdmitted(
          source,
          reference,
          closedStorage,
          closedStorageSymbols,
          inputUses,
          invocationInputs,
          callableReferenceIsClosed,
        ) &&
        selected.accessMode === "read" &&
        !selected.optionalChain,
    );
    return;
  }
  if (
    !source.ast.is.IsIdentifier(reference) ||
    isPropertyAccessName(source, reference)
  ) {
    return;
  }
  if (
    reference !== source.ast.name(declaration) &&
    !isTypeOnlyReference(source, reference) &&
    !isModuleForwardingReference(source, reference)
  ) {
    counts.total += 1;
  }
}

function propertyUseIsAdmitted(
  source: TargetSourceProgram,
  node: Node,
  closedStorage: ReadonlySet<Node>,
  closedStorageSymbols: ReadonlyMap<Symbol, Node>,
  inputUses?: CallableInputUseContract,
  invocationInputs?: ExactInvocationInputIndex,
  callableReferenceIsClosed?: (reference: Node) => boolean,
): boolean {
  const transported = transportedCallableDestinations(
    source,
    node,
    closedStorage,
    closedStorageSymbols,
    inputUses,
  );
  return directContainingCall(source, node) !== undefined ||
    callableReferenceIsClosed?.(node) === true ||
    transported !== undefined ||
    invocationInputs?.parametersFor(node)?.some((parameter) =>
      closedStorage.has(parameter)
    ) === true ||
    isCallableNonEscapingObservation(source, node) ||
    isInitializerOfClosedStorage(source, node, closedStorage);
}

function isInitializerOfClosedStorage(
  source: TargetSourceProgram,
  expression: Node,
  closedStorage: ReadonlySet<Node>,
): boolean {
  let current = expression;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return false;
    }
    if (isTransparentParent(source, parent, current)) {
      current = parent;
      continue;
    }
    return source.ast.is.IsVariableDeclaration(parent) &&
      source.ast.as.AsVariableDeclaration(parent)?.Initializer === current &&
      closedStorage.has(parent);
  }
}

function countPropertyUse(
  counts: ReferenceCounts | undefined,
  admitted: boolean,
): void {
  if (counts === undefined) {
    return;
  }
  counts.total += 1;
  if (admitted) {
    counts.admitted += 1;
  }
}

function isReadonlyParameterProperty(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  return source.ast.is.IsParameterDeclaration(node) &&
    source.ast.hasModifierKind(node, "readonly") &&
    source.ast.parent(node) !== undefined &&
    source.ast.is.IsConstructorDeclaration(source.ast.parent(node));
}

function directContainingNew(
  source: TargetSourceProgram,
  reference: Node,
): Node | undefined {
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return undefined;
    }
    if (source.ast.is.IsNewExpression(parent)) {
      return source.ast.as.AsNewExpression(parent)?.Expression === current
        ? parent
        : undefined;
    }
    if (
      source.ast.is.IsPropertyAccessExpression(parent) ||
      source.ast.is.IsParenthesizedExpression(parent)
    ) {
      current = parent;
      continue;
    }
    return undefined;
  }
}

function isTypeOnlyReference(source: TargetSourceProgram, node: Node): boolean {
  let current: Node | undefined = node;
  while (current !== undefined) {
    if (source.ast.is.IsTypeReferenceNode(current)) {
      return true;
    }
    if (
      source.ast.is.IsExpressionStatement(current) ||
      source.ast.is.IsVariableDeclaration(current) ||
      source.ast.is.IsCallExpression(current) ||
      source.ast.is.IsNewExpression(current) ||
      source.ast.is.IsClassDeclaration(current) ||
      source.ast.is.IsSourceFile(current)
    ) {
      return false;
    }
    current = source.ast.parent(current);
  }
  return false;
}

function isPropertyAccessName(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  const parent = source.ast.parent(node);
  return parent !== undefined &&
    source.ast.is.IsPropertyAccessExpression(parent) &&
    source.ast.as.AsPropertyAccessExpression(parent)?.name === node;
}

function append(target: Map<Node, Node[]>, key: Node, value: Node): void {
  const values = target.get(key);
  if (values === undefined) {
    target.set(key, [value]);
  } else {
    values.push(value);
  }
}
