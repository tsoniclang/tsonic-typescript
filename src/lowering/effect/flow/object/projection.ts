import type { Node, Symbol } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import { KindVariableDeclaration } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import {
  isModuleForwardingReference,
  transparentExpression,
} from "../../model/syntax.js";
import { declarationIsExported } from "../../model/declaration-surface.js";
import { sameValueAlternatives } from "../value/alternatives.js";

export interface ExactObjectPropertyProjection {
  readonly declaration: Node;
  readonly initializers: readonly Node[];
  readonly container: Node;
}

export interface ExactObjectPropertyProjectionIndex {
  readonly properties: readonly ExactObjectPropertyProjection[];
  projectionFor(expression: Node): ExactObjectPropertyProjection | undefined;
  readsForInitializer(initializer: Node): readonly Node[] | undefined;
}

interface ObjectPropertySource extends ExactObjectPropertyProjection {
  readonly symbols: ReadonlySet<Symbol>;
  readonly declarations: ReadonlySet<Node>;
  readonly reads: Node[];
}

interface ObjectBinding {
  readonly declaration: Node;
  readonly container: Node;
  readonly properties: readonly ObjectPropertySource[];
  closed: boolean;
}

export function createExactObjectPropertyProjectionIndex(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ExactObjectPropertyProjectionIndex {
  const bindings = collectBindings(source, program);
  for (const binding of bindings) {
    auditBinding(source, program, binding);
  }
  const byRead = new Map<Node, ObjectPropertySource>();
  const readsByInitializer = new Map<Node, Node[]>();
  const properties: ExactObjectPropertyProjection[] = [];
  for (const binding of bindings) {
    if (!binding.closed) {
      continue;
    }
    for (const property of binding.properties) {
      properties.push(Object.freeze({
        declaration: property.declaration,
        initializers: property.initializers,
        container: property.container,
      }));
      for (const read of property.reads) {
        if (byRead.has(read)) {
          throw new Error("object property read belongs to multiple exact projections");
        }
        byRead.set(read, property);
      }
      for (const initializer of property.initializers) {
        const reads = readsByInitializer.get(initializer);
        if (reads === undefined) {
          readsByInitializer.set(initializer, [...property.reads]);
        } else {
          reads.push(...property.reads);
        }
      }
    }
  }
  const sealedReads = new Map([...readsByInitializer].map(
    ([initializer, reads]) => [initializer, Object.freeze([...reads])] as const,
  ));
  return Object.freeze({
    properties: Object.freeze(properties),
    projectionFor(
      expression: Node,
    ): ExactObjectPropertyProjection | undefined {
      const root = transparentExpression(source, expression);
      if (root === undefined) {
        return undefined;
      }
      const property = byRead.get(root);
      return property === undefined
        ? undefined
        : Object.freeze({
            declaration: property.declaration,
            initializers: property.initializers,
            container: property.container,
          });
    },
    readsForInitializer(initializer: Node): readonly Node[] | undefined {
      const root = transparentExpression(source, initializer);
      return root === undefined ? undefined : sealedReads.get(root);
    },
  });
}

function collectBindings(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): readonly ObjectBinding[] {
  const result: ObjectBinding[] = [];
  for (const declaration of program.nodesOfKind(KindVariableDeclaration)) {
    const initializer = transparentExpression(
      source,
      source.ast.as.AsVariableDeclaration(declaration)?.Initializer,
    );
    if (
      !source.ast.is.IsIdentifier(source.ast.name(declaration)) ||
      declarationIsExported(source, declaration) ||
      initializer === undefined ||
      program.hasBindingWrite(declaration)
    ) {
      continue;
    }
    const properties = collectAlternativeProperties(source, initializer);
    if (properties !== undefined) {
      result.push({ declaration, container: initializer, properties, closed: true });
    }
  }
  return Object.freeze(result);
}

function collectProperties(
  source: TargetSourceProgram,
  container: Node,
): readonly ObjectPropertySource[] | undefined {
  const result: ObjectPropertySource[] = [];
  for (const property of source.ast.properties(container)) {
    if (property === undefined || source.ast.is.IsSpreadAssignment(property)) {
      return undefined;
    }
    const initializer = propertyInitializer(source, property);
    const evidence = source.semantics.forNode(property)
      .getResolvedObjectLiteralElementInfo(property);
    if (
      initializer === undefined ||
      evidence === undefined ||
      evidence.objectLiteral !== container ||
      evidence.element !== property ||
      evidence.sourceElementSymbol === undefined
    ) {
      return undefined;
    }
    result.push({
      declaration: property,
      initializers: Object.freeze([initializer]),
      container,
      symbols: new Set([
        evidence.sourceElementSymbol,
        ...(evidence.sourceSelectedSymbol === undefined
          ? []
          : [evidence.sourceSelectedSymbol]),
      ]),
      declarations: new Set([
        property,
        ...evidence.sourceSelectedDeclarations,
      ]),
      reads: [],
    });
  }
  return Object.freeze(result);
}

function collectAlternativeProperties(
  source: TargetSourceProgram,
  expression: Node,
): readonly ObjectPropertySource[] | undefined {
  const containers = exactObjectAlternatives(source, expression);
  if (containers === undefined || containers.length === 0) {
    return undefined;
  }
  let result = collectProperties(source, containers[0]!);
  if (result === undefined) {
    return undefined;
  }
  for (const container of containers.slice(1)) {
    const next = collectProperties(source, container);
    if (next === undefined || next.length !== result.length) {
      return undefined;
    }
    const consumed = new Set<ObjectPropertySource>();
    const merged: ObjectPropertySource[] = [];
    for (const property of result) {
      const matches = next.filter((candidate) =>
        !consumed.has(candidate) && propertySourcesOverlap(property, candidate)
      );
      if (matches.length !== 1) {
        return undefined;
      }
      const selected = matches[0]!;
      consumed.add(selected);
      merged.push({
        declaration: property.declaration,
        initializers: Object.freeze([
          ...property.initializers,
          ...selected.initializers,
        ]),
        container: expression,
        symbols: new Set([...property.symbols, ...selected.symbols]),
        declarations: new Set([
          ...property.declarations,
          ...selected.declarations,
        ]),
        reads: [],
      });
    }
    result = Object.freeze(merged);
  }
  return result;
}

function exactObjectAlternatives(
  source: TargetSourceProgram,
  expression: Node,
  seen: ReadonlySet<Node> = new Set(),
): readonly Node[] | undefined {
  const root = transparentExpression(source, expression);
  if (root === undefined || seen.has(root)) {
    return undefined;
  }
  if (source.ast.is.IsObjectLiteralExpression(root)) {
    return Object.freeze([root]);
  }
  const alternatives = sameValueAlternatives(source, root);
  if (alternatives === undefined || alternatives === null) {
    return undefined;
  }
  const nextSeen = new Set([...seen, root]);
  const result: Node[] = [];
  for (const alternative of alternatives) {
    const selected = exactObjectAlternatives(source, alternative, nextSeen);
    if (selected === undefined) {
      return undefined;
    }
    result.push(...selected);
  }
  return Object.freeze([...new Set(result)]);
}

function propertySourcesOverlap(
  left: ObjectPropertySource,
  right: ObjectPropertySource,
): boolean {
  return [...left.symbols].some((symbol) => right.symbols.has(symbol)) ||
    [...left.declarations].some((declaration) =>
      right.declarations.has(declaration)
    );
}

function propertyInitializer(
  source: TargetSourceProgram,
  property: Node,
): Node | undefined {
  if (source.ast.is.IsPropertyAssignment(property)) {
    return source.ast.as.AsPropertyAssignment(property)?.Initializer;
  }
  if (source.ast.is.IsShorthandPropertyAssignment(property)) {
    return source.ast.name(property);
  }
  return source.ast.is.IsMethodDeclaration(property) ? property : undefined;
}

function auditBinding(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  binding: ObjectBinding,
): void {
  for (const reference of program.referencesToDeclaration(binding.declaration)) {
    if (isModuleForwardingReference(source, reference)) {
      binding.closed = false;
      continue;
    }
    const access = containingPropertyRead(source, reference);
    const matches = access === undefined
      ? []
      : binding.properties.filter((property) =>
        propertyMatchesAccess(source, property, access)
      );
    const property = matches.length === 1 ? matches[0] : undefined;
    if (property === undefined || access === undefined) {
      binding.closed = false;
    } else {
      property.reads.push(access);
    }
  }
}

function containingPropertyRead(
  source: TargetSourceProgram,
  reference: Node,
): Node | undefined {
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return undefined;
    }
    if (transparentExpression(source, parent) === current) {
      current = parent;
      continue;
    }
    if (source.ast.is.IsPropertyAccessExpression(parent)) {
      const access = source.ast.as.AsPropertyAccessExpression(parent);
      const selected = source.semantics.forNode(parent)
        .getResolvedPropertyAccessInfo(parent);
      return access?.Expression === current && selected?.accessMode === "read" &&
          !selected.optionalChain
        ? parent
        : undefined;
    }
    if (source.ast.is.IsElementAccessExpression(parent)) {
      const access = source.ast.as.AsElementAccessExpression(parent);
      const selected = source.semantics.forNode(parent)
        .getResolvedElementAccessInfo(parent);
      return access?.Expression === current && selected?.accessMode === "read" &&
          !selected.optionalChain
        ? parent
        : undefined;
    }
    return undefined;
  }
}

function propertyMatchesAccess(
  source: TargetSourceProgram,
  property: ObjectPropertySource,
  expression: Node,
): boolean {
  if (source.ast.is.IsPropertyAccessExpression(expression)) {
    const selected = source.semantics.forNode(expression)
      .getResolvedPropertyAccessInfo(expression);
    return selected !== undefined &&
      (
        selected.selectedSymbol !== undefined &&
          property.symbols.has(selected.selectedSymbol) ||
        selected.selectedDeclaration !== undefined &&
          property.declarations.has(selected.selectedDeclaration)
      );
  }
  if (!source.ast.is.IsElementAccessExpression(expression)) {
    return false;
  }
  const selected = source.semantics.forNode(expression)
    .getResolvedElementAccessInfo(expression);
  return selected !== undefined &&
    (
      selected.selectedSymbol !== undefined &&
        property.symbols.has(selected.selectedSymbol) ||
      selected.selectedDeclaration !== undefined &&
        property.declarations.has(selected.selectedDeclaration)
    );
}
