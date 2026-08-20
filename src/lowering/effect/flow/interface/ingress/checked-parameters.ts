import type { Node, Type } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api";

export interface CheckedInterfaceParameterInput {
  readonly semantics: SourceFileSemantics;
  readonly type: Type;
  readonly occurrence: Node;
}

export interface CheckedInterfaceParameterInputs {
  record(
    parameter: Node,
    semantics: SourceFileSemantics,
    type: Type,
    occurrence: Node,
  ): void;
  inputsFor(parameter: Node): readonly CheckedInterfaceParameterInput[];
  seal(): void;
}

const noInputs: readonly CheckedInterfaceParameterInput[] = Object.freeze([]);

export function createCheckedInterfaceParameterInputs():
  CheckedInterfaceParameterInputs {
  const inputs = new Map<Node, CheckedInterfaceParameterInput[]>();
  let sealed = false;
  return Object.freeze({
    record(
      parameter: Node,
      semantics: SourceFileSemantics,
      type: Type,
      occurrence: Node,
    ): void {
      if (sealed) {
        throw new Error("checked interface parameter inputs are sealed");
      }
      const input = Object.freeze({ semantics, type, occurrence });
      const selected = inputs.get(parameter);
      if (selected === undefined) {
        inputs.set(parameter, [input]);
      } else if (!selected.some((candidate) =>
        candidate.type === type && candidate.occurrence === occurrence
      )) {
        selected.push(input);
      }
    },
    inputsFor(parameter: Node): readonly CheckedInterfaceParameterInput[] {
      const selected = inputs.get(parameter);
      return selected === undefined ? noInputs : Object.freeze([...selected]);
    },
    seal(): void {
      if (sealed) {
        throw new Error("checked interface parameter inputs were sealed twice");
      }
      sealed = true;
    },
  });
}
