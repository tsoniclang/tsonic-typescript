import type { Node, Symbol } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import { KindIdentifier } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";

import { directContainingCall } from "./syntax.js";

export interface ParameterUses {
  readonly dependencies: ReadonlyMap<Node, ReadonlySet<Node>>;
  readonly invalid: ReadonlySet<Node>;
}

export function indexParameterUses(
  source: TargetSourceProgram,
  parameters: Iterable<Node>,
  destinations: ReadonlySet<Node>,
  program: TargetProgramIndex,
): ParameterUses {
  const tracked = new Set(parameters);
  const allDeclarations = new Set([...tracked, ...destinations]);
  const symbols = indexDeclarationSymbols(source, allDeclarations);
  const dependencies = new Map<Node, Set<Node>>();
  const invalid = new Set<Node>();
  for (const node of program.nodesOfKind(KindIdentifier)) {
    const parameter = declarationForSymbols(source, symbols, node);
    if (
      parameter === undefined ||
      node === source.ast.name(parameter) ||
      invalid.has(parameter)
    ) {
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
  return { dependencies, invalid };
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
      const index = source.ast.arguments(parent).indexOf(current);
      if (index < 0) {
        return undefined;
      }
      const semantics = source.semantics.forNode(parent);
      const declaration = semantics.getSignatureDeclaration(
        semantics.getResolvedSignature(parent),
      );
      const destination = declaration === undefined
        ? undefined
        : source.ast.parameters(declaration)[index];
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
