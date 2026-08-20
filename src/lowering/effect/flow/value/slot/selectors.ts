import type { Node, Symbol, Type, TypePropertyInfo } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api";

import { exactObjectIdentity } from "../../../provenance/identity.js";
import { transparentExpression } from "../../../model/syntax.js";
import { exactAggregateRead } from "../../aggregate/projection.js";
import { exactCallableReturnExpressions } from "../../invocation/results.js";
import type { ExactValueBindingProjectionStep } from "../binding-projection.js";
import type {
  ExactValueSlotPath,
  ExactValueSlotSelector,
} from "./model.js";

export type ExactValueSlotContributor =
  | { readonly kind: "value"; readonly expression: Node }
  | {
      readonly kind: "container";
      readonly expression: Node;
      readonly selector: Extract<
        ExactValueSlotSelector,
        { readonly kind: "property" }
      >;
    };

export function exactValueSlotRead(
  source: TargetSourceProgram,
  expression: Node,
): {
  readonly receiver: Node;
  readonly selector: ExactValueSlotSelector;
} | undefined {
  const aggregate = exactAggregateRead(source, expression);
  if (aggregate !== undefined) {
    return Object.freeze({
      receiver: aggregate.receiver,
      selector: Object.freeze({
        kind: "element" as const,
        index: aggregate.index,
      }),
    });
  }
  const semantics = source.semantics.forNode(expression);
  const info = source.ast.is.IsPropertyAccessExpression(expression)
    ? semantics.getResolvedPropertyAccessInfo(expression)
    : source.ast.is.IsElementAccessExpression(expression)
    ? semantics.getResolvedElementAccessInfo(expression)
    : undefined;
  if (
    info === undefined || info.accessMode !== "read" || info.optionalChain
  ) {
    return undefined;
  }
  const symbols = new Set<Symbol>();
  const declarations = new Set<Node>();
  const names = new Set<string>();
  addSymbolIdentity(semantics, info.sourceSymbol, symbols, declarations, names);
  addSymbolIdentity(semantics, info.selectedSymbol, symbols, declarations, names);
  if (info.sourceDeclaration !== undefined) {
    declarations.add(info.sourceDeclaration);
  }
  if (info.selectedDeclaration !== undefined) {
    declarations.add(info.selectedDeclaration);
  }
  return symbols.size === 0 && declarations.size === 0
    ? undefined
    : Object.freeze({
        receiver: info.receiver.expression,
        selector: Object.freeze({
          kind: "property" as const,
          symbols,
          declarations,
          names,
        }),
      });
}

export function exactBindingSlotPath(
  source: TargetSourceProgram,
  steps: readonly ExactValueBindingProjectionStep[],
): ExactValueSlotPath | undefined {
  const result: ExactValueSlotSelector[] = [];
  for (const step of steps) {
    if (step.kind === "element") {
      result.push(Object.freeze({ kind: "element", index: step.index }));
      continue;
    }
    const semantics = source.semantics.forNode(step.name);
    const symbols = new Set<Symbol>();
    const declarations = new Set<Node>([step.declaration]);
    const names = new Set<string>();
    addSymbolIdentity(
      semantics,
      semantics.getSymbolAtLocation(step.name),
      symbols,
      declarations,
      names,
    );
    addSymbolIdentity(
      semantics,
      semantics.getResolvedSymbol(step.name),
      symbols,
      declarations,
      names,
    );
    if (symbols.size === 0 && declarations.size === 1) {
      return undefined;
    }
    result.push(Object.freeze({
      kind: "property",
      symbols,
      declarations,
      names,
    }));
  }
  return result.length === 0 ? undefined : Object.freeze(result);
}

export function exactValueSlotPathKey(path: ExactValueSlotPath): string {
  return path.map((selector) => {
    if (selector.kind === "element") {
      return `e${selector.index}`;
    }
    const symbols = [...selector.symbols]
      .map((symbol) => exactObjectIdentity(symbol as object))
      .sort((left, right) => left - right);
    const declarations = [...selector.declarations]
      .map((declaration) => exactObjectIdentity(declaration as object))
      .sort((left, right) => left - right);
    const names = [...selector.names].sort().map((name) =>
      `${name.length}:${name}`
    ).join("");
    return `s${symbols.join(",")}d${declarations.join(",")}n${names}`;
  }).join("/");
}

export function exactValueSlotPathIsReadonly(
  source: TargetSourceProgram,
  expression: Node,
  path: ExactValueSlotPath,
): boolean {
  const semantics = source.semantics.forNode(expression);
  const type = semantics.getTypeAtLocation(expression);
  return type !== undefined && path.length !== 0 && readonlyTypePath(
    semantics,
    type,
    path,
    0,
  );
}

