import type { Node } from "@tsonic/tsts";

import type { EffectProvenanceGraphBuilder } from "../../../provenance/graph.js";
import type { EffectProvenanceVertex } from "../../../provenance/model.js";
import type { ExactValueSlotPath } from "./model.js";
import { exactValueSlotPathKey } from "./selectors.js";

export interface ValueSlotState {
  readonly vertex: EffectProvenanceVertex;
  readonly kind: "expression" | "result";
  readonly occurrence: Node;
  readonly selectorKeys: readonly string[];
  readonly recursive: boolean;
  expanded: boolean;
}

export type ValueSlotWorkItem =
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
    readonly declaration: Node;
    readonly expressions: readonly (Node | undefined)[];
    readonly path: ExactValueSlotPath;
  }
  | {
    readonly kind: "leave";
    readonly state: ValueSlotState;
  };

export interface ValueSlotActiveStates {
  enter(state: ValueSlotState): void;
  leave(state: ValueSlotState): void;
  pathIsRecursive(
    kind: ValueSlotState["kind"],
    occurrence: Node,
    selectorKeys: readonly string[],
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
  const expressions = new Map<Node, Map<string, ValueSlotState>>();
  const results = new Map<Node, Map<string, ValueSlotState>>();
  return Object.freeze({
    select(
      kind: ValueSlotState["kind"],
      occurrence: Node,
      path: ExactValueSlotPath,
    ): ValueSlotState {
      const states = kind === "expression" ? expressions : results;
      let selected = states.get(occurrence);
      if (selected === undefined) {
        selected = new Map();
        states.set(occurrence, selected);
      }
      const key = exactValueSlotPathKey(path);
      let state = selected.get(key);
      if (state === undefined) {
        const selectorKeys = Object.freeze(path.map((selector) =>
          exactValueSlotPathKey(Object.freeze([selector]))
        ));
        const recursive = active.pathIsRecursive(
          kind,
          occurrence,
          selectorKeys,
        );
        state = {
          vertex: builder.vertex("value-slot", occurrence),
          kind,
          occurrence,
          selectorKeys,
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
  const active = new Map<Node, ValueSlotState[]>();
  return Object.freeze({
    enter(state: ValueSlotState): void {
      const selected = active.get(state.occurrence);
      if (selected === undefined) {
        active.set(state.occurrence, [state]);
      } else {
        selected.push(state);
      }
    },
    leave(state: ValueSlotState): void {
      const selected = active.get(state.occurrence);
      if (selected?.pop() !== state) {
        throw new Error("value-slot active expansion order is invalid");
      }
      if (selected.length === 0) {
        active.delete(state.occurrence);
      }
    },
    pathIsRecursive(
      kind: ValueSlotState["kind"],
      occurrence: Node,
      selectorKeys: readonly string[],
    ): boolean {
      return active.get(occurrence)?.some((candidate) =>
        candidate.kind === kind &&
        pathProperlyExtends(selectorKeys, candidate.selectorKeys)
      ) === true;
    },
  });
}

function pathProperlyExtends(
  selected: readonly string[],
  suffix: readonly string[],
): boolean {
  if (selected.length <= suffix.length) {
    return false;
  }
  const offset = selected.length - suffix.length;
  return suffix.every((key, index) => selected[offset + index] === key);
}
