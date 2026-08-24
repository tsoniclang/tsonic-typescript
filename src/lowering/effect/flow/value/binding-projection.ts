import type { Node, Symbol } from "@tsonic/tsts";
import type {
  SourceBindingWrite,
  TargetSourceProgram,
} from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../../../program-index.js";
import { isModuleForwardingReference } from "../../model/syntax.js";
import { declarationIsExported } from "../../model/declaration-surface.js";
import type { TypeScriptActiveCooperativeEffectProfile } from "../../../profile.js";
import type { ExactInvocationInputIndex } from "../invocation/inputs.js";
import {
  type ExactSourceBodyInspection,
  sourceBodyInspectionIsExact,
} from "../../model/source-membership.js";

export type ExactValueBindingProjectionStep =
  | {
      readonly kind: "element";
      readonly index: number;
    }
  | {
      readonly kind: "property";
      readonly declaration: Node;
      readonly name: Node;
    };

export interface ExactValueBindingProjection {
  readonly declaration: Node;
  readonly sources: readonly Node[];
  readonly steps: readonly ExactValueBindingProjectionStep[];
}

export interface ExactValueBindingProjectionIndex {
  projectionForReference(
    reference: Node,
  ): ExactValueBindingProjection | undefined;
}

export function createExactValueBindingProjectionIndex(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  invocationInputs?: ExactInvocationInputIndex,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
  cooperativeEffects: TypeScriptActiveCooperativeEffectProfile = "closed-direct",
): ExactValueBindingProjectionIndex {
  const cache = new Map<Node, ExactValueBindingProjection | null>();
  return Object.freeze({
    projectionForReference(
      reference: Node,
    ): ExactValueBindingProjection | undefined {
      if (!source.ast.is.IsIdentifier(reference)) {
        return undefined;
      }
      const selected = source.navigation.sourceReferenceFor(reference);
      if (
        selected === undefined ||
        !sourceBodyInspectionIsExact(
          source,
          selected.declaration,
          bodyInspectionIsCertified,
        )
      ) {
        return undefined;
      }
      const declaration = selected.declaration;
      const existing = cache.get(declaration);
      if (existing !== undefined) {
        return existing ?? undefined;
      }
      const projection = exactBindingProjection(
        source,
        program,
        declaration,
        invocationInputs,
        cooperativeEffects,
      );
      cache.set(declaration, projection ?? null);
      return projection;
    },
  });
}

function exactBindingProjection(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  declaration: Node,
  invocationInputs: ExactInvocationInputIndex | undefined,
  cooperativeEffects: TypeScriptActiveCooperativeEffectProfile,
): ExactValueBindingProjection | undefined {
  if (
    source.ast.is.IsVariableDeclaration(declaration) &&
    source.ast.is.IsIdentifier(source.ast.name(declaration))
  ) {
    return exactAssignmentBindingProjection(
      source,
      program,
      declaration,
      cooperativeEffects,
    );
  }
  if (
    !source.ast.is.IsBindingElement(declaration) ||
    program.hasBindingWrite(declaration) ||
    cooperativeEffects !== "closed-program" &&
      source.navigation.referencesToDeclaration(declaration).some((reference) =>
        isModuleForwardingReference(source, reference)
      )
  ) {
    return undefined;
  }
  const reversed: ExactValueBindingProjectionStep[] = [];
  let current = declaration;
  for (;;) {
    const binding = source.ast.as.AsBindingElement(current);
    const pattern = source.ast.parent(current);
    if (
      binding === undefined ||
      binding.DotDotDotToken !== undefined ||
      binding.Initializer !== undefined ||
      pattern === undefined
    ) {
      return undefined;
    }
    const elements = source.ast.elements(pattern);
    const index = elements.indexOf(current);
    if (index < 0) {
      return undefined;
    }
    if (source.ast.is.IsArrayBindingPattern(pattern)) {
      reversed.push(Object.freeze({ kind: "element", index }));
    } else if (source.ast.is.IsObjectBindingPattern(pattern)) {
      const name = binding.PropertyName ?? source.ast.name(current);
      if (
        name === undefined ||
        source.ast.is.IsComputedPropertyName(name)
      ) {
        return undefined;
      }
      reversed.push(Object.freeze({
        kind: "property",
        declaration: current,
        name,
      }));
    } else {
      return undefined;
    }
    const owner = source.ast.parent(pattern);
    if (owner === undefined) {
      return undefined;
    }
    if (source.ast.is.IsBindingElement(owner)) {
      current = owner;
      continue;
    }
    const sources = bindingOwnerSources(
      source,
      owner,
      invocationInputs,
      cooperativeEffects,
    );
    if (sources === undefined) {
      return undefined;
    }
    return Object.freeze({
      declaration,
      sources,
      steps: Object.freeze(reversed.reverse()),
    });
  }
}

function exactAssignmentBindingProjection(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  declaration: Node,
  cooperativeEffects: TypeScriptActiveCooperativeEffectProfile,
): ExactValueBindingProjection | undefined {
  if (
    cooperativeEffects !== "closed-program" &&
      declarationIsExported(source, declaration) ||
    source.ast.as.AsVariableDeclaration(declaration)?.Initializer !== undefined
  ) {
    return undefined;
  }
  const writes = program.bindingWritesFor(declaration);
  if (writes.length === 0) {
    return undefined;
  }
  const sources: Node[] = [];
  let selectedSteps: readonly ExactValueBindingProjectionStep[] | undefined;
  for (const write of writes) {
    const projected = exactAssignmentProjection(source, write);
    if (
      projected === undefined ||
      selectedSteps !== undefined &&
        !sameProjectionSteps(source, selectedSteps, projected.steps)
    ) {
      return undefined;
    }
    selectedSteps ??= projected.steps;
    sources.push(projected.source);
  }
  if (
    selectedSteps === undefined ||
    cooperativeEffects !== "closed-program" &&
      source.navigation.referencesToDeclaration(declaration).some((reference) =>
        isModuleForwardingReference(source, reference)
      )
  ) {
    return undefined;
  }
  return Object.freeze({
    declaration,
    sources: Object.freeze([...new Set(sources)]),
    steps: selectedSteps,
  });
}

