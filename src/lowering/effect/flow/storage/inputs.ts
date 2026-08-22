import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  KindElementAccessExpression,
  KindIdentifier,
  KindParameter,
  KindPropertyAccessExpression,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { TypeScriptPlanningObserver } from "../../../planning-observer.js";
import type { CallableInputUseContract } from "../callable/input-use.js";
import type { ExactCallImplementations } from "../callable/result-inputs.js";
import {
  createExactInvocationInputIndex,
  type ExactInvocationInputIndex,
} from "../invocation/inputs.js";
import {
  callableDeclarationHasResolvableType,
} from "../../model/callable-contract/resolution.js";
import {
  indexDeclarationSymbols,
  indexParameterUses,
} from "../callable/input-reference.js";
import type { ParameterUses } from "../callable/input-reference.js";
import {
  isFunctionLike,
} from "../../model/syntax.js";
import {
  auditCallableLocalUse,
  collectCallableLocals,
} from "../callable/local-inputs.js";
import {
  collectCallableFields,
} from "./fields.js";
import { closeDependencyCandidates } from "../../closure/dependency-closure.js";
import { createCallableStorageContracts } from "./contracts.js";
import type { CallableStorageContract } from "./contracts.js";
import {
  auditCallableOwnerReference,
  auditFieldUse,
  type StorageReferenceCounts,
} from "./reference-audit.js";

export interface CallableStorageInputs {
  readonly values: ReadonlyMap<Node, readonly Node[]>;
  readonly closed: ReadonlySet<Node>;
  readonly contracts: readonly CallableStorageContract[];
}

interface ClosedParameters {
  readonly declarations: ReadonlySet<Node>;
  readonly ownerDestinations: ReadonlyMap<Node, ReadonlySet<Node>>;
  readonly uses: ParameterUses;
}

