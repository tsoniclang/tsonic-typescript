import type { Node, Symbol } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import {
  directContainingCall,
  forEachProgramNode,
  isModuleForwardingReference,
} from "./syntax.js";

export interface ConstructorInputs {
  readonly values: ReadonlyMap<Node, readonly Node[]>;
  readonly closed: ReadonlySet<Node>;
}

interface ReferenceCounts {
  total: number;
  direct: number;
}

export function collectConstructorInputs(
  source: TargetSourceProgram,
): ConstructorInputs {
  const mutableValues = new Map<Node, Node[]>();
  const constructorClasses = new Map<Node, Node>();
  const invalidConstructors = new Set<Node>();
  forEachProgramNode(source, (node) => {
    if (source.ast.is.IsConstructorDeclaration(node)) {
      const classDeclaration = source.ast.parent(node);
      if (
        classDeclaration !== undefined &&
        source.ast.is.IsClassDeclaration(classDeclaration)
      ) {
        constructorClasses.set(node, classDeclaration);
      }
      return;
    }
    if (!source.ast.is.IsNewExpression(node)) {
      return;
    }
    const semantics = source.semantics.forNode(node);
    const signature = semantics.getResolvedSignature(node);
    const declaration = semantics.getSignatureDeclaration(signature);
    if (
      declaration === undefined ||
      !source.ast.is.IsConstructorDeclaration(declaration)
    ) {
      return;
    }
    const parameters = source.ast.parameters(declaration);
    const arguments_ = source.ast.arguments(node);
    if (
      arguments_.some((argument) => source.ast.is.IsSpreadElement(argument)) ||
      parameters.some((parameter) =>
        source.ast.as.AsParameterDeclaration(parameter)?.DotDotDotToken !== undefined
      )
    ) {
      invalidConstructors.add(declaration);
      return;
    }
    for (let index = 0; index < parameters.length; index += 1) {
      const parameter = parameters[index];
      const argument = arguments_[index];
      if (
        parameter !== undefined &&
        argument !== undefined &&
        isReadonlyParameterProperty(source, parameter)
      ) {
        append(mutableValues, parameter, argument);
      }
    }
  });

  const classReferences = new Map<Node, ReferenceCounts>();
  for (const classDeclaration of constructorClasses.values()) {
    classReferences.set(classDeclaration, { total: 0, direct: 0 });
  }
  const classSymbols = indexDeclarationSymbols(
    source,
    classReferences.keys(),
  );
  const propertyReferences = new Map<Node, ReferenceCounts>();
  for (const parameter of mutableValues.keys()) {
    propertyReferences.set(parameter, { total: 0, direct: 0 });
  }
  const propertySymbols = indexDeclarationSymbols(
    source,
    propertyReferences.keys(),
  );
  forEachProgramNode(source, (node) => {
    auditClassReference(source, node, classReferences, classSymbols);
    auditPropertyReference(
      source,
      node,
      propertyReferences,
      propertySymbols,
    );
  });

  const closed = new Set<Node>();
  for (const [constructor, classDeclaration] of constructorClasses) {
    const classCounts = classReferences.get(classDeclaration);
    if (
      invalidConstructors.has(constructor) ||
      classCounts === undefined ||
      classCounts.total !== classCounts.direct ||
      classCounts.direct === 0
    ) {
      continue;
    }
    for (const parameter of source.ast.parameters(constructor)) {
      const propertyCounts = parameter === undefined
        ? undefined
        : propertyReferences.get(parameter);
      if (
        parameter !== undefined &&
        isReadonlyParameterProperty(source, parameter) &&
        mutableValues.has(parameter) &&
        propertyCounts !== undefined &&
        propertyCounts.total === propertyCounts.direct &&
        propertyCounts.direct !== 0
      ) {
        closed.add(parameter);
      }
    }
  }
  return Object.freeze({
    values: new Map([...mutableValues].map(([key, values]) => [
      key,
      Object.freeze(values),
    ])),
    closed,
  });
}

function auditClassReference(
  source: TargetSourceProgram,
  node: Node,
  tracked: ReadonlyMap<Node, ReferenceCounts>,
  trackedSymbols: ReadonlyMap<Symbol, Node>,
): void {
  if (tracked.size === 0 || !source.ast.is.IsIdentifier(node)) {
    return;
  }
  const declaration = declarationForSymbols(source, trackedSymbols, node);
  const counts = declaration === undefined ? undefined : tracked.get(declaration);
  if (
    counts === undefined ||
    node === source.ast.name(declaration) ||
    isTypeOnlyReference(source, node) ||
    isModuleForwardingReference(source, node)
  ) {
    return;
  }
  counts.total += 1;
  if (directContainingNew(source, node) !== undefined) {
    counts.direct += 1;
  }
}