function exactAssignmentProjection(
  source: TargetSourceProgram,
  write: SourceBindingWrite,
): {
  readonly source: Node;
  readonly steps: readonly ExactValueBindingProjectionStep[];
} | undefined {
  if (
    write.kind !== "assignment" ||
    !source.ast.is.IsBinaryExpression(write.operation) ||
    source.ast.operatorKindName(write.operation) !== "KindEqualsToken"
  ) {
    return undefined;
  }
  const assignment = source.ast.as.AsBinaryExpression(write.operation);
  const left = assignment?.Left;
  const right = assignment?.Right;
  if (left === undefined || right === undefined) {
    return undefined;
  }
  const reversed: ExactValueBindingProjectionStep[] = [];
  let current = write.reference;
  for (;;) {
    const root = transparentAssignmentTarget(source, left);
    if (root === current) {
      return reversed.length === 0
        ? undefined
        : Object.freeze({
            source: right,
            steps: Object.freeze(reversed.reverse()),
          });
    }
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return undefined;
    }
    if (source.ast.is.IsArrayLiteralExpression(parent)) {
      const index = source.ast.elements(parent).indexOf(current);
      if (index < 0 || source.ast.is.IsSpreadElement(current)) {
        return undefined;
      }
      reversed.push(Object.freeze({ kind: "element", index }));
      current = parent;
      continue;
    }
    if (source.ast.is.IsPropertyAssignment(parent)) {
      const property = source.ast.as.AsPropertyAssignment(parent);
      const name = source.ast.name(parent);
      if (
        property?.Initializer !== current ||
        name === undefined ||
        source.ast.is.IsComputedPropertyName(name)
      ) {
        return undefined;
      }
      reversed.push(Object.freeze({
        kind: "property",
        declaration: parent,
        name,
      }));
      current = parent;
      continue;
    }
    if (
      source.ast.is.IsShorthandPropertyAssignment(parent) &&
      source.ast.name(parent) === current
    ) {
      const name = source.ast.name(parent);
      if (name === undefined) {
        return undefined;
      }
      reversed.push(Object.freeze({
        kind: "property",
        declaration: parent,
        name,
      }));
      current = parent;
      continue;
    }
    if (source.ast.is.IsObjectLiteralExpression(parent)) {
      if (!source.ast.properties(parent).includes(current)) {
        return undefined;
      }
      current = parent;
      continue;
    }
    const transparent = transparentAssignmentTarget(source, parent);
    if (transparent === current) {
      current = parent;
      continue;
    }
    return undefined;
  }
}

function transparentAssignmentTarget(
  source: TargetSourceProgram,
  node: Node,
): Node {
  let current = node;
  for (;;) {
    const next = source.ast.is.IsParenthesizedExpression(current)
      ? source.ast.as.AsParenthesizedExpression(current)?.Expression
      : source.ast.is.IsAsExpression(current)
      ? source.ast.as.AsAsExpression(current)?.Expression
      : source.ast.is.IsTypeAssertion(current)
      ? source.ast.as.AsTypeAssertion(current)?.Expression
      : source.ast.is.IsSatisfiesExpression(current)
      ? source.ast.as.AsSatisfiesExpression(current)?.Expression
      : undefined;
    if (next === undefined) {
      return current;
    }
    current = next;
  }
}

function sameProjectionSteps(
  source: TargetSourceProgram,
  left: readonly ExactValueBindingProjectionStep[],
  right: readonly ExactValueBindingProjectionStep[],
): boolean {
  return left.length === right.length && left.every((step, index) => {
    const candidate = right[index];
    if (candidate === undefined || step.kind !== candidate.kind) {
      return false;
    }
    if (step.kind === "element" && candidate.kind === "element") {
      return step.index === candidate.index;
    }
    if (step.kind !== "property" || candidate.kind !== "property") {
      return false;
    }
    const leftSymbols = exactSymbolsAt(source, step.name);
    const rightSymbols = new Set(exactSymbolsAt(source, candidate.name));
    return leftSymbols.length !== 0 &&
      leftSymbols.some((symbol) => rightSymbols.has(symbol));
  });
}

function exactSymbolsAt(
  source: TargetSourceProgram,
  node: Node,
): readonly Symbol[] {
  const symbol = source.navigation.sourceReferenceFor(node)?.symbol;
  return symbol === undefined ? [] : [symbol];
}

function bindingOwnerSources(
  source: TargetSourceProgram,
  owner: Node,
  invocationInputs: ExactInvocationInputIndex | undefined,
  cooperativeEffects: TypeScriptActiveCooperativeEffectProfile,
): readonly Node[] | undefined {
  if (source.ast.is.IsVariableDeclaration(owner)) {
    if (
      cooperativeEffects !== "closed-program" &&
      declarationIsExported(source, owner)
    ) {
      return undefined;
    }
    const initializer = source.ast.as.AsVariableDeclaration(owner)?.Initializer;
    return initializer === undefined ? undefined : Object.freeze([initializer]);
  }
  if (
    !source.ast.is.IsParameterDeclaration(owner) ||
    invocationInputs?.isClosed(owner) !== true
  ) {
    return undefined;
  }
  const inputs = invocationInputs.inputsFor(owner);
  return inputs === undefined ? undefined : Object.freeze([...inputs]);
}