export function collectCallableStorageInputs(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  excludedDeclarations: ReadonlySet<Node>,
  inputUses?: CallableInputUseContract,
  exactInvocationInputs?: ExactInvocationInputIndex,
  exactCallImplementations?: ExactCallImplementations,
  callableReferenceIsClosed?: (reference: Node) => boolean,
  planningObserver?: TypeScriptPlanningObserver,
): CallableStorageInputs {
  const invocationInputs = exactInvocationInputs ??
    createExactInvocationInputIndex(source, program);
  const callableFields = collectCallableFields(source, program);
  planningObserver?.("effect-indirect-storage-fields");
  const fields = callableFields.declarations;
  const parameters = collectCallableParameters(source, program);
  const localValues = collectCallableLocals(
    source,
    excludedDeclarations,
    program,
  );
  planningObserver?.("effect-indirect-storage-declarations");
  const locals = new Set(localValues.keys());
  const storageDeclarations = new Set([
    ...parameters.keys(),
    ...fields,
    ...locals,
  ]);
  const storageSymbols = indexDeclarationSymbols(source, storageDeclarations);
  const parameterValues = new Map<Node, Node[]>();
  const fieldValues = new Map<Node, Node[]>(
    [...callableFields.initialValues].map(([field, values]) => [
      field,
      [...values],
    ]),
  );
  const invalidInputs = new Set<Node>();

  for (const declaration of new Set([...parameters.keys(), ...fields])) {
    if (invocationInputs.isInvalid(declaration)) {
      invalidInputs.add(declaration);
    }
    for (const input of invocationInputs.inputsFor(declaration) ?? []) {
      if (parameters.has(declaration)) {
        append(parameterValues, declaration, input);
      }
      if (fields.has(declaration)) {
        append(fieldValues, declaration, input);
      }
    }
  }

  const parameterClosure = closeParameters(
    source,
    parameters,
    fields,
    locals,
    invalidInputs,
    invocationInputs,
    program,
    inputUses,
    callableReferenceIsClosed,
  );
  planningObserver?.("effect-indirect-storage-parameters");
  for (const [parameter, assigned] of parameterClosure.uses.assignedValues) {
    for (const value of assigned) {
      append(parameterValues, parameter, value);
    }
  }
  const preliminaryParameters = parameterClosure.declarations;

  const fieldCounts = new Map<Node, StorageReferenceCounts>();
  const localCounts = new Map<Node, StorageReferenceCounts>();
  const storageDestinations = new Map<Node, Set<Node>>();
  for (const field of fields) {
    fieldCounts.set(field, { total: 0, admitted: 0 });
  }
  for (const local of locals) {
    localCounts.set(local, { total: 0, admitted: 0 });
  }
  for (const [field] of fieldCounts) {
    for (const reference of source.navigation.referencesToDeclaration(field)) {
      auditFieldUse(
        source,
        reference,
        fieldCounts,
        fieldValues,
        fields,
        storageDeclarations,
        storageSymbols,
        storageDestinations,
        inputUses,
        invocationInputs,
        callableReferenceIsClosed,
      );
    }
  }
  for (const [local, counts] of localCounts) {
    for (const reference of source.navigation.referencesToDeclaration(local)) {
      auditCallableLocalUse(
        source,
        reference,
        local,
        counts,
        localValues,
        storageDeclarations,
        storageSymbols,
        storageDestinations,
        inputUses,
        invocationInputs,
        callableReferenceIsClosed,
      );
    }
  }
  planningObserver?.("effect-indirect-storage-references");
  const validFields = callableFields.close(
    fieldValues,
    inputUses?.invocationTransports,
    exactCallImplementations,
    callableReferenceIsClosed,
    planningObserver,
  );
  planningObserver?.("effect-indirect-storage-boundaries");

  const candidateFields = new Set<Node>();
  for (const [field, counts] of fieldCounts) {
    const constructor = source.ast.parent(field);
    if (
      constructor !== undefined &&
      !invalidInputs.has(field) &&
      counts.total === counts.admitted &&
      counts.admitted !== 0 &&
      fieldValues.has(field) &&
      validFields.has(field)
    ) {
      candidateFields.add(field);
    }
  }
  const candidateLocals = new Set<Node>();
  for (const [local, counts] of localCounts) {
    if (
      counts.total === counts.admitted &&
      counts.admitted !== 0 &&
      (localValues.get(local)?.length ?? 0) !== 0
    ) {
      candidateLocals.add(local);
    }
  }
  const closedDeclarations = closeStorageDeclarations(
    new Set([
      ...preliminaryParameters,
      ...candidateFields,
      ...candidateLocals,
    ]),
    [
      parameterClosure.uses.dependencies,
      parameterClosure.ownerDestinations,
      storageDestinations,
    ],
  );
  const closedParameters = new Set([...preliminaryParameters].filter(
    (parameter) => closedDeclarations.has(parameter),
  ));
  const closedFields = new Set([...candidateFields].filter(
    (field) => closedDeclarations.has(field),
  ));
  const closedLocals = new Set([...candidateLocals].filter(
    (local) => closedDeclarations.has(local),
  ));

  const values = new Map<Node, readonly Node[]>();
  for (const parameter of closedParameters) {
    const inputs = parameterValues.get(parameter);
    if (inputs !== undefined && inputs.length !== 0) {
      values.set(parameter, Object.freeze(inputs));
    }
  }
  for (const field of closedFields) {
    const inputs = fieldValues.get(field);
    if (inputs !== undefined && inputs.length !== 0) {
      values.set(field, Object.freeze(inputs));
    }
  }
  for (const local of closedLocals) {
    const inputs = localValues.get(local);
    if (inputs !== undefined && inputs.length !== 0) {
      values.set(local, Object.freeze(inputs));
    }
  }
  const contracts = createCallableStorageContracts(
    source,
    closedDeclarations,
    [
      parameterClosure.uses.dependencies,
      parameterClosure.ownerDestinations,
      storageDestinations,
    ],
  );
  return Object.freeze({
    values,
    closed: closedDeclarations,
    contracts: Object.freeze(contracts),
  });
}

