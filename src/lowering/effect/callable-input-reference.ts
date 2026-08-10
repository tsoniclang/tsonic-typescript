import type { Node, Symbol } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import {
  directContainingCall,
  forEachProgramNode,
} from "./syntax.js";

export interface ParameterUses {
  readonly dependencies: ReadonlyMap<Node, ReadonlySet<Node>>;
  readonly invalid: ReadonlySet<Node>;
}

export function indexParameterUses(
  source: TargetSourceProgram,
  parameters: Iterable<Node>,
  fields: ReadonlySet<Node>,
): ParameterUses {
  const tracked = new Set(parameters);
  const symbols = indexDeclarationSymbols(source, tracked);
  const dependencies = new Map<Node, Set<Node>>();
  const invalid = new Set<Node>();
  forEachProgramNode(source, (node) => {
    if (!source.ast.is.IsIdentifier(node)) {
      return;
    }
    const parameter = declarationForSymbols(source, symbols, node);
    if (
      parameter === undefined ||
      node === source.ast.name(parameter) ||
      invalid.has(parameter)
    ) {
      return;
    }
    if (
      directContainingCall(source, node) !== undefined ||
      isCallablePresenceObservation(source, node)
    ) {
      return;
    }
    const destination = trackedInputDestination(
      source,
      node,
      tracked,
      fields,
    );
    if (destination === undefined) {
      invalid.add(parameter);
      return;
    }
    let targets = dependencies.get(parameter);
    if (targets === undefined) {
      targets = new Set();
      dependencies.set(parameter, targets);
    }
    targets.add(destination);
  });
  return { dependencies, invalid };
}

export function trackedInputDestination(
  source: TargetSourceProgram,
  expression: Node,
  parameters: ReadonlySet<Node>,
  fields: ReadonlySet<Node>,
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
    if (
      !source.ast.is.IsCallExpression(parent) &&
      !source.ast.is.IsNewExpression(parent)
    ) {
      return undefined;
    }
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
    return destination !== undefined &&
        (parameters.has(destination) || fields.has(destination))
      ? destination
      : undefined;
  }
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
