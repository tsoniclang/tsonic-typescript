import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  KindCallExpression,
  KindFunctionDeclaration,
  KindNewExpression,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import { resolveProjectInvocation } from "../../model/project-invocation.js";
import { exactSourceCallImplementationInputs } from "./call-binding.js";
import type { ExactAggregateProjectionIndex } from "../aggregate/projection.js";
import {
  directContainingInvocation,
  isModuleForwardingReference,
} from "../../model/syntax.js";

export interface ExactInvocationInputIndex {
  inputsFor(parameter: Node): readonly Node[] | undefined;
  restElementInputsFor(
    parameter: Node,
    index: number,
  ): readonly Node[] | undefined;
  parametersFor(input: Node): readonly Node[] | undefined;
  isInvalid(parameter: Node): boolean;
  isClosed(parameter: Node): boolean;
}

export function createExactInvocationInputIndex(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  projections?: ExactAggregateProjectionIndex,
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
    const target = resolveProjectInvocation(source, call);
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
      source.ast.hasModifierKind(implementation, "ambient") ||
      source.ast.hasModifierKind(implementation, "export") ||
      source.ast.hasModifierKind(implementation, "default") ||
      !callableReferencesAreClosed(
        source,
        program,
        new Set([implementation]),
        new Set(),
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
    )) {
      for (const parameter of source.ast.parameters(implementation)) {
        if (parameter !== undefined) {
          invalid.add(parameter);
        }
      }
    }
  }
  const sealedInputs = new Map<Node, readonly Node[]>(
    [...inputs].map(([parameter, values]) => [
      parameter,
      Object.freeze(values),
    ]),
  );
  const sealedParameters = new Map<Node, readonly Node[]>(
    [...destinations].map(([input, selected]) => [
      input,
      Object.freeze(selected),
    ]),
  );
  return Object.freeze({
    inputsFor(parameter: Node): readonly Node[] | undefined {
      return sealedInputs.get(parameter);
    },
    restElementInputsFor(
      parameter: Node,
      index: number,
    ): readonly Node[] | undefined {
      return sealedInputs.has(parameter) && !invalid.has(parameter)
        ? selectRestElementInputs(
          source,
          parameter,
          index,
          inputGroups.get(parameter) ?? [],
        )
        : undefined;
    },
    parametersFor(input: Node): readonly Node[] | undefined {
      return sealedParameters.get(input);
    },
    isInvalid(parameter: Node): boolean {
      return invalid.has(parameter);
    },
    isClosed(parameter: Node): boolean {
      return sealedInputs.has(parameter) && !invalid.has(parameter);
    },
  });
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
        return false;
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
