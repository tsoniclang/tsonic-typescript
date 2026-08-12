import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { indexExactDeclarations } from "./flow-references.js";

export interface PointerCallableAliasBoundary {
  readonly owner: Node;
  readonly occurrences: readonly Node[];
}

export interface PointerCallableAliases {
  readonly allowedReferences: ReadonlySet<Node>;
  readonly boundaries: readonly PointerCallableAliasBoundary[];
  readonly optimizedAliasCount: number;
  readonly traversalOperations: number;
  ownerForTarget(expression: Node | undefined): Node | undefined;
}

interface CallableAliasCandidate {
  readonly declaration: Node;
  readonly reference: Node;
  readonly target: Node;
  readonly eligible: boolean;
}

interface CallableAliasShape {
  readonly declaration: Node;
  readonly initializer: Node;
  readonly reference: Node;
}

interface MutableCallableFamily {
  readonly owner: Node;
  readonly aliases: Set<Node>;
  readonly boundaries: Set<Node>;
}

export function analyzePointerCallableAliases(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  owners: ReadonlySet<Node>,
): PointerCallableAliases {
  const shapes: CallableAliasShape[] = [];
  for (const declaration of nodes) {
    if (
      !source.ast.is.IsVariableDeclaration(declaration) ||
      !source.ast.is.IsIdentifier(source.ast.name(declaration))
    ) {
      continue;
    }
    const initializer = source.ast.as.AsVariableDeclaration(declaration)?.Initializer;
    const reference = callableReference(source, initializer);
    if (initializer !== undefined && reference !== undefined) {
      shapes.push({ declaration, initializer, reference });
    }
  }
  const declarations = new Set([
    ...owners,
    ...shapes.map((shape) => shape.declaration),
  ]);
  const exactDeclarations = indexExactDeclarations(source, declarations);
  const candidates = new Map<Node, CallableAliasCandidate>();
  let traversalOperations = nodes.length;
  for (const shape of shapes) {
    const { declaration, initializer, reference } = shape;
    const target = exactDeclarations.declarationFor(reference);
    if (target === undefined) {
      continue;
    }
    candidates.set(declaration, {
      declaration,
      reference,
      target,
      eligible: source.ast.variableDeclarationKind(declaration) === "const" &&
        source.ast.typeNode(declaration) === undefined &&
        exactReferenceExpression(source, initializer, reference, target),
    });
  }

  const resolved = new Map<Node, Node | false>();
  const resolving = new Set<Node>();
  const resolveOwner = (declaration: Node): Node | undefined => {
    traversalOperations += 1;
    if (owners.has(declaration)) {
      return declaration;
    }
    const existing = resolved.get(declaration);
    if (existing !== undefined) {
      return existing === false ? undefined : existing;
    }
    const candidate = candidates.get(declaration);
    if (candidate === undefined || resolving.has(declaration)) {
      resolved.set(declaration, false);
      return undefined;
    }
    resolving.add(declaration);
    const owner = resolveOwner(candidate.target);
    resolving.delete(declaration);
    resolved.set(declaration, owner ?? false);
    return owner;
  };

  const families = new Map<Node, MutableCallableFamily>();
  const candidateOwners = new Map<Node, Node>();
  const familyFor = (owner: Node): MutableCallableFamily => {
    const existing = families.get(owner);
    if (existing !== undefined) {
      return existing;
    }
    const family = { owner, aliases: new Set<Node>(), boundaries: new Set<Node>() };
    families.set(owner, family);
    return family;
  };
  for (const candidate of candidates.values()) {
    const owner = resolveOwner(candidate.declaration);
    if (owner === undefined) {
      continue;
    }
    const family = familyFor(owner);
    candidateOwners.set(candidate.reference, owner);
    family.aliases.add(candidate.declaration);
    if (
      !candidate.eligible ||
      !source.ast.is.IsFunctionDeclaration(owner) ||
      declarationIsExported(source, owner) ||
      declarationIsExported(source, candidate.declaration)
    ) {
      family.boundaries.add(candidate.declaration);
    }
  }

  const references = new Map<Node, Node[]>();
  for (const node of nodes) {
    if (!source.ast.is.IsIdentifier(node)) {
      continue;
    }
    traversalOperations += 1;
    const declaration = exactDeclarations.declarationFor(node);
    if (declaration === undefined) {
      continue;
    }
    const selected = references.get(declaration);
    if (selected === undefined) {
      references.set(declaration, [node]);
    } else {
      selected.push(node);
    }
  }

  const allowedReferences = new Set<Node>();
  for (const family of families.values()) {
    const members = [family.owner, ...family.aliases];
    for (const declaration of members) {
      for (const reference of references.get(declaration) ?? []) {
        traversalOperations += 1;
        if (
          reference === source.ast.name(declaration)
        ) {
          continue;
        }
        if (isModuleTransportReference(source, reference)) {
          family.boundaries.add(reference);
          continue;
        }
        if (candidateOwners.get(reference) === family.owner) {
          allowedReferences.add(reference);
          continue;
        }
        const call = exactContainingCall(source, reference);
        if (call !== undefined && callSelectsOwner(source, call, family.owner)) {
          allowedReferences.add(reference);
          continue;
        }
        family.boundaries.add(reference);
      }
    }
  }

  for (const family of families.values()) {
    if (family.boundaries.size === 0) {
      continue;
    }
    for (const declaration of [family.owner, ...family.aliases]) {
      for (const reference of references.get(declaration) ?? []) {
        allowedReferences.delete(reference);
      }
    }
  }

  const validAliases = new Map<Node, Node>();
  let optimizedAliasCount = 0;
  for (const family of families.values()) {
    if (family.boundaries.size !== 0) {
      continue;
    }
    for (const alias of family.aliases) {
      validAliases.set(alias, family.owner);
      optimizedAliasCount += 1;
    }
  }
  const boundaries = Object.freeze([...families.values()]
    .filter((family) => family.boundaries.size !== 0)
    .map((family) => Object.freeze({
      owner: family.owner,
      occurrences: Object.freeze([...family.boundaries]),
    })));

  return Object.freeze({
    allowedReferences,
    boundaries,
    optimizedAliasCount,
    traversalOperations,
    ownerForTarget(expression: Node | undefined): Node | undefined {
      const reference = callableReference(source, expression);
      const declaration = exactDeclarations.declarationFor(reference);
      if (declaration === undefined) {
        return undefined;
      }
      if (owners.has(declaration)) {
        return declaration;
      }
      return validAliases.get(declaration);
    },
  });
}

