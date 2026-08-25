import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  KindCallExpression,
  KindFunctionDeclaration,
  KindNewExpression,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { TypeScriptActiveCooperativeEffectProfile } from "../../../profile.js";
import { resolveExactSourceInvocation } from "../../model/exact-source-invocation.js";
import {
  sourceBodyInspectionIsExact,
  type ExactSourceBodyInspection,
} from "../../model/source-membership.js";
import { exactSourceCallImplementationInputs } from "./call-binding.js";
import type { ExactAggregateProjectionIndex } from "../aggregate/projection.js";
import {
  directContainingInvocation,
  isModuleForwardingReference,
} from "../../model/syntax.js";

export interface ExactInvocationInputIndex {
  parameters(): Iterable<Node>;
  inputsFor(parameter: Node): readonly Node[] | undefined;
  inputGroupsFor(
    parameter: Node,
  ): readonly (readonly Node[])[] | undefined;
  restElementInputsFor(
    parameter: Node,
    index: number,
  ): readonly Node[] | undefined;
  parametersFor(input: Node): readonly Node[] | undefined;
  isInvalid(parameter: Node): boolean;
  isClosed(parameter: Node): boolean;
}

export interface ExactInvocationInputIndexSnapshot {
  matches(index: ExactInvocationInputIndex): boolean;
}

interface ExactInvocationInputSnapshotEntry {
  readonly inputs?: readonly Node[];
  readonly inputGroups?: readonly (readonly Node[])[];
  readonly invalid: boolean;
  readonly closed: boolean;
}

export interface MaterializedExactInvocationInputs {
  readonly parameters: Iterable<Node>;
  readonly inputs: ReadonlyMap<Node, readonly Node[]>;
  readonly inputGroups: ReadonlyMap<Node, readonly (readonly Node[])[]>;
  readonly destinations: ReadonlyMap<Node, readonly Node[]>;
  readonly invalid: ReadonlySet<Node>;
  readonly closed: ReadonlySet<Node>;
}

export function createExactInvocationInputIndex(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  projections?: ExactAggregateProjectionIndex,
  cooperativeEffects: TypeScriptActiveCooperativeEffectProfile = "closed-direct",
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
): ExactInvocationInputIndex {
  const inputs = new Map<Node, Node[]>();
  const inputGroups = new Map<Node, (readonly Node[])[]>();
  const destinations = new Map<Node, Node[]>();
  const invalid = new Set<Node>();
  const callsByImplementation = new Map<Node, Set<Node>>();
  const referenceDeclarationsByImplementation = new Map<Node, Set<Node>>();
  for (const call of program.nodesOfKinds([
    KindCallExpression,
    KindNewExpression,
  ])) {
    const target = resolveExactSourceInvocation(
      source,
      call,
      bodyInspectionIsCertified,
    );
    if (target === undefined) {
      continue;
    }
    const { implementation } = target;
    appendSet(callsByImplementation, implementation, call);
    appendSet(
      referenceDeclarationsByImplementation,
      implementation,
      implementation,
    );
    appendSet(
      referenceDeclarationsByImplementation,
      implementation,
      target.contract,
    );
    const implementationParameters = source.ast.parameters(implementation).filter(
      (parameter): parameter is Node => parameter !== undefined,
    );
    const invocation = exactSourceCallImplementationInputs(
      source,
      call,
      projections,
      bodyInspectionIsCertified,
    );
    if (invocation === undefined || invocation.declaration !== implementation) {
      for (const parameter of implementationParameters) {
        invalid.add(parameter);
      }
      continue;
    }
    for (const [parameter, argumentsForParameter] of invocation.inputs) {
      ensure(inputs, parameter);
      appendGroup(inputGroups, parameter, argumentsForParameter);
      for (const argument of argumentsForParameter) {
        append(inputs, parameter, argument);
        append(destinations, argument, parameter);
      }
    }
    for (const parameter of invocation.unresolvedParameters) {
      invalid.add(parameter);
    }
  }
  for (const implementation of program.nodesOfKind(KindFunctionDeclaration)) {
    if (
      callsByImplementation.has(implementation) ||
      source.ast.body(implementation) === undefined ||
      !sourceBodyInspectionIsExact(
        source,
        implementation,
        bodyInspectionIsCertified,
      ) ||
      source.ast.hasModifierKind(implementation, "ambient") ||
      (cooperativeEffects === "closed-direct" &&
        (source.ast.hasModifierKind(implementation, "export") ||
          source.ast.hasModifierKind(implementation, "default"))) ||
      !callableReferencesAreClosed(
        source,
        program,
        new Set([implementation]),
        new Set(),
        cooperativeEffects,
      )
    ) {
      continue;
    }
    for (const parameter of source.ast.parameters(implementation)) {
      if (parameter !== undefined) {
        ensure(inputs, parameter);
      }
    }
  }
  for (const [implementation, calls] of callsByImplementation) {
    if (!callableReferencesAreClosed(
      source,
      program,
      referenceDeclarationsByImplementation.get(implementation) ??
        new Set([implementation]),
      calls,
      cooperativeEffects,
    )) {
      for (const parameter of source.ast.parameters(implementation)) {
        if (parameter !== undefined) {
          invalid.add(parameter);
        }
      }
    }
  }
  for (const parameter of inputs.keys()) {
    ensureGroups(inputGroups, parameter);
  }
  return materializeExactInvocationInputIndex(source, {
    parameters: [...inputs.keys(), ...invalid],
    inputs,
    inputGroups,
    destinations,
    invalid,
    closed: new Set(inputs.keys()),
  });
}

