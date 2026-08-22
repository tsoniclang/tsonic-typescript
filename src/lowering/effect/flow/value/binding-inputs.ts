import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../../../program-index.js";
import { isModuleForwardingReference } from "../../model/syntax.js";
import {
  declarationIsAmbient,
  declarationIsExported,
} from "../../model/declaration-surface.js";
import type { ExactInvocationInputIndex } from "../invocation/inputs.js";
import { exactBindingWriteInput } from "../storage/assignment.js";
import type { ExactValueSlotPath } from "./slot/model.js";
import { exactValueSlotPathKey } from "./slot/selectors.js";

export interface ExactValueBindingInputs {
  inputsForReference(
    reference: Node,
    path: ExactValueSlotPath,
  ): readonly Node[] | undefined;
}

export function createExactValueBindingInputs(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  invocationInputs: ExactInvocationInputIndex | undefined,
  readIsAdmitted: (reference: Node, path: ExactValueSlotPath) => boolean,
): ExactValueBindingInputs {
  const cache = new Map<Node, Map<string, readonly Node[] | null>>();
  return Object.freeze({
    inputsForReference(
      reference: Node,
      path: ExactValueSlotPath,
    ): readonly Node[] | undefined {
      const selected = source.navigation.sourceReferenceFor(reference);
      if (selected?.project !== true) {
        return undefined;
      }
      const declaration = selected.declaration;
      const key = exactValueSlotPathKey(path);
      let byPath = cache.get(declaration);
      const existing = byPath?.get(key);
      if (existing !== undefined) {
        return existing ?? undefined;
      }
      const result = exactInputsForDeclaration(
        source,
        program,
        declaration,
        invocationInputs,
        (candidate) => readIsAdmitted(candidate, path),
      );
      if (byPath === undefined) {
        byPath = new Map();
        cache.set(declaration, byPath);
      }
      byPath.set(key, result ?? null);
      return result;
    },
  });
}

function exactInputsForDeclaration(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  declaration: Node,
  invocationInputs: ExactInvocationInputIndex | undefined,
  readIsAdmitted: (reference: Node) => boolean,
): readonly Node[] | undefined {
  const variable = source.ast.is.IsVariableDeclaration(declaration);
  const parameter = source.ast.is.IsParameterDeclaration(declaration);
  if (
    (!variable && !parameter) ||
    !source.ast.is.IsIdentifier(source.ast.name(declaration)) ||
    (variable && declarationIsExported(source, declaration)) ||
    (parameter && invocationInputs?.isClosed(declaration) !== true)
  ) {
    return undefined;
  }
  const inputs: Node[] = [];
  const initializer = variable
    ? source.ast.as.AsVariableDeclaration(declaration)?.Initializer
    : source.ast.as.AsParameterDeclaration(declaration)?.Initializer;
  if (initializer !== undefined) {
    inputs.push(initializer);
  }
  if (parameter) {
    inputs.push(...invocationInputs?.inputsFor(declaration) ?? []);
  }
  const writes = new Map(program.bindingWritesFor(declaration).map(
    (write) => [write.reference, write] as const,
  ));
  if (
    variable &&
    initializer === undefined &&
    writes.size === 0 &&
    declarationIsAmbient(source, declaration)
  ) {
    return undefined;
  }
  const closed = source.navigation.referencesToDeclaration(declaration).every(
    (reference) => {
      if (isModuleForwardingReference(source, reference)) {
        return false;
      }
      const write = writes.get(reference);
      if (write === undefined) {
        return readIsAdmitted(reference);
      }
      const input = exactBindingWriteInput(source, write);
      if (input === undefined) {
        return false;
      }
      inputs.push(input);
      return true;
    },
  );
  return closed ? Object.freeze([...new Set(inputs)]) : undefined;
}
