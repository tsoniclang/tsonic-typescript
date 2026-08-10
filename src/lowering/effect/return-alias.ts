import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { isFunctionLike, transparentExpression } from "./syntax.js";

export interface ReturnAliasFlow {
  acceptsInitializer(reference: Node, rootDeclaration: Node): boolean;
}

export function createReturnAliasFlow(
  source: TargetSourceProgram,
  bindingOwners: ReadonlyMap<Node, Node>,
  nodes: readonly Node[],
  useIsAdmitted: (reference: Node, rootDeclaration: Node) => boolean,
): ReturnAliasFlow {
  const sources = collectAliasSources(source, nodes);
  const references = collectAliasReferences(source, sources, nodes);
  const roots = resolveAliasRoots(source, bindingOwners, sources);
  const closed = closeAliases(
    source,
    sources,
    references,
    roots,
    useIsAdmitted,
  );
  return Object.freeze({
    acceptsInitializer(reference: Node, rootDeclaration: Node): boolean {
      const alias = aliasDeclarationAtInitializer(source, reference);
      return alias !== undefined &&
        roots.get(alias) === rootDeclaration &&
        closed.has(alias);
    },
  });
}

function collectAliasSources(
  source: TargetSourceProgram,
  nodes: readonly Node[],
): ReadonlyMap<Node, Node> {
  const sources = new Map<Node, Node>();
  for (const node of nodes) {
    if (
      !source.ast.is.IsVariableDeclaration(node) ||
      !source.ast.is.IsIdentifier(source.ast.name(node))
    ) {
      continue;
    }
    const initializer = transparentExpression(
      source,
      source.ast.as.AsVariableDeclaration(node)?.Initializer,
    );
    const sourceDeclaration = initializer !== undefined &&
        source.ast.is.IsIdentifier(initializer)
      ? source.navigation.sourceReferenceFor(initializer)?.declaration
      : undefined;
    if (sourceDeclaration !== undefined && sourceDeclaration !== node) {
      sources.set(node, sourceDeclaration);
    }
  }
  return sources;
}

function collectAliasReferences(
  source: TargetSourceProgram,
  sources: ReadonlyMap<Node, Node>,
  nodes: readonly Node[],
): ReadonlyMap<Node, readonly Node[]> {
  const references = new Map<Node, Node[]>();
  for (const node of nodes) {
    if (!source.ast.is.IsIdentifier(node)) {
      continue;
    }
    const declaration = source.navigation.sourceReferenceFor(node)?.declaration;
    if (declaration === undefined || !sources.has(declaration)) {
      continue;
    }
    const existing = references.get(declaration);
    if (existing === undefined) {
      references.set(declaration, [node]);
    } else {
      existing.push(node);
    }
  }
  return references;
}

function resolveAliasRoots(
  source: TargetSourceProgram,
  bindingOwners: ReadonlyMap<Node, Node>,
  sources: ReadonlyMap<Node, Node>,
): ReadonlyMap<Node, Node> {
  const roots = new Map<Node, Node>();
  const pending = new Set<Node>();
  const rootFor = (alias: Node): Node | undefined => {
    const existing = roots.get(alias);
    if (existing !== undefined) {
      return existing;
    }
    if (pending.has(alias)) {
      return undefined;
    }
    pending.add(alias);
    const sourceDeclaration = sources.get(alias);
    const root = sourceDeclaration === undefined
      ? undefined
      : bindingOwners.has(sourceDeclaration)
      ? sourceDeclaration
      : rootFor(sourceDeclaration);
    pending.delete(alias);
    if (
      root !== undefined &&
      containingFunction(source, alias) === bindingOwners.get(root)
    ) {
      roots.set(alias, root);
      return root;
    }
    return undefined;
  };
  for (const alias of sources.keys()) {
    rootFor(alias);
  }
  return roots;
}

function closeAliases(
  source: TargetSourceProgram,
  sources: ReadonlyMap<Node, Node>,
  references: ReadonlyMap<Node, readonly Node[]>,
  roots: ReadonlyMap<Node, Node>,
  useIsAdmitted: (reference: Node, rootDeclaration: Node) => boolean,
): ReadonlySet<Node> {
  const closed = new Set<Node>();
  const rejected = new Set<Node>();
  const pending = new Set<Node>();
  const closes = (alias: Node): boolean => {
    if (closed.has(alias)) {
      return true;
    }
    if (rejected.has(alias) || pending.has(alias)) {
      return false;
    }
    const root = roots.get(alias);
    if (root === undefined) {
      rejected.add(alias);
      return false;
    }
    pending.add(alias);
    const result = (references.get(alias) ?? []).every((reference) => {
      if (reference === source.ast.name(alias)) {
        return true;
      }
      if (useIsAdmitted(reference, root)) {
        return true;
      }
      const child = aliasDeclarationAtInitializer(source, reference);
      return child !== undefined &&
        sources.has(child) &&
        roots.get(child) === root &&
        closes(child);
    });
    pending.delete(alias);
    if (result) {
      closed.add(alias);
    } else {
      rejected.add(alias);
    }
    return result;
  };
  for (const alias of roots.keys()) {
    closes(alias);
  }
  return closed;
}

function aliasDeclarationAtInitializer(
  source: TargetSourceProgram,
  reference: Node,
): Node | undefined {
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return undefined;
    }
    if (source.ast.is.IsVariableDeclaration(parent)) {
      return source.ast.as.AsVariableDeclaration(parent)?.Initializer === current &&
          source.ast.is.IsIdentifier(source.ast.name(parent))
        ? parent
        : undefined;
    }
    if (transparentChild(source, parent) !== current) {
      return undefined;
    }
    current = parent;
  }
}

function containingFunction(
  source: TargetSourceProgram,
  node: Node,
): Node | undefined {
  let current = source.ast.parent(node);
  while (current !== undefined) {
    if (isFunctionLike(source, current)) {
      return current;
    }
    current = source.ast.parent(current);
  }
  return undefined;
}

function transparentChild(
  source: TargetSourceProgram,
  node: Node,
): Node | undefined {
  if (source.ast.is.IsParenthesizedExpression(node)) {
    return source.ast.as.AsParenthesizedExpression(node)?.Expression;
  }
  if (source.ast.is.IsAsExpression(node)) {
    return source.ast.as.AsAsExpression(node)?.Expression;
  }
  if (source.ast.is.IsTypeAssertion(node)) {
    return source.ast.as.AsTypeAssertion(node)?.Expression;
  }
  if (source.ast.is.IsSatisfiesExpression(node)) {
    return source.ast.as.AsSatisfiesExpression(node)?.Expression;
  }
  return source.ast.is.IsNonNullExpression(node)
    ? source.ast.as.AsNonNullExpression(node)?.Expression
    : undefined;
}
