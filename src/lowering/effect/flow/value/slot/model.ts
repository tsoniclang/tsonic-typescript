import type { Node, Symbol } from "@tsonic/tsts";

export type ExactValueSlotSelector =
  | {
      readonly kind: "element";
      readonly index: number;
    }
  | {
      readonly kind: "property";
      readonly symbols: ReadonlySet<Symbol>;
      readonly declarations: ReadonlySet<Node>;
      readonly names: ReadonlySet<string>;
    };

export type ExactValueSlotPath = readonly ExactValueSlotSelector[];

export interface ExactValueSlotCallSource {
  readonly declaration: Node;
  readonly contracts?: readonly Node[];
  readonly expressions: readonly (Node | undefined)[];
}

export interface ExactValueSlotStep {
  readonly declaration: Node;
  readonly contracts: readonly Node[];
  readonly invocation: Node;
  readonly path: ExactValueSlotPath;
}

export interface ExactValueSlotResolution {
  readonly closed: boolean;
  readonly expressions: readonly Node[];
  readonly steps: readonly ExactValueSlotStep[];
}

export interface ExactValueSlotFlow {
  resultFor(expression: Node): ExactValueSlotResolution | undefined;
}