function declarationIsExported(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  if (
    source.ast.hasModifierKind(declaration, "export") ||
    source.ast.hasModifierKind(declaration, "default")
  ) {
    return true;
  }
  if (!source.ast.is.IsVariableDeclaration(declaration)) {
    return false;
  }
  const declarationList = source.ast.parent(declaration);
  const statement = source.ast.parent(declarationList);
  return statement !== undefined &&
    source.ast.is.IsVariableStatement(statement) &&
    (source.ast.hasModifierKind(statement, "export") ||
      source.ast.hasModifierKind(statement, "default"));
}

function isModuleTransportReference(
  source: TargetSourceProgram,
  reference: Node,
): boolean {
  let current = source.ast.parent(reference);
  while (current !== undefined) {
    if (
      source.ast.is.IsImportClause(current) ||
      source.ast.is.IsImportSpecifier(current) ||
      source.ast.is.IsNamespaceImport(current) ||
      source.ast.is.IsExportSpecifier(current)
    ) {
      return true;
    }
    if (source.ast.is.IsSourceFile(current)) {
      return false;
    }
    current = source.ast.parent(current);
  }
  return false;
}

function callableReference(
  source: TargetSourceProgram,
  expression: Node | undefined,
): Node | undefined {
  let current = expression;
  while (current !== undefined && source.ast.is.IsParenthesizedExpression(current)) {
    current = source.ast.as.AsParenthesizedExpression(current)?.Expression;
  }
  if (current === undefined) {
    return undefined;
  }
  if (source.ast.is.IsIdentifier(current)) {
    return current;
  }
  return source.ast.is.IsPropertyAccessExpression(current)
    ? source.ast.as.AsPropertyAccessExpression(current)?.name
    : undefined;
}

function exactReferenceExpression(
  source: TargetSourceProgram,
  expression: Node,
  reference: Node,
  declaration: Node,
): boolean {
  let current: Node | undefined = expression;
  while (current !== undefined && source.ast.is.IsParenthesizedExpression(current)) {
    current = source.ast.as.AsParenthesizedExpression(current)?.Expression;
  }
  if (current === reference) {
    return true;
  }
  if (
    current === undefined ||
    !source.ast.is.IsPropertyAccessExpression(current) ||
    source.ast.as.AsPropertyAccessExpression(current)?.name !== reference
  ) {
    return false;
  }
  const selected = source.semantics.forNode(current)
    .getResolvedPropertyAccessInfo(current);
  return selected?.selectedDeclaration === declaration &&
    selected.optionalChain === false &&
    selected.accessMode === "read";
}

function exactContainingCall(
  source: TargetSourceProgram,
  reference: Node,
): Node | undefined {
  let current: Node = reference;
  const property = source.ast.parent(current);
  if (
    property !== undefined &&
    source.ast.is.IsPropertyAccessExpression(property) &&
    source.ast.as.AsPropertyAccessExpression(property)?.name === current
  ) {
    current = property;
  }
  for (;;) {
    const parent = source.ast.parent(current);
    if (
      parent !== undefined &&
      source.ast.is.IsParenthesizedExpression(parent) &&
      source.ast.as.AsParenthesizedExpression(parent)?.Expression === current
    ) {
      current = parent;
      continue;
    }
    if (
      parent !== undefined &&
      source.ast.is.IsCallExpression(parent) &&
      source.ast.as.AsCallExpression(parent)?.Expression === current
    ) {
      return parent;
    }
    return undefined;
  }
}

function callSelectsOwner(
  source: TargetSourceProgram,
  call: Node,
  owner: Node,
): boolean {
  const semantics = source.semantics.forNode(call);
  const info = semantics.getResolvedCallInfo(call);
  return info?.sourceSelectedSignatureKind === "resolved" &&
    info.optionalChain === false &&
    semantics.getSignatureDeclaration(info.selectedSignature) === owner;
}