export function materializeExactInvocationInputIndex(
  source: TargetSourceProgram,
  evidence: MaterializedExactInvocationInputs,
): ExactInvocationInputIndex {
  const inputs = sealNodeLists(evidence.inputs);
  const inputGroups = sealInputGroups(evidence.inputGroups);
  const destinations = sealNodeLists(evidence.destinations);
  const invalid = new Set(evidence.invalid);
  const closed = new Set(evidence.closed);
  const parameters = Object.freeze([...new Set(evidence.parameters)]);
  return Object.freeze({
    parameters(): Iterable<Node> {
      return parameters;
    },
    inputsFor(parameter: Node): readonly Node[] | undefined {
      return inputs.get(parameter);
    },
    inputGroupsFor(
      parameter: Node,
    ): readonly (readonly Node[])[] | undefined {
      return inputGroups.get(parameter);
    },
    restElementInputsFor(
      parameter: Node,
      index: number,
    ): readonly Node[] | undefined {
      return closed.has(parameter) && !invalid.has(parameter)
        ? selectRestElementInputs(
          source,
          parameter,
          index,
          inputGroups.get(parameter) ?? [],
        )
        : undefined;
    },
    parametersFor(input: Node): readonly Node[] | undefined {
      return destinations.get(input);
    },
    isInvalid(parameter: Node): boolean {
      return invalid.has(parameter);
    },
    isClosed(parameter: Node): boolean {
      return closed.has(parameter) && !invalid.has(parameter);
    },
  });
}

export function snapshotExactInvocationInputIndex(
  index: ExactInvocationInputIndex,
): ExactInvocationInputIndexSnapshot {
  const parameters = Object.freeze([...index.parameters()]);
  const entries = new Map<Node, ExactInvocationInputSnapshotEntry>();
  for (const parameter of parameters) {
    const inputs = index.inputsFor(parameter);
    const inputGroups = index.inputGroupsFor(parameter);
    entries.set(parameter, Object.freeze({
      ...(inputs === undefined ? {} : { inputs: Object.freeze([...inputs]) }),
      ...(inputGroups === undefined
        ? {}
        : {
          inputGroups: Object.freeze(inputGroups.map((group) =>
            Object.freeze([...group])
          )),
        }),
      invalid: index.isInvalid(parameter),
      closed: index.isClosed(parameter),
    }));
  }
  return Object.freeze({
    matches(selected: ExactInvocationInputIndex): boolean {
      return invocationInputSnapshotMatches(parameters, entries, selected);
    },
  });
}

export function sameExactInvocationInputIndexSnapshot(
  snapshot: ExactInvocationInputIndexSnapshot,
  index: ExactInvocationInputIndex,
): boolean {
  return snapshot.matches(index);
}

function invocationInputSnapshotMatches(
  snapshotParameters: readonly Node[],
  snapshotEntries: ReadonlyMap<Node, ExactInvocationInputSnapshotEntry>,
  index: ExactInvocationInputIndex,
): boolean {
  const parameters = new Set(index.parameters());
  if (
    parameters.size !== snapshotParameters.length ||
    snapshotParameters.some((parameter) => !parameters.has(parameter))
  ) {
    return false;
  }
  return snapshotParameters.every((parameter) => {
    const entry = snapshotEntries.get(parameter);
    return entry !== undefined &&
      entry.invalid === index.isInvalid(parameter) &&
      entry.closed === index.isClosed(parameter) &&
      sameNodeSet(entry.inputs, index.inputsFor(parameter)) &&
      sameInputGroups(entry.inputGroups, index.inputGroupsFor(parameter));
  });
}