function auditPropertyReference(
  source: TargetSourceProgram,
  node: Node,
  tracked: ReadonlyMap<Node, ReferenceCounts>,
  trackedSymbols: ReadonlyMap<Symbol, Node>,
): void {
  if (tracked.size === 0) {
    return;
  }
  if (source.ast.is.IsPropertyAccessExpression(node)) {
    const selected = source.semantics.forNode(node)
      .getResolvedPropertyAccessInfo(node);
    countPropertyUse(
      selected?.selectedDeclaration === undefined
        ? undefined
        : tracked.get(selected.selectedDeclaration),
      selected !== undefined &&
        (selected.callCallee ||
          directContainingCall(source, node) !== undefined) &&
        selected.accessMode === "read" &&
        !selected.optionalChain,
    );
    return;
  }
  if (source.ast.is.IsElementAccessExpression(node)) {
    const selected = source.semantics.forNode(node)
      .getResolvedElementAccessInfo(node);
    countPropertyUse(
      selected?.selectedDeclaration === undefined
        ? undefined
        : tracked.get(selected.selectedDeclaration),
      selected !== undefined &&
        (selected.callCallee ||
          directContainingCall(source, node) !== undefined) &&
        selected.accessMode === "read" &&
        !selected.optionalChain,
    );
    return;
  }
  if (
    !source.ast.is.IsIdentifier(node) ||
    isPropertyAccessName(source, node)
  ) {
    return;
  }
  const declaration = declarationForSymbols(
    source,
    trackedSymbols,
    node,
  );
  const counts = declaration === undefined ? undefined : tracked.get(declaration);
  if (
    counts !== undefined &&
    node !== source.ast.name(declaration) &&
    !isTypeOnlyReference(source, node) &&
    !isModuleForwardingReference(source, node)
  ) {
    counts.total += 1;
  }
}

function indexDeclarationSymbols(
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

function declarationForSymbols(
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

function exactSymbolsAt(
  source: TargetSourceProgram,
  node: Node | undefined,
): readonly Symbol[] {
  if (node === undefined) {
    return [];
  }
  const semantics = source.semantics.forNode(node);
  const result = new Set<Symbol>();
  for (const symbol of [
    semantics.getSymbolAtLocation(node),
    semantics.getResolvedSymbol(node),
  ]) {
    if (symbol !== undefined) {
      result.add(symbol);
    }
  }
  return [...result];
}

function countPropertyUse(
  counts: ReferenceCounts | undefined,
  direct: boolean,
): void {
  if (counts === undefined) {
    return;
  }
  counts.total += 1;
  if (direct) {
    counts.direct += 1;
  }
}

function isReadonlyParameterProperty(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  return source.ast.is.IsParameterDeclaration(node) &&
    source.ast.hasModifierKind(node, "readonly") &&
    source.ast.parent(node) !== undefined &&
    source.ast.is.IsConstructorDeclaration(source.ast.parent(node));
}

function directContainingNew(
  source: TargetSourceProgram,
  reference: Node,
): Node | undefined {
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return undefined;
    }
    if (source.ast.is.IsNewExpression(parent)) {
      return source.ast.as.AsNewExpression(parent)?.Expression === current
        ? parent
        : undefined;
    }
    if (
      source.ast.is.IsPropertyAccessExpression(parent) ||
      source.ast.is.IsParenthesizedExpression(parent)
    ) {
      current = parent;
      continue;
    }
    return undefined;
  }
}

function isTypeOnlyReference(source: TargetSourceProgram, node: Node): boolean {
  let current: Node | undefined = node;
  while (current !== undefined) {
    if (source.ast.is.IsTypeReferenceNode(current)) {
      return true;
    }
    if (
      source.ast.is.IsExpressionStatement(current) ||
      source.ast.is.IsVariableDeclaration(current) ||
      source.ast.is.IsCallExpression(current) ||
      source.ast.is.IsNewExpression(current) ||
      source.ast.is.IsClassDeclaration(current) ||
      source.ast.is.IsSourceFile(current)
    ) {
      return false;
    }
    current = source.ast.parent(current);
  }
  return false;
}

function isPropertyAccessName(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  const parent = source.ast.parent(node);
  return parent !== undefined &&
    source.ast.is.IsPropertyAccessExpression(parent) &&
    source.ast.as.AsPropertyAccessExpression(parent)?.name === node;
}

function append(target: Map<Node, Node[]>, key: Node, value: Node): void {
  const values = target.get(key);
  if (values === undefined) {
    target.set(key, [value]);
  } else {
    values.push(value);
  }
}