function readonlyTypePath(
  semantics: SourceFileSemantics,
  type: Type,
  path: ExactValueSlotPath,
  offset: number,
): boolean {
  const selected = semantics.removeMissingOrUndefined(type);
  const selector = path[offset];
  if (selected === undefined || selector === undefined) {
    return false;
  }
  if (semantics.isUnion(selected) || semantics.isIntersection(selected)) {
    const members = semantics.getUnionOrIntersectionTypes(selected).filter(
      (member): member is Type => member !== undefined,
    );
    return members.length !== 0 && members.every((member) =>
      readonlyTypePath(semantics, member, path, offset)
    );
  }
  if (selector.kind === "property") {
    const properties = semantics.getPropertyInfos(selected).filter((property) =>
      propertyMatchesSelector(semantics, property, selector)
    );
    if (properties.length !== 0) {
      return properties.every((property) =>
        property.readonly && (
          offset + 1 === path.length ||
          readonlyTypePath(semantics, property.type, path, offset + 1)
        )
      );
    }
    const indexes = semantics.getIndexInfos(selected);
    return indexes.length !== 0 && indexes.every((index) =>
      index.readonly && index.valueType !== undefined && (
        offset + 1 === path.length ||
        readonlyTypePath(semantics, index.valueType, path, offset + 1)
      )
    );
  }
  const values = semantics.isTuple(selected)
    ? [semantics.getTupleElementInfos(selected)[selector.index]?.type]
    : semantics.getIndexInfos(selected).map((index) => index.valueType);
  const indexes = semantics.getIndexInfos(selected);
  return indexes.length !== 0 && indexes.every((index) => index.readonly) &&
    values.length !== 0 && values.every((value) =>
      value !== undefined && (
        offset + 1 === path.length ||
        readonlyTypePath(semantics, value, path, offset + 1)
      )
    );
}

function propertyMatchesSelector(
  semantics: SourceFileSemantics,
  property: TypePropertyInfo,
  selector: Extract<ExactValueSlotSelector, { readonly kind: "property" }>,
): boolean {
  if (
    selector.symbols.has(property.symbol) ||
    property.rootSymbols.some((symbol) => selector.symbols.has(symbol)) ||
    selector.names.has(property.name)
  ) {
    return true;
  }
  return semantics.getSymbolDeclarations(property.symbol).some(
    (declaration) =>
      declaration !== undefined && selector.declarations.has(declaration),
  );
}

export function exactObjectSlotContributors(
  source: TargetSourceProgram,
  object: Node,
  selector: Extract<ExactValueSlotSelector, { readonly kind: "property" }>,
): readonly ExactValueSlotContributor[] | null {
  let contributors: ExactValueSlotContributor[] = [];
  for (const property of source.ast.properties(object)) {
    if (property === undefined) {
      return null;
    }
    if (source.ast.is.IsSpreadAssignment(property)) {
      const spread = source.ast.as.AsSpreadAssignment(property)?.Expression;
      const spreadSelector = spread === undefined
        ? undefined
        : exactSpreadPropertySelector(source, spread, selector);
      if (spread === undefined || spreadSelector === undefined) {
        return null;
      }
      if (spreadSelector !== null) {
        contributors.push({
          kind: "container",
          expression: spread,
          selector: spreadSelector,
        });
      }
      continue;
    }
    const semantics = source.semantics.forNode(property);
    const evidence = semantics.getResolvedObjectLiteralElementInfo(property);
    if (evidence?.objectLiteral !== object) {
      return null;
    }
    const symbols = new Set<Symbol>();
    const declarations = new Set<Node>([
      property,
      ...evidence.sourceSelectedDeclarations,
    ]);
    const names = new Set<string>();
    if (evidence.sourceSelectedDeclaration !== undefined) {
      declarations.add(evidence.sourceSelectedDeclaration);
    }
    addSymbolIdentity(
      semantics,
      evidence.sourceElementSymbol,
      symbols,
      declarations,
      names,
    );
    addSymbolIdentity(
      semantics,
      evidence.sourceSelectedSymbol,
      symbols,
      declarations,
      names,
    );
    if (!propertyIdentitiesOverlap(selector, {
      symbols,
      declarations,
      names,
    })) {
      continue;
    }
    const values = propertyInitializers(source, property);
    if (values === undefined) {
      return null;
    }
    contributors = values.map((expression) => ({
      kind: "value" as const,
      expression,
    }));
  }
  return Object.freeze(contributors);
}

