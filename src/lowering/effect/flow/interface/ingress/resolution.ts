import type { Node } from "@tsonic/tsts";

import {
  createEffectProvenanceGraphBuilder,
} from "../../../provenance/graph.js";
import type {
  EffectProvenanceEdgeKind,
  EffectProvenanceVertex,
} from "../../../provenance/model.js";
import { resolveEffectProvenance } from "../../../provenance/resolution.js";
import type { InterfaceContractIngress } from "../ingress.js";
import {
  type CompositeValueAlternative,
  compositeValueAlternatives,
} from "../../value/alternatives.js";
import {
  declarationMayReceiveCheckedValues,
  originDeclarationInitializer,
} from "../origin-declaration.js";
import {
  successfulInterfaceValueExpression,
  typeProvidesContract,
} from "./origin-facts.js";
import { exactBindingWriteInput } from "../../storage/assignment.js";
import { storageDeclarationCanBeTracked } from "../../storage/owners.js";
import type { InterfaceOriginExpansion } from "./resolution/expansion.js";
import { expandInterfaceOriginContainer } from "./resolution/container.js";
import { expandInterfaceOriginValue } from "./resolution/value.js";

export type InterfaceOriginBoundaryReason =
  | "opaque-call-transport"
  | "unproven-value-origin";

export interface InterfaceOriginResolution {
  readonly closed: boolean;
  readonly opaque: boolean;
}

export interface InterfaceOriginResolutionIndex {
  resolutionFor(value: Node): InterfaceOriginResolution;
}

export type OriginRole = "value" | "container";

export interface OriginState {
  readonly vertex: EffectProvenanceVertex;
  expanded: boolean;
}

export interface OriginGraphContext {
  readonly ingress: InterfaceContractIngress;
  readonly contract: Node;
  readonly builder: ReturnType<
    typeof createEffectProvenanceGraphBuilder<InterfaceOriginBoundaryReason>
  >;
  readonly values: Map<Node, OriginState>;
  readonly containers: Map<Node, OriginState>;
}

const expansion: InterfaceOriginExpansion = Object.freeze({
  dependency,
  declarationDependency,
  expandCompositeAlternatives,
  expandSlotProjection,
  expandDeclaration,
  storageDeclarationIsClosed,
  terminal,
  origin,
  boundary,
});

export function resolveInterfaceOrigins(
  values: Iterable<Node>,
  contract: Node,
  ingress: InterfaceContractIngress,
): InterfaceOriginResolutionIndex {
  const context: OriginGraphContext = {
    ingress,
    contract,
    builder: createEffectProvenanceGraphBuilder<
      InterfaceOriginBoundaryReason
    >(),
    values: new Map(),
    containers: new Map(),
  };
  const roots = new Map<Node, OriginState>();
  for (const value of values) {
    roots.set(value, stateFor(value, "value", context));
  }
  const resolutions = resolveEffectProvenance(context.builder.seal());
  const resolved = new Map<Node, InterfaceOriginResolution>(
    [...roots].map(([value, root]) => {
      const result = resolutions.resolutionFor(root.vertex);
      return [value, Object.freeze({
        closed: result.closed,
        opaque: result.boundaries.some((boundary) =>
          boundary.reason === "opaque-call-transport"
        ),
      })] as const;
    }),
  );
  return Object.freeze({
    resolutionFor(value: Node): InterfaceOriginResolution {
      const result = resolved.get(value);
      if (result === undefined) {
        throw new Error("interface origin resolution received an unknown root");
      }
      return result;
    },
  });
}

function stateFor(
  value: Node,
  role: OriginRole,
  context: OriginGraphContext,
): OriginState {
  const expression = successfulInterfaceValueExpression(
    context.ingress.source,
    value,
  );
  const selected = expression ?? value;
  const states = role === "value" ? context.values : context.containers;
  let state = states.get(selected);
  if (state === undefined) {
    state = {
      vertex: context.builder.vertex(
        role === "value" ? "interface-value" : "interface-container",
        selected,
      ),
      expanded: false,
    };
    states.set(selected, state);
  }
  if (state.expanded) {
    return state;
  }
  state.expanded = true;
  if (expression === undefined) {
    boundary(state, "unproven-value-origin", value, context);
  } else if (role === "value") {
    expandInterfaceOriginValue(state, expression, context, expansion);
  } else {
    expandInterfaceOriginContainer(state, expression, context, expansion);
  }
  return state;
}

function expandDeclaration(
  state: OriginState,
  declaration: Node,
  role: OriginRole,
  occurrence: Node,
  context: OriginGraphContext,
): void {
  const { ingress } = context;
  if (ingress.opaqueInputs.has(declaration)) {
    boundary(state, "opaque-call-transport", occurrence, context);
    return;
  }
  let inputCount = 0;
  const initializer = originDeclarationInitializer(ingress.source, declaration);
  if (initializer !== undefined) {
    inputCount += 1;
    dependency(state, initializer, role, "assignment", occurrence, context);
  }
  if (ingress.source.ast.is.IsParameterDeclaration(declaration)) {
    const inputs = ingress.invocationInputs.inputsFor(declaration);
    const checkedInputs = ingress.checkedParameterInputs.inputsFor(declaration);
    const directInputsAreClosed = inputs !== undefined &&
      ingress.invocationInputs.isClosed(declaration);
    if (!directInputsAreClosed && checkedInputs.length === 0) {
      boundary(state, "unproven-value-origin", occurrence, context);
      return;
    }
    if (directInputsAreClosed) {
      for (const input of inputs) {
        inputCount += 1;
        dependency(state, input, role, "argument", occurrence, context);
      }
    }
    for (const input of checkedInputs) {
      inputCount += 1;
      if (typeProvidesContract(
        input.semantics,
        input.type,
        context.contract,
        ingress,
      )) {
        origin(state, input.occurrence, context);
      } else {
        boundary(
          state,
          "unproven-value-origin",
          input.occurrence,
          context,
        );
      }
    }
    if (directInputsAreClosed && inputs.length === 0) {
      origin(state, declaration, context);
      return;
    }
  }
  if (
    ingress.source.ast.is.IsVariableDeclaration(declaration) ||
    ingress.source.ast.is.IsPropertyDeclaration(declaration)
  ) {
    for (const write of ingress.program.bindingWritesFor(declaration)) {
      const input = exactBindingWriteInput(ingress.source, write);
      if (input === undefined) {
        boundary(state, "unproven-value-origin", write.operation, context);
      } else {
        inputCount += 1;
        dependency(state, input, role, "assignment", write.operation, context);
      }
    }
  }
  if (
    inputCount === 0 &&
    declarationMayReceiveCheckedValues(ingress.source, declaration)
  ) {
    origin(state, declaration, context);
  } else if (inputCount === 0) {
    boundary(state, "unproven-value-origin", occurrence, context);
  }
}

