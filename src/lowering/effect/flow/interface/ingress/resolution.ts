import type { Node } from "@tsonic/tsts";

import type {
  EffectProvenanceEdgeKind,
} from "../../../provenance/model.js";
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
  createInterfaceOriginFacts,
  type InterfaceOriginFacts,
} from "./origin-facts.js";
import { exactBindingWriteInput } from "../../storage/assignment.js";
import { storageDeclarationCanBeTracked } from "../../storage/owners.js";
import type { InterfaceOriginExpansion } from "./resolution/expansion.js";
import { expandInterfaceOriginContainer } from "./resolution/container.js";
import { expandInterfaceOriginValue } from "./resolution/value.js";
import {
  createInterfaceOriginContractGraph,
  type InterfaceOriginContractGraphBuilder,
  type InterfaceOriginContractGraphMeasurements,
  type InterfaceOriginVertex,
} from "./resolution/contract-graph.js";
import {
  createInterfaceOriginContractDomain,
  type InterfaceOriginContractDomain,
  type InterfaceOriginContractSet,
} from "./resolution/contract-set.js";

export type InterfaceOriginBoundaryReason =
  | "opaque-call-transport"
  | "unproven-value-origin";

export interface InterfaceOriginResolution {
  readonly closed: boolean;
  readonly opaque: boolean;
}

export interface InterfaceOriginResolutionIndex {
  readonly measurements: InterfaceOriginResolutionMeasurements;
  resolutionFor(value: Node, contract: Node): InterfaceOriginResolution;
}

export interface InterfaceOriginResolutionRequest {
  readonly contract: Node;
  readonly values: Iterable<Node>;
}

export interface InterfaceOriginResolutionMeasurements
  extends InterfaceOriginContractGraphMeasurements {
  readonly closed: number;
  readonly contractExpansions: number;
  readonly contractQueries: number;
  readonly roots: number;
  readonly valueExpansions: number;
  readonly valueQueries: number;
}

export type OriginRole = "value" | "container";

export interface OriginState {
  readonly vertex: InterfaceOriginVertex;
  readonly expansion: "declaration" | "expression";
  readonly occurrence: Node;
  readonly expression?: Node;
  readonly role: OriginRole;
  pending: InterfaceOriginContractSet | undefined;
  queued: boolean;
}

interface OriginGraphSharedContext {
  readonly ingress: InterfaceContractIngress;
  readonly domain: InterfaceOriginContractDomain;
  readonly builder: InterfaceOriginContractGraphBuilder;
  readonly facts: InterfaceOriginFacts;
  readonly values: Map<Node, OriginState>;
  readonly containers: Map<Node, OriginState>;
  readonly pending: OriginState[];
}

export interface OriginGraphContext extends OriginGraphSharedContext {
  readonly active: InterfaceOriginContractSet;
}

const expansion: InterfaceOriginExpansion = Object.freeze({
  dependency,
  declarationDependency,
  expandCompositeAlternatives,
  expandSlotProjection,
  expandDeclaration,
  storageDeclarationIsClosed,
  terminal,
  terminalForContracts,
  origin,
  boundary,
});

