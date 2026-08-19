import type { Node, Symbol } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import { KindIdentifier } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { CallableInputUseContract } from "./input-use.js";

import { directContainingCall } from "../../model/syntax.js";
import { exactSourceCallBindings } from "../invocation/call-binding.js";

export interface ParameterUses {
  readonly dependencies: ReadonlyMap<Node, ReadonlySet<Node>>;
  readonly invalid: ReadonlySet<Node>;
  readonly assignedValues: ReadonlyMap<Node, readonly Node[]>;
}

export function indexParameterUses(
  source: TargetSourceProgram,
  parameters: Iterable<Node>,
  destinations: ReadonlySet<Node>,
  program: TargetProgramIndex,
  inputUses?: CallableInputUseContract,
): ParameterUses {
  const tracked = new Set(parameters);
  const allDeclarations = new Set([...tracked, ...destinations]);
  const symbols = indexDeclarationSymbols(source, allDeclarations);
  const dependencies = new Map<Node, Set<Node>>();
  const invalid = new Set<Node>();
  const assignedValues = new Map<Node, Node[]>();
  for (const node of program.nodesOfKind(KindIdentifier)) {
    const parameter = declarationForSymbols(source, symbols, node);
    if (
      parameter === undefined ||
      node === source.ast.name(parameter) ||
      invalid.has(parameter)
    ) {
      continue;
    }
    const assigned = exactAssignedValue(source, node);
    if (assigned !== undefined) {
      append(assignedValues, parameter, assigned);
      continue;
    }
    const transported = transportedCallableDestinations(
      source,
      node,
      allDeclarations,
      symbols,
      inputUses,
    );
    if (transported !== undefined) {
      for (const destination of transported) {
        appendSet(dependencies, parameter, destination);
      }
      continue;
    }
    if (
      directContainingCall(source, node) !== undefined ||
      isCallablePresenceObservation(source, node)
    ) {
      continue;
    }
    const destination = trackedInputDestination(
      source,
      node,
      allDeclarations,
      symbols,
    );
    if (destination === undefined) {
      invalid.add(parameter);
      continue;
    }
    let targets = dependencies.get(parameter);
    if (targets === undefined) {
      targets = new Set();
      dependencies.set(parameter, targets);
    }
    targets.add(destination);
  }
  for (const values of assignedValues.values()) {
    Object.freeze(values);
  }
  return { dependencies, invalid, assignedValues };
}

export function transportedCallableDestinations(
  source: TargetSourceProgram,
  reference: Node,
  declarations: ReadonlySet<Node>,
  symbols: ReadonlyMap<Symbol, Node>,
  inputUses: CallableInputUseContract | undefined,
): readonly Node[] | undefined {
  const use = inputUses?.useFor(reference);
  if (use === undefined) {
    return undefined;
  }
  if (use.kind === "terminal") {
    return [];
  }
  const result = new Set<Node>();
  for (const output of use.outputs) {
    if (directContainingCall(source, output) !== undefined) {
      continue;
    }
    const destination = trackedInputDestination(
      source,
      output,
      declarations,
      symbols,
    );
    if (destination === undefined) {
      return undefined;
    }
    result.add(destination);
  }
  return Object.freeze([...result]);
}

function exactAssignedValue(
  source: TargetSourceProgram,
  reference: Node,
): Node | undefined {
  const parent = source.ast.parent(reference);
  if (
    parent === undefined ||
    !source.ast.is.IsBinaryExpression(parent) ||
    source.ast.operatorKindName(parent) !== "KindEqualsToken" ||
    source.ast.as.AsBinaryExpression(parent)?.Left !== reference
  ) {
    return undefined;
  }
  return source.ast.as.AsBinaryExpression(parent)?.Right;
}

export function trackedInputDestination(
  source: TargetSourceProgram,
  expression: Node,
  declarations: ReadonlySet<Node>,
  symbols: ReadonlyMap<Symbol, Node>,
): Node | undefined {
  let current = expression;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return undefined;
    }
    if (isTransparentParent(source, parent, current)) {
      current = parent;
      continue;
    }
    if (source.ast.is.IsVariableDeclaration(parent)) {
      return source.ast.as.AsVariableDeclaration(parent)?.Initializer === current &&
          declarations.has(parent)
        ? parent
        : undefined;
    }
    if (source.ast.is.IsBinaryExpression(parent)) {
      const binary = source.ast.as.AsBinaryExpression(parent);
      return binary?.Right === current &&
          source.ast.operatorKindName(parent) === "KindEqualsToken"
        ? trackedStorageDeclaration(
          source,
          binary.Left,
          declarations,
          symbols,
        )
        : undefined;
    }
    if (
      source.ast.is.IsCallExpression(parent) ||
      source.ast.is.IsNewExpression(parent)
    ) {
      const bindings = exactSourceCallBindings(source, parent)?.bindings.filter(
        ({ argument, evidence }) =>
          argument === current && evidence.sourceForm === "value",
      );
      const destination = bindings?.length === 1
        ? bindings[0]?.parameter
        : undefined;
      return destination !== undefined && declarations.has(destination)
        ? destination
        : undefined;
    }
    return undefined;
  }
}