function sealNodeLists(
  values: ReadonlyMap<Node, readonly Node[]>,
): ReadonlyMap<Node, readonly Node[]> {
  return new Map([...values].map(([node, entries]) => [
    node,
    Object.freeze([...entries]),
  ]));
}

function sealInputGroups(
  values: ReadonlyMap<Node, readonly (readonly Node[])[]>,
): ReadonlyMap<Node, readonly (readonly Node[])[]> {
  return new Map([...values].map(([node, groups]) => [
    node,
    Object.freeze(groups.map((group) => Object.freeze([...group]))),
  ]));
}

export function sameExactInvocationInputIndexes(
  left: ExactInvocationInputIndex,
  right: ExactInvocationInputIndex,
): boolean {
  const leftParameters = new Set(left.parameters());
  const rightParameters = new Set(right.parameters());
  if (
    leftParameters.size !== rightParameters.size ||
    [...leftParameters].some((parameter) => !rightParameters.has(parameter))
  ) {
    return false;
  }
  return [...leftParameters].every((parameter) =>
    left.isInvalid(parameter) === right.isInvalid(parameter) &&
    left.isClosed(parameter) === right.isClosed(parameter) &&
    sameNodeSet(left.inputsFor(parameter), right.inputsFor(parameter)) &&
    sameInputGroups(
      left.inputGroupsFor(parameter),
      right.inputGroupsFor(parameter),
    )
  );
}

function sameInputGroups(
  left: readonly (readonly Node[])[] | undefined,
  right: readonly (readonly Node[])[] | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return left.length === right.length && left.every((group, index) =>
    sameNodeSequence(group, right[index])
  );
}

function sameNodeSequence(
  left: readonly Node[],
  right: readonly Node[] | undefined,
): boolean {
  return right !== undefined &&
    left.length === right.length &&
    left.every((node, index) => node === right[index]);
}

function sameNodeSet(
  left: readonly Node[] | undefined,
  right: readonly Node[] | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size &&
    [...leftSet].every((node) => rightSet.has(node));
}

export function selectRestElementInputs(
  source: TargetSourceProgram,
  parameter: Node,
  index: number,
  inputGroups: readonly (readonly Node[])[],
): readonly Node[] | undefined {
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    source.ast.as.AsParameterDeclaration(parameter)?.DotDotDotToken === undefined
  ) {
    return undefined;
  }
  const selected: Node[] = [];
  for (const group of inputGroups) {
    const input = group[index];
    if (input === undefined) {
      return undefined;
    }
    if (!selected.includes(input)) {
      selected.push(input);
    }
  }
  return Object.freeze(selected);
}

function callableReferencesAreClosed(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  declarations: ReadonlySet<Node>,
  calls: ReadonlySet<Node>,
  cooperativeEffects: TypeScriptActiveCooperativeEffectProfile,
): boolean {
  return [...declarations].every((declaration) =>
    source.navigation.referencesToDeclaration(declaration).every((reference) => {
      const owner = source.ast.parent(reference);
      if (
        owner !== undefined &&
        source.ast.is.IsFunctionDeclaration(owner) &&
        source.ast.name(owner) === reference
      ) {
        return true;
      }
      if (isModuleForwardingReference(source, reference)) {
        return cooperativeEffects === "closed-program";
      }
      const invocation = directContainingInvocation(source, reference);
      return invocation !== undefined && calls.has(invocation);
    })
  );
}

function append(
  target: Map<Node, Node[]>,
  declaration: Node,
  expression: Node,
): void {
  const selected = target.get(declaration);
  if (selected === undefined) {
    target.set(declaration, [expression]);
  } else {
    selected.push(expression);
  }
}

function ensure(target: Map<Node, Node[]>, declaration: Node): void {
  if (!target.has(declaration)) {
    target.set(declaration, []);
  }
}

function appendGroup(
  target: Map<Node, (readonly Node[])[]>,
  parameter: Node,
  inputs: readonly Node[],
): void {
  const group = Object.freeze([...inputs]);
  const selected = target.get(parameter);
  if (selected === undefined) {
    target.set(parameter, [group]);
  } else {
    selected.push(group);
  }
}

function ensureGroups(
  target: Map<Node, (readonly Node[])[]>,
  parameter: Node,
): void {
  if (!target.has(parameter)) {
    target.set(parameter, []);
  }
}

function appendSet(
  target: Map<Node, Set<Node>>,
  key: Node,
  value: Node,
): void {
  const selected = target.get(key);
  if (selected === undefined) {
    target.set(key, new Set([value]));
  } else {
    selected.add(value);
  }
}