export function containingExactValueSlotRead(
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
    const selected = exactValueSlotRead(source, parent);
    return selected?.receiver === current ? parent : undefined;
  }
}

export function isExactObjectSpreadContainerReference(
  source: TargetSourceProgram,
  reference: Node,
): boolean {
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return false;
    }
    if (transparentExpression(source, parent) === current) {
      current = parent;
      continue;
    }
    if (!source.ast.is.IsSpreadAssignment(parent)) {
      return false;
    }
    const object = source.ast.parent(parent);
    return source.ast.as.AsSpreadAssignment(parent)?.Expression === current &&
      object !== undefined &&
      source.ast.is.IsObjectLiteralExpression(object) &&
      source.ast.properties(object).includes(parent);
  }
}

function addSymbolIdentity(
  semantics: SourceFileSemantics,
  symbol: Symbol | undefined,
  symbols: Set<Symbol>,
  declarations: Set<Node>,
  names?: Set<string>,
): void {
  if (symbol === undefined) {
    return;
  }
  symbols.add(symbol);
  const name = semantics.getSymbolName(symbol);
  if (name.length !== 0) {
    names?.add(name);
  }
  for (const root of semantics.getRootSymbols(symbol)) {
    if (root !== undefined) {
      symbols.add(root);
    }
  }
  for (const declaration of semantics.getSymbolDeclarations(symbol)) {
    if (declaration !== undefined) {
      declarations.add(declaration);
    }
  }
}

function propertyIdentitiesOverlap(
  selector: Extract<ExactValueSlotSelector, { readonly kind: "property" }>,
  candidate: {
    readonly symbols: ReadonlySet<Symbol>;
    readonly declarations: ReadonlySet<Node>;
    readonly names: ReadonlySet<string>;
  },
): boolean {
  return [...selector.symbols].some((symbol) => candidate.symbols.has(symbol)) ||
    [...selector.declarations].some((declaration) =>
      candidate.declarations.has(declaration)
    ) || [...selector.names].some((name) => candidate.names.has(name));
}

function propertyInitializers(
  source: TargetSourceProgram,
  property: Node,
): readonly Node[] | undefined {
  if (source.ast.is.IsPropertyAssignment(property)) {
    const initializer = source.ast.as.AsPropertyAssignment(property)?.Initializer;
    return initializer === undefined ? undefined : Object.freeze([initializer]);
  }
  if (source.ast.is.IsShorthandPropertyAssignment(property)) {
    const name = source.ast.name(property);
    return name === undefined ? undefined : Object.freeze([name]);
  }
  if (source.ast.is.IsMethodDeclaration(property)) {
    return Object.freeze([property]);
  }
  if (source.ast.is.IsSetAccessorDeclaration(property)) {
    return Object.freeze([]);
  }
  if (source.ast.is.IsGetAccessorDeclaration(property)) {
    const returned = exactCallableReturnExpressions(source, property);
    return returned === undefined || returned.some((value) => value === undefined)
      ? undefined
      : Object.freeze(returned.filter((value): value is Node => value !== undefined));
  }
  return undefined;
}

function exactSpreadPropertySelector(
  source: TargetSourceProgram,
  expression: Node,
  selector: Extract<ExactValueSlotSelector, { readonly kind: "property" }>,
): Extract<
  ExactValueSlotSelector,
  { readonly kind: "property" }
> | null | undefined {
  const semantics = source.semantics.forNode(expression);
  const type = semantics.getTypeAtLocation(expression);
  const name = selector.names.size === 1 ? [...selector.names][0] : undefined;
  if (type === undefined || name === undefined) {
    return undefined;
  }
  const selected = semantics.removeMissingOrUndefined(type);
  if (selected === undefined || semantics.isNever(selected)) {
    return null;
  }
  if (
    semantics.isAny(selected) ||
    semantics.isUnknown(selected)
  ) {
    return undefined;
  }
  const symbol = semantics.getPropertyOfType(selected, name);
  if (symbol === undefined) {
    return semantics.couldContainTypeVariables(selected) ||
        semantics.getIndexInfos(selected).length !== 0
      ? undefined
      : null;
  }
  const symbols = new Set<Symbol>();
  const declarations = new Set<Node>();
  const names = new Set<string>();
  addSymbolIdentity(semantics, symbol, symbols, declarations, names);
  return symbols.size === 0
    ? undefined
    : Object.freeze({
        kind: "property" as const,
        symbols,
        declarations,
        names,
      });
}