function trackedStorageDeclaration(
  source: TargetSourceProgram,
  expression: Node | undefined,
  declarations: ReadonlySet<Node>,
  symbols: ReadonlyMap<Symbol, Node>,
): Node | undefined {
  if (expression === undefined) {
    return undefined;
  }
  if (source.ast.is.IsIdentifier(expression)) {
    const declaration = declarationForSymbols(source, symbols, expression);
    return declaration !== undefined && declarations.has(declaration)
      ? declaration
      : undefined;
  }
  const selected = source.ast.is.IsPropertyAccessExpression(expression)
    ? source.semantics.forNode(expression).getResolvedPropertyAccessInfo(expression)
    : source.ast.is.IsElementAccessExpression(expression)
    ? source.semantics.forNode(expression).getResolvedElementAccessInfo(expression)
    : undefined;
  return selected?.selectedDeclaration !== undefined &&
      declarations.has(selected.selectedDeclaration)
    ? selected.selectedDeclaration
    : undefined;
}

export function isCallablePresenceObservation(
  source: TargetSourceProgram,
  expression: Node,
): boolean {
  let current = expression;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return false;
    }
    if (isTransparentParent(source, parent, current)) {
      current = parent;
      continue;
    }
    if (
      !source.ast.is.IsBinaryExpression(parent) ||
      !new Set([
        "KindEqualsEqualsToken",
        "KindExclamationEqualsToken",
        "KindEqualsEqualsEqualsToken",
        "KindExclamationEqualsEqualsToken",
      ]).has(source.ast.operatorKindName(parent) ?? "")
    ) {
      return false;
    }
    const binary = source.ast.as.AsBinaryExpression(parent);
    const other = binary?.Left === current
      ? binary.Right
      : binary?.Right === current
      ? binary.Left
      : undefined;
    const otherType = other === undefined
      ? undefined
      : source.semantics.forNode(other).getTypeAtLocation(other);
    return other !== undefined && otherType !== undefined &&
      source.semantics.forNode(other).isNullish(otherType);
  }
}

function append(target: Map<Node, Node[]>, key: Node, value: Node): void {
  const values = target.get(key);
  if (values === undefined) {
    target.set(key, [value]);
  } else {
    values.push(value);
  }
}

function appendSet(target: Map<Node, Set<Node>>, key: Node, value: Node): void {
  const values = target.get(key);
  if (values === undefined) {
    target.set(key, new Set([value]));
  } else {
    values.add(value);
  }
}

export function indexDeclarationSymbols(
  source: TargetSourceProgram,
  declarations: Iterable<Node>,
): ReadonlyMap<Symbol, Node> {
  const result = new Map<Symbol, Node>();
  for (const declaration of declarations) {
    for (const symbol of exactSymbolsAt(source, source.ast.name(declaration))) {
      result.set(symbol, declaration);
    }
  }
  return result;
}

export function declarationForSymbols(
  source: TargetSourceProgram,
  declarations: ReadonlyMap<Symbol, Node>,
  node: Node,
): Node | undefined {
  for (const symbol of exactSymbolsAt(source, node)) {
    const declaration = declarations.get(symbol);
    if (declaration !== undefined) {
      return declaration;
    }
  }
  return undefined;
}

export function isTransparentParent(
  source: TargetSourceProgram,
  parent: Node,
  child: Node,
): boolean {
  if (source.ast.is.IsParenthesizedExpression(parent)) {
    return source.ast.as.AsParenthesizedExpression(parent)?.Expression === child;
  }
  if (source.ast.is.IsAsExpression(parent)) {
    return source.ast.as.AsAsExpression(parent)?.Expression === child;
  }
  if (source.ast.is.IsTypeAssertion(parent)) {
    return source.ast.as.AsTypeAssertion(parent)?.Expression === child;
  }
  if (source.ast.is.IsSatisfiesExpression(parent)) {
    return source.ast.as.AsSatisfiesExpression(parent)?.Expression === child;
  }
  return source.ast.is.IsNonNullExpression(parent) &&
    source.ast.as.AsNonNullExpression(parent)?.Expression === child;
}

function exactSymbolsAt(
  source: TargetSourceProgram,
  node: Node | undefined,
): readonly Symbol[] {
  if (node === undefined) {
    return [];
  }
  const semantics = source.semantics.forNode(node);
  return [
    semantics.getSymbolAtLocation(node),
    semantics.getResolvedSymbol(node),
  ].filter((symbol): symbol is Symbol => symbol !== undefined);
}