function closeStorageDeclarations(
  candidates: Set<Node>,
  destinationMaps: readonly ReadonlyMap<Node, ReadonlySet<Node>>[],
): Set<Node> {
  return new Set(closeDependencyCandidates(candidates, destinationMaps));
}

function collectCallableParameters(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ReadonlyMap<Node, Node> {
  const parameters = new Map<Node, Node>();
  for (const node of program.nodesOfKind(KindParameter)) {
    if (
      isParameterProperty(source, node) ||
      !callableDeclarationHasResolvableType(source, node)
    ) {
      continue;
    }
    const owner = source.ast.parent(node);
    if (
      owner !== undefined &&
      isFunctionLike(source, owner) &&
      source.ast.body(owner) !== undefined
    ) {
      parameters.set(node, owner);
    }
  }
  return parameters;
}

function closeParameters(
  source: TargetSourceProgram,
  parameters: ReadonlyMap<Node, Node>,
  fields: ReadonlySet<Node>,
  locals: ReadonlySet<Node>,
  invalidParameters: ReadonlySet<Node>,
  invocationInputs: ExactInvocationInputIndex,
  program: TargetProgramIndex,
  inputUses?: CallableInputUseContract,
  callableReferenceIsClosed?: (reference: Node) => boolean,
): ClosedParameters {
  const ownerCounts = new Map<Node, StorageReferenceCounts>();
  const ownerParameters = new Map<Node, Set<Node>>();
  for (const owner of parameters.values()) {
    ownerCounts.set(owner, { total: 0, admitted: 0 });
  }
  for (const [parameter, owner] of parameters) {
    appendSet(ownerParameters, owner, parameter);
  }
  const ownerSymbols = indexDeclarationSymbols(source, ownerCounts.keys());
  const storageDeclarations = new Set([
    ...parameters.keys(),
    ...fields,
    ...locals,
  ]);
  const storageSymbols = indexDeclarationSymbols(source, storageDeclarations);
  const ownerDestinations = new Map<Node, Set<Node>>();
  for (const node of program.nodesOfKinds([
    KindIdentifier,
    KindPropertyAccessExpression,
    KindElementAccessExpression,
  ])) {
    auditCallableOwnerReference(
      source,
      node,
      ownerCounts,
      ownerSymbols,
      ownerParameters,
      storageDeclarations,
      storageSymbols,
      ownerDestinations,
      invocationInputs,
      inputUses,
      callableReferenceIsClosed,
    );
  }
  const closed = new Set<Node>();
  for (const [parameter, owner] of parameters) {
    const counts = ownerCounts.get(owner);
    if (
      !invalidParameters.has(parameter) &&
      counts !== undefined &&
      counts.total === counts.admitted &&
      (counts.admitted !== 0 || invocationInputs.isClosed(parameter))
    ) {
      closed.add(parameter);
    }
  }
  const uses = indexParameterUses(
    source,
    parameters.keys(),
    new Set([...fields, ...locals]),
    inputUses,
    invocationInputs,
    callableReferenceIsClosed,
  );
  for (const parameter of uses.invalid) {
    closed.delete(parameter);
  }
  return {
    declarations: closeDependencyCandidates(
      closed,
      [uses.dependencies],
      (dependency) => parameters.has(dependency),
    ),
    ownerDestinations,
    uses,
  };
}

function isParameterProperty(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  const parent = source.ast.parent(node);
  return parent !== undefined &&
    source.ast.is.IsConstructorDeclaration(parent) &&
    (["public", "private", "protected", "readonly"] as const).some((modifier) =>
      source.ast.hasModifierKind(node, modifier)
    );
}

function append(target: Map<Node, Node[]>, key: Node, value: Node): void {
  const values = target.get(key);
  if (values === undefined) {
    target.set(key, [value]);
  } else {
    values.push(value);
  }
}

function appendSet(target: Map<Node, Set<Node>>, key: Node, value: Node): void {
  const values = target.get(key);
  if (values === undefined) {
    target.set(key, new Set([value]));
  } else {
    values.add(value);
  }
}