function expandAlternatives(
  state: OriginState,
  alternatives: readonly CompositeValueAlternative[] | null,
  inheritedRole: OriginRole,
  occurrence: Node,
  context: OriginGraphContext,
): void {
  if (alternatives === null || alternatives.length === 0) {
    boundary(state, "unproven-value-origin", occurrence, context);
    return;
  }
  for (const alternative of alternatives) {
    const role = alternative.role === "same"
      ? inheritedRole
      : alternative.role;
    if (role === "value") {
      const semantics = context.ingress.source.semantics.forNode(
        alternative.expression,
      );
      const type = semantics.types.expressionType(alternative.expression);
      if (
        type !== undefined &&
        !context.ingress.relevance.valueContracts(semantics, type).includes(
          context.contract,
        )
      ) {
        origin(state, alternative.expression, context);
        continue;
      }
    }
    dependency(
      state,
      alternative.expression,
      role,
      role === "container" ? "element" : "conditional",
      occurrence,
      context,
    );
  }
}

function expandCompositeAlternatives(
  state: OriginState,
  expression: Node,
  inheritedRole: OriginRole,
  occurrence: Node,
  context: OriginGraphContext,
): boolean {
  const alternatives = compositeValueAlternatives(
    context.ingress.source,
    expression,
  );
  if (alternatives === undefined) {
    return false;
  }
  expandAlternatives(
    state,
    alternatives,
    inheritedRole,
    occurrence,
    context,
  );
  return true;
}

function expandSlotProjection(
  state: OriginState,
  expression: Node,
  role: OriginRole,
  context: OriginGraphContext,
): boolean {
  const projection = context.ingress.slots?.resultFor(expression);
  if (projection === undefined) {
    return false;
  }
  if (!projection.closed) {
    return false;
  }
  if (projection.expressions.length === 0) {
    origin(state, expression, context);
    return true;
  }
  for (const originExpression of projection.expressions) {
    dependency(
      state,
      originExpression,
      role,
      "projection",
      expression,
      context,
    );
  }
  return true;
}

function dependency(
  destination: OriginState,
  source: Node,
  role: OriginRole,
  kind: EffectProvenanceEdgeKind,
  occurrence: Node,
  context: OriginGraphContext,
): void {
  context.builder.addDependency(
    destination.vertex,
    stateFor(source, role, context).vertex,
    kind,
    occurrence,
  );
}

function declarationDependency(
  destination: OriginState,
  declaration: Node,
  role: OriginRole,
  kind: EffectProvenanceEdgeKind,
  occurrence: Node,
  context: OriginGraphContext,
): void {
  context.builder.addDependency(
    destination.vertex,
    stateForDeclaration(declaration, role, context).vertex,
    kind,
    occurrence,
  );
}

function stateForDeclaration(
  declaration: Node,
  role: OriginRole,
  context: OriginGraphContext,
): OriginState {
  const states = role === "value" ? context.values : context.containers;
  let state = states.get(declaration);
  if (state === undefined) {
    state = {
      vertex: context.builder.vertex(
        role === "value" ? "interface-value" : "interface-container",
        declaration,
      ),
      expanded: false,
    };
    states.set(declaration, state);
  }
  if (!state.expanded) {
    state.expanded = true;
    expandDeclaration(state, declaration, role, declaration, context);
  }
  return state;
}

function storageDeclarationIsClosed(
  declaration: Node | undefined,
  context: OriginGraphContext,
): declaration is Node {
  const { ingress } = context;
  if (
    declaration === undefined ||
    !storageDeclarationCanBeTracked(ingress.source, declaration)
  ) {
    return false;
  }
  const parent = ingress.source.ast.parent(declaration);
  const owner = parent !== undefined &&
      ingress.source.ast.is.IsConstructorDeclaration(parent)
    ? ingress.source.ast.parent(parent)
    : parent;
  return owner !== undefined && ingress.closedStorageOwners.has(owner);
}

function terminal(
  state: OriginState,
  closed: boolean,
  occurrence: Node,
  context: OriginGraphContext,
  reason: InterfaceOriginBoundaryReason = "unproven-value-origin",
): void {
  if (closed) {
    origin(state, occurrence, context);
  } else {
    boundary(state, reason, occurrence, context);
  }
}

function origin(
  state: OriginState,
  _occurrence: Node,
  context: OriginGraphContext,
): void {
  context.builder.addOrigin(state.vertex, context.contract);
}

function boundary(
  state: OriginState,
  reason: InterfaceOriginBoundaryReason,
  occurrence: Node,
  context: OriginGraphContext,
): void {
  context.builder.addBoundary(state.vertex, reason, occurrence);
}