export function resolveInterfaceOrigins(
  requests: readonly InterfaceOriginResolutionRequest[],
  ingress: InterfaceContractIngress,
): InterfaceOriginResolutionIndex {
  const contracts = Object.freeze(requests.map((request) => request.contract));
  if (new Set(contracts).size !== contracts.length) {
    throw new Error("interface origin resolution received duplicate contracts");
  }
  const domain = createInterfaceOriginContractDomain(contracts);
  const shared: OriginGraphSharedContext = {
    ingress,
    domain,
    builder: createInterfaceOriginContractGraph(domain),
    facts: createInterfaceOriginFacts(ingress),
    values: new Map(),
    containers: new Map(),
    pending: [],
  };
  const roots = new Map<Node, Map<Node, OriginState>>();
  let rootCount = 0;
  for (let contractIndex = 0; contractIndex < requests.length; contractIndex += 1) {
    const request = requests[contractIndex];
    if (request === undefined) {
      throw new Error("interface origin resolution lost a contract request");
    }
    const contractRoots = new Map<Node, OriginState>();
    roots.set(request.contract, contractRoots);
    for (const value of request.values) {
      if (!contractRoots.has(value)) {
        rootCount += 1;
        const root = stateFor(value, "value", shared);
        contractRoots.set(value, root);
        schedule(root, domain.single(contractIndex), shared);
      }
    }
  }
  drainOriginExpansions(shared);
  const resolutions = shared.builder.seal();
  const resolved = new Map<Node, Map<Node, InterfaceOriginResolution>>();
  let closed = 0;
  for (let contractIndex = 0; contractIndex < contracts.length; contractIndex += 1) {
    const contract = contracts[contractIndex];
    if (contract === undefined) {
      throw new Error("interface origin resolution lost a contract");
    }
    const contractResolutions = new Map<Node, InterfaceOriginResolution>();
    resolved.set(contract, contractResolutions);
    for (const [value, root] of roots.get(contract) ?? []) {
      const result = resolutions.resolutionFor(root.vertex, contractIndex);
      if (result.closed) {
        closed += 1;
      }
      contractResolutions.set(value, Object.freeze(result));
    }
  }
  const factMeasurements = shared.facts.measurements();
  const measurements = Object.freeze({
    ...resolutions.measurements,
    closed,
    contractExpansions: factMeasurements.contractExpansions,
    contractQueries: factMeasurements.contractQueries,
    roots: rootCount,
    valueExpansions: factMeasurements.valueExpansions,
    valueQueries: factMeasurements.valueQueries,
  });
  return Object.freeze({
    measurements,
    resolutionFor(value: Node, contract: Node): InterfaceOriginResolution {
      const result = resolved.get(contract)?.get(value);
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
  context: OriginGraphSharedContext,
): OriginState {
  const expression = context.facts.successfulExpression(value);
  const selected = expression ?? value;
  const states = role === "value" ? context.values : context.containers;
  let state = states.get(selected);
  if (state === undefined) {
    state = {
      vertex: context.builder.vertex(),
      expansion: "expression",
      occurrence: value,
      ...(expression === undefined ? {} : { expression }),
      role,
      pending: undefined,
      queued: false,
    };
    states.set(selected, state);
  }
  return state;
}

function schedule(
  state: OriginState,
  contracts: InterfaceOriginContractSet,
  context: OriginGraphSharedContext,
): void {
  const added = context.builder.activate(state.vertex, contracts);
  if (context.domain.isEmpty(added)) {
    return;
  }
  state.pending = state.pending === undefined
    ? added
    : context.domain.union(state.pending, added);
  if (!state.queued) {
    state.queued = true;
    context.pending.push(state);
  }
}

function drainOriginExpansions(context: OriginGraphSharedContext): void {
  for (let next = 0; next < context.pending.length; next += 1) {
    const state = context.pending[next];
    if (state === undefined || state.pending === undefined) {
      throw new Error("interface origin expansion lost a pending state");
    }
    const active = state.pending;
    state.pending = undefined;
    state.queued = false;
    const frame: OriginGraphContext = { ...context, active };
    if (state.expansion === "declaration") {
      expandDeclaration(
        state,
        state.occurrence,
        state.role,
        state.occurrence,
        frame,
      );
    } else if (state.expression === undefined) {
      boundary(state, "unproven-value-origin", state.occurrence, frame);
    } else if (state.role === "value") {
      expandInterfaceOriginValue(state, state.expression, frame, expansion);
    } else {
      expandInterfaceOriginContainer(state, state.expression, frame, expansion);
    }
  }
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
      const provided = context.domain.select(
        context.active,
        (contract) => context.facts.typeProvidesContract(
          input.semantics,
          input.type,
          contract,
        ),
      );
      origin(state, input.occurrence, context, provided);
      boundary(
        state,
        "unproven-value-origin",
        input.occurrence,
        context,
        context.domain.subtract(context.active, provided),
      );
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
      if (type !== undefined) {
        const relevantContracts = context.ingress.relevance.valueContracts(
          semantics,
          type,
        );
        const relevant = context.domain.select(
          context.active,
          (contract) => relevantContracts.includes(contract),
        );
        origin(
          state,
          alternative.expression,
          context,
          context.domain.subtract(context.active, relevant),
        );
        dependency(
          state,
          alternative.expression,
          role,
          "conditional",
          occurrence,
          context,
          relevant,
        );
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
  contracts: InterfaceOriginContractSet = context.active,
): void {
  if (context.domain.isEmpty(contracts)) {
    return;
  }
  const sourceState = stateFor(source, role, context);
  context.builder.addDependency(
    destination.vertex,
    sourceState.vertex,
    kind,
    occurrence,
    contracts,
  );
  schedule(sourceState, contracts, context);
}

function declarationDependency(
  destination: OriginState,
  declaration: Node,
  role: OriginRole,
  kind: EffectProvenanceEdgeKind,
  occurrence: Node,
  context: OriginGraphContext,
  contracts: InterfaceOriginContractSet = context.active,
): void {
  if (context.domain.isEmpty(contracts)) {
    return;
  }
  const sourceState = stateForDeclaration(declaration, role, context);
  context.builder.addDependency(
    destination.vertex,
    sourceState.vertex,
    kind,
    occurrence,
    contracts,
  );
  schedule(sourceState, contracts, context);
}

function stateForDeclaration(
  declaration: Node,
  role: OriginRole,
  context: OriginGraphSharedContext,
): OriginState {
  const states = role === "value" ? context.values : context.containers;
  let state = states.get(declaration);
  if (state === undefined) {
    state = {
      vertex: context.builder.vertex(),
      expansion: "declaration",
      occurrence: declaration,
      role,
      pending: undefined,
      queued: false,
    };
    states.set(declaration, state);
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

function terminalForContracts(
  state: OriginState,
  closedContracts: InterfaceOriginContractSet,
  occurrence: Node,
  context: OriginGraphContext,
  reason: InterfaceOriginBoundaryReason = "unproven-value-origin",
): void {
  origin(state, occurrence, context, closedContracts);
  boundary(
    state,
    reason,
    occurrence,
    context,
    context.domain.subtract(context.active, closedContracts),
  );
}

function origin(
  state: OriginState,
  _occurrence: Node,
  context: OriginGraphContext,
  contracts: InterfaceOriginContractSet = context.active,
): void {
  if (!context.domain.isEmpty(contracts)) {
    context.builder.addOrigin(state.vertex, contracts);
  }
}

function boundary(
  state: OriginState,
  reason: InterfaceOriginBoundaryReason,
  _occurrence: Node,
  context: OriginGraphContext,
  contracts: InterfaceOriginContractSet = context.active,
): void {
  if (!context.domain.isEmpty(contracts)) {
    context.builder.addBoundary(state.vertex, reason, contracts);
  }
}
