import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../../../../program-index.js";
import {
  createEffectProvenanceGraphBuilder,
} from "../../../provenance/graph.js";
import type { EffectProvenanceVertex } from "../../../provenance/model.js";
import { resolveEffectProvenance } from "../../../provenance/resolution.js";
import { isFunctionLike, transparentExpression } from "../../../model/syntax.js";
import { exactBindingWriteInput } from "../../storage/assignment.js";
import type {
  ExactSourceCallResolvedInputs,
} from "../../invocation/call-binding.js";
import { sameValueAlternatives } from "../../value/alternatives.js";
import {
  type ExactSourceBodyInspection,
  sourceBodyInspectionIsExact,
} from "../../../model/source-membership.js";

type CallResultAliasBoundary = "open-call-result-alias";

interface AliasState {
  readonly vertex: EffectProvenanceVertex;
  expanded: boolean;
}

export function exactCallSpecificResultOrigins(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  implementation: Node,
  returned: readonly Node[],
  inputs: ExactSourceCallResolvedInputs,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
): readonly Node[] | undefined {
  const builder = createEffectProvenanceGraphBuilder<CallResultAliasBoundary>();
  const expressions = new Map<Node, AliasState>();
  const declarations = new Map<Node, AliasState>();
  const unresolvedParameters = new Set(inputs.unresolvedParameters);
  const terminalOrigins = new Set<Node>();

  const expressionState = (expression: Node): AliasState => {
    const root = transparentExpression(source, expression) ?? expression;
    let state = expressions.get(root);
    if (state === undefined) {
      state = {
        vertex: builder.vertex("expression", root),
        expanded: false,
      };
      expressions.set(root, state);
    }
    if (state.expanded) {
      return state;
    }
    state.expanded = true;
    const alternatives = sameValueAlternatives(source, root);
    if (alternatives === null) {
      builder.addBoundary(state.vertex, "open-call-result-alias", root);
      return state;
    }
    if (alternatives !== undefined) {
      for (const alternative of alternatives) {
        const dependency = expressionState(alternative);
        builder.addDependency(
          state.vertex,
          dependency.vertex,
          "conditional",
          root,
        );
      }
      return state;
    }
    if (!source.ast.is.IsIdentifier(root)) {
      builder.addOrigin(state.vertex, root);
      return state;
    }
    const reference = source.navigation.sourceReferenceFor(root);
    const declaration = reference !== undefined &&
        sourceBodyInspectionIsExact(
          source,
          reference.declaration,
          bodyInspectionIsCertified,
        )
      ? reference.declaration
      : undefined;
    if (declaration === undefined) {
      builder.addOrigin(state.vertex, root);
      return state;
    }
    if (
      source.ast.is.IsParameterDeclaration(declaration) &&
      declarationBelongsToImplementation(source, declaration, implementation)
    ) {
      const writes = program.bindingWritesFor(declaration);
      if (writes.length !== 0) {
        const dependency = declarationState(declaration);
        builder.addDependency(
          state.vertex,
          dependency.vertex,
          "alias",
          root,
        );
        return state;
      }
      if (unresolvedParameters.has(declaration)) {
        builder.addBoundary(state.vertex, "open-call-result-alias", root);
        return state;
      }
      const selected = inputs.inputs.get(declaration);
      if (selected === undefined) {
        builder.addBoundary(state.vertex, "open-call-result-alias", root);
      } else if (selected.length === 0) {
        terminalOrigins.add(root);
        builder.addOrigin(state.vertex, root);
      } else {
        for (const input of selected) {
          builder.addDependency(
            state.vertex,
            expressionState(input).vertex,
            "argument",
            root,
          );
        }
      }
      return state;
    }
    if (
      source.ast.is.IsVariableDeclaration(declaration) &&
      declarationBelongsToImplementation(source, declaration, implementation)
    ) {
      const dependency = declarationState(declaration);
      builder.addDependency(
        state.vertex,
        dependency.vertex,
        "alias",
        root,
      );
      return state;
    }
    builder.addOrigin(state.vertex, root);
    return state;
  };

  const declarationState = (declaration: Node): AliasState => {
    let state = declarations.get(declaration);
    if (state === undefined) {
      state = {
        vertex: builder.vertex("binding", declaration),
        expanded: false,
      };
      declarations.set(declaration, state);
    }
    if (state.expanded) {
      return state;
    }
    state.expanded = true;
    let inputCount = 0;
    const initializer = source.ast.is.IsVariableDeclaration(declaration)
      ? source.ast.as.AsVariableDeclaration(declaration)?.Initializer
      : source.ast.is.IsParameterDeclaration(declaration)
      ? source.ast.as.AsParameterDeclaration(declaration)?.Initializer
      : undefined;
    if (initializer !== undefined) {
      inputCount += 1;
      builder.addDependency(
        state.vertex,
        expressionState(initializer).vertex,
        "assignment",
        declaration,
      );
    }
    if (source.ast.is.IsParameterDeclaration(declaration)) {
      if (unresolvedParameters.has(declaration)) {
        builder.addBoundary(
          state.vertex,
          "open-call-result-alias",
          declaration,
        );
      } else {
        const selected = inputs.inputs.get(declaration);
      if (selected === undefined) {
        builder.addBoundary(
          state.vertex,
          "open-call-result-alias",
          declaration,
        );
      } else if (selected.length === 0) {
        inputCount += 1;
        terminalOrigins.add(declaration);
        builder.addOrigin(state.vertex, declaration);
      } else {
          for (const input of selected) {
            inputCount += 1;
            builder.addDependency(
              state.vertex,
              expressionState(input).vertex,
              "argument",
              declaration,
            );
          }
        }
      }
    }
    for (const write of program.bindingWritesFor(declaration)) {
      const input = exactBindingWriteInput(source, write);
      if (input === undefined) {
        builder.addBoundary(
          state.vertex,
          "open-call-result-alias",
          write.operation,
        );
        continue;
      }
      inputCount += 1;
      builder.addDependency(
        state.vertex,
        expressionState(input).vertex,
        "assignment",
        write.operation,
      );
    }
    if (inputCount === 0) {
      builder.addBoundary(
        state.vertex,
        "open-call-result-alias",
        declaration,
      );
    }
    return state;
  };

  const roots = returned.map((expression) => expressionState(expression));
  const resolution = resolveEffectProvenance(builder.seal());
  const origins = new Set<Node>();
  for (const root of roots) {
    const selected = resolution.resolutionFor(root.vertex);
    if (!selected.closed) {
      return undefined;
    }
    for (const origin of selected.origins) {
      if (!terminalOrigins.has(origin)) {
        origins.add(origin);
      }
    }
  }
  return Object.freeze([...origins]);
}

function declarationBelongsToImplementation(
  source: TargetSourceProgram,
  declaration: Node,
  implementation: Node,
): boolean {
  let current: Node | undefined = declaration;
  while (current !== undefined && current !== implementation) {
    current = source.ast.parent(current);
    if (
      current !== undefined &&
      current !== implementation &&
      isFunctionLike(source, current)
    ) {
      return false;
    }
  }
  return current === implementation;
}
