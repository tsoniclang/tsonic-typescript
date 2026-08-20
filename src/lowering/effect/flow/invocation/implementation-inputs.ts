import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import {
  exactSourceCallInputsForDeclaration,
} from "./call-binding.js";
import type { ExactAggregateProjectionIndex } from "../aggregate/projection.js";
import {
  selectRestElementInputs,
  type ExactInvocationInputIndex,
} from "./inputs.js";

export interface ExactImplementationInputSource {
  readonly calls: readonly Node[];
  readonly implementations: readonly Node[];
}

export function extendExactInvocationInputIndex(
  source: TargetSourceProgram,
  direct: ExactInvocationInputIndex,
  sources: Iterable<ExactImplementationInputSource>,
  projections?: ExactAggregateProjectionIndex,
  invalidImplementations: ReadonlySet<Node> = new Set(),
): ExactInvocationInputIndex {
  const values = new Map<Node, Node[]>();
  const inputGroups = new Map<Node, (readonly Node[])[]>();
  const destinations = new Map<Node, Node[]>();
  const observed = new Set<Node>();
  const invalid = new Set<Node>();
  for (const entry of sources) {
    for (const implementation of entry.implementations) {
      const parameters = source.ast.parameters(implementation).filter(
        (parameter): parameter is Node => parameter !== undefined,
      );
      if (invalidImplementations.has(implementation)) {
        for (const parameter of parameters) {
          invalid.add(parameter);
        }
      }
      for (const call of entry.calls) {
        collectImplementationInputs(
          source,
          call,
          implementation,
          projections,
          values,
          inputGroups,
          destinations,
          observed,
          invalid,
        );
      }
    }
  }
  const sealedValues = seal(values);
  const sealedDestinations = seal(destinations);
  return Object.freeze({
    inputsFor(parameter: Node): readonly Node[] | undefined {
      return combine(direct.inputsFor(parameter), sealedValues.get(parameter));
    },
    restElementInputsFor(
      parameter: Node,
      index: number,
    ): readonly Node[] | undefined {
      if (direct.isInvalid(parameter) || invalid.has(parameter)) {
        return undefined;
      }
      const inputs: Node[] = [];
      let hasEvidence = false;
      if (direct.isClosed(parameter)) {
        hasEvidence = true;
        const selected = direct.restElementInputsFor(parameter, index);
        if (selected === undefined) {
          return undefined;
        }
        inputs.push(...selected);
      }
      if (observed.has(parameter)) {
        hasEvidence = true;
        const selected = selectRestElementInputs(
          source,
          parameter,
          index,
          inputGroups.get(parameter) ?? [],
        );
        if (selected === undefined) {
          return undefined;
        }
        inputs.push(...selected);
      }
      return hasEvidence ? Object.freeze([...new Set(inputs)]) : undefined;
    },
    parametersFor(input: Node): readonly Node[] | undefined {
      return combine(
        direct.parametersFor(input),
        sealedDestinations.get(input),
      );
    },
    isInvalid(parameter: Node): boolean {
      return direct.isInvalid(parameter) || invalid.has(parameter);
    },
    isClosed(parameter: Node): boolean {
      return !direct.isInvalid(parameter) &&
        !invalid.has(parameter) &&
        (direct.isClosed(parameter) || observed.has(parameter));
    },
  });
}

function collectImplementationInputs(
  source: TargetSourceProgram,
  call: Node,
  implementation: Node,
  projections: ExactAggregateProjectionIndex | undefined,
  values: Map<Node, Node[]>,
  inputGroups: Map<Node, (readonly Node[])[]>,
  destinations: Map<Node, Node[]>,
  observed: Set<Node>,
  invalid: Set<Node>,
): void {
  const parameters = source.ast.parameters(implementation).filter(
    (parameter): parameter is Node => parameter !== undefined,
  );
  const resolved = exactSourceCallInputsForDeclaration(
    source,
    call,
    implementation,
    projections,
  );
  if (resolved === undefined) {
    for (const parameter of parameters) {
      invalid.add(parameter);
    }
    return;
  }
  for (const [parameter, inputs] of resolved.inputs) {
    observed.add(parameter);
    ensure(values, parameter);
    appendGroup(inputGroups, parameter, inputs);
    for (const input of inputs) {
      appendUnique(values, parameter, input);
      appendUnique(destinations, input, parameter);
    }
  }
  for (const parameter of resolved.unresolvedParameters) {
    observed.add(parameter);
    invalid.add(parameter);
  }
}

function seal(values: ReadonlyMap<Node, readonly Node[]>):
  ReadonlyMap<Node, readonly Node[]> {
  return new Map([...values].map(([node, entries]) => [
    node,
    Object.freeze([...entries]),
  ]));
}

function combine(
  left: readonly Node[] | undefined,
  right: readonly Node[] | undefined,
): readonly Node[] | undefined {
  return left === undefined
    ? right
    : right === undefined
    ? left
    : Object.freeze([...new Set([...left, ...right])]);
}

function appendUnique(
  target: Map<Node, Node[]>,
  key: Node,
  value: Node,
): void {
  const values = target.get(key);
  if (values === undefined) {
    target.set(key, [value]);
  } else if (!values.includes(value)) {
    values.push(value);
  }
}

function ensure(target: Map<Node, Node[]>, key: Node): void {
  if (!target.has(key)) {
    target.set(key, []);
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
