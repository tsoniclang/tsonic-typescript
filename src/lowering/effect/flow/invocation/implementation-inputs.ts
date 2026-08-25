import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import {
  exactSourceCallInputsForDeclaration,
} from "./call-binding.js";
import type { ExactAggregateProjectionIndex } from "../aggregate/projection.js";
import {
  materializeExactInvocationInputIndex,
  type ExactInvocationInputIndex,
} from "./inputs.js";
import { isFunctionLike } from "../../model/syntax.js";

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
  const state = snapshotInvocationInputs(direct);
  for (const entry of sources) {
    for (const implementation of entry.implementations) {
      if (!isFunctionLike(source, implementation)) {
        throw new Error(
          "exact implementation-input source contains a non-callable implementation",
        );
      }
      const parameters = source.ast.parameters(implementation).filter(
        (parameter): parameter is Node => parameter !== undefined,
      );
      if (invalidImplementations.has(implementation)) {
        for (const parameter of parameters) {
          state.invalid.add(parameter);
          state.parameters.add(parameter);
        }
      }
      for (const call of entry.calls) {
        collectImplementationInputs(
          source,
          call,
          implementation,
          projections,
          state,
        );
      }
    }
  }
  return materializeExactInvocationInputIndex(source, {
    parameters: state.parameters,
    inputs: state.values,
    inputGroups: state.inputGroups,
    destinations: state.destinations,
    invalid: state.invalid,
    closed: state.closed,
  });
}

interface MutableInvocationInputs {
  readonly parameters: Set<Node>;
  readonly values: Map<Node, Node[]>;
  readonly inputGroups: Map<Node, (readonly Node[])[]>;
  readonly destinations: Map<Node, Node[]>;
  readonly invalid: Set<Node>;
  readonly closed: Set<Node>;
}

function snapshotInvocationInputs(
  direct: ExactInvocationInputIndex,
): MutableInvocationInputs {
  const state: MutableInvocationInputs = {
    parameters: new Set(direct.parameters()),
    values: new Map(),
    inputGroups: new Map(),
    destinations: new Map(),
    invalid: new Set(),
    closed: new Set(),
  };
  const inputs = new Set<Node>();
  for (const parameter of state.parameters) {
    const selected = direct.inputsFor(parameter);
    if (selected !== undefined) {
      state.values.set(parameter, [...selected]);
      for (const input of selected) {
        inputs.add(input);
      }
    }
    const groups = direct.inputGroupsFor(parameter);
    if (groups !== undefined) {
      state.inputGroups.set(parameter, groups.map((group) => [...group]));
    }
    if (direct.isInvalid(parameter)) {
      state.invalid.add(parameter);
    }
    if (direct.isClosed(parameter)) {
      state.closed.add(parameter);
    }
  }
  for (const input of inputs) {
    const destinations = direct.parametersFor(input);
    if (destinations !== undefined) {
      state.destinations.set(input, [...destinations]);
    }
  }
  return state;
}

function collectImplementationInputs(
  source: TargetSourceProgram,
  call: Node,
  implementation: Node,
  projections: ExactAggregateProjectionIndex | undefined,
  state: MutableInvocationInputs,
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
      state.invalid.add(parameter);
      state.parameters.add(parameter);
    }
    return;
  }
  for (const [parameter, inputs] of resolved.inputs) {
    state.parameters.add(parameter);
    state.closed.add(parameter);
    ensure(state.values, parameter);
    ensureGroups(state.inputGroups, parameter);
    appendGroup(state.inputGroups, parameter, inputs);
    for (const input of inputs) {
      appendUnique(state.values, parameter, input);
      appendUnique(state.destinations, input, parameter);
    }
  }
  for (const parameter of resolved.unresolvedParameters) {
    state.parameters.add(parameter);
    state.invalid.add(parameter);
  }
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

function ensureGroups(
  target: Map<Node, (readonly Node[])[]>,
  key: Node,
): void {
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
  } else if (!selected.some((existing) => sameNodeSequence(existing, group))) {
    selected.push(group);
  }
}

function sameNodeSequence(
  left: readonly Node[],
  right: readonly Node[],
): boolean {
  return left.length === right.length &&
    left.every((node, index) => node === right[index]);
}
