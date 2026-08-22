import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { TypeScriptPlanningObserver } from "../../../planning-observer.js";
import { createExactValueBindingInputs } from "../value/binding-inputs.js";
import type { ExactValueSlotPath } from "../value/slot/model.js";
import { createReturnLocalTopology } from "./local/topology.js";

export interface ReturnLocalBinding {
  readonly declaration: Node;
  readonly inputs: readonly Node[];
}

export interface ReturnLocalFlow {
  bindingFor(identifier: Node): ReturnLocalBinding | undefined;
}

const rootValuePath: ExactValueSlotPath = Object.freeze([]);

export function createReturnLocalFlow(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  planningObserver?: TypeScriptPlanningObserver,
): ReturnLocalFlow {
  const topology = createReturnLocalTopology(source, program);
  const bindings = createExactValueBindingInputs(
    source,
    program,
    undefined,
    (reference) => topology.readIsAdmitted(reference),
  );
  planningObserver?.("effect-return-locals");
  const cache = new Map<Node, ReturnLocalBinding>();
  return Object.freeze({
    bindingFor(identifier: Node): ReturnLocalBinding | undefined {
      if (!source.ast.is.IsIdentifier(identifier)) {
        return undefined;
      }
      const declaration = source.navigation.sourceReferenceFor(identifier)?.declaration;
      if (
        declaration === undefined ||
        !source.ast.is.IsVariableDeclaration(declaration)
      ) {
        return undefined;
      }
      const existing = cache.get(declaration);
      if (existing !== undefined) {
        return existing;
      }
      const inputs = bindings.inputsForReference(identifier, rootValuePath);
      if (inputs === undefined) {
        return undefined;
      }
      const binding = Object.freeze({ declaration, inputs });
      cache.set(declaration, binding);
      return binding;
    },
  });
}
