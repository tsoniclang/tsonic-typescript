import type { Node } from "@tsonic/tsts";

import type { EffectProvenanceGraphBuilder } from "../../../provenance/graph.js";
import type { EffectProvenanceVertex } from "../../../provenance/model.js";
import type { ExactValueSlotPath } from "./model.js";
import { exactValueSlotPathKey } from "./selectors.js";
import type { ExactTrackedValueSlotInput } from "./tracked.js";

export interface ValueSlotState {
  readonly vertex: EffectProvenanceVertex;
  readonly kind: "expression" | "result" | "tracked-slot";
  readonly occurrence: Node;
  readonly recursive: boolean;
  expanded: boolean;
}

export type ValueSlotWorkItem =
  | {
    readonly kind: "tracked-slot";
    readonly state: ValueSlotState;
    readonly inputs: readonly ExactTrackedValueSlotInput[];
    readonly path: ExactValueSlotPath;
    readonly occurrence: Node;
    readonly closed: boolean;
  }
  | {
    readonly kind: "expression";
    readonly state: ValueSlotState;
    readonly root: Node;
    readonly path: ExactValueSlotPath;
  }
  | {
    readonly kind: "binding-projection";
    readonly state: ValueSlotState;
    readonly reference: Node;
    readonly sources: readonly Node[];
    readonly path: ExactValueSlotPath;
  }
  | {
    readonly kind: "result";
    readonly state: ValueSlotState;
    readonly resultOwner: Node;
    readonly expressions: readonly (Node | undefined)[];
    readonly path: ExactValueSlotPath;
  }
  | {
    readonly kind: "leave";
    readonly state: ValueSlotState;
  };

export interface ValueSlotActiveStates {
  enter(state: ValueSlotState, path: ExactValueSlotPath): void;
  leave(state: ValueSlotState): void;
  pathIsRecursive(
    kind: ValueSlotState["kind"],
    occurrence: Node,
    path: ExactValueSlotPath,
  ): boolean;
}

export interface ValueSlotStateRegistry {
  select(
    kind: ValueSlotState["kind"],
    occurrence: Node,
    path: ExactValueSlotPath,
  ): ValueSlotState;
}

export function createValueSlotStateRegistry<Reason extends string>(
  active: ValueSlotActiveStates,
  builder: EffectProvenanceGraphBuilder<Reason>,
): ValueSlotStateRegistry {
  const statesByKind = new Map<
    ValueSlotState["kind"],
    Map<Node, Map<string, ValueSlotState>>
  >([
    ["expression", new Map()],
    ["result", new Map()],
    ["tracked-slot", new Map()],
  ]);
  return Object.freeze({
    select(
      kind: ValueSlotState["kind"],
      occurrence: Node,
      path: ExactValueSlotPath,
    ): ValueSlotState {
      const states = statesByKind.get(kind);
      if (states === undefined) {
        throw new Error(`value-slot state kind '${kind}' is not registered`);
      }
      let selected = states.get(occurrence);
      if (selected === undefined) {
        selected = new Map();
        states.set(occurrence, selected);
      }
      const key = exactValueSlotPathKey(path);
      let state = selected.get(key);
      if (state === undefined) {
        const recursive = active.pathIsRecursive(
          kind,
          occurrence,
          path,
        );
        state = {
          vertex: builder.vertex("value-slot", occurrence),
          kind,
          occurrence,
          recursive,
          expanded: recursive,
        };
        selected.set(key, state);
      }
      return state;
    },
  });
}

export function createValueSlotActiveStates(): ValueSlotActiveStates {
  const active = new Map<
    Node,
    Array<{
      readonly state: ValueSlotState;
      readonly path: ExactValueSlotPath;
    }>
  >();
  return Object.freeze({
    enter(state: ValueSlotState, path: ExactValueSlotPath): void {
      const selected = active.get(state.occurrence);
      const entry = { state, path };
      if (selected === undefined) {
        active.set(state.occurrence, [entry]);
      } else {
        selected.push(entry);
      }
    },
    leave(state: ValueSlotState): void {
      const selected = active.get(state.occurrence);
      if (selected?.pop()?.state !== state) {
        throw new Error("value-slot active expansion order is invalid");
      }
      if (selected.length === 0) {
        active.delete(state.occurrence);
      }
    },
    pathIsRecursive(
      kind: ValueSlotState["kind"],
      occurrence: Node,
      path: ExactValueSlotPath,
    ): boolean {
      return active.get(occurrence)?.some((candidate) =>
        candidate.state.kind === kind &&
        pathProperlyExtends(path, candidate.path)
      ) === true;
    },
  });
}

function pathProperlyExtends(
  selected: ExactValueSlotPath,
  suffix: ExactValueSlotPath,
): boolean {
  if (selected.length <= suffix.length) {
    return false;
  }
  const offset = selected.length - suffix.length;
  return suffix.every((selector, index) =>
    exactValueSlotPathKey(Object.freeze([selected[offset + index]!])) ===
      exactValueSlotPathKey(Object.freeze([selector]))
  );
}
