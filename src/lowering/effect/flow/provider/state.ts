import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { KindPropertyAssignment } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import {
  successfulValueExpression,
} from "../../model/syntax.js";
import type {
  ProviderInvocationRecord,
  ProviderInvocationRecords,
} from "./records.js";
import { exactBindingWriteInput } from "../storage/assignment.js";

export interface ProviderStateTransportPlan {
  isClosed(call: Node): boolean;
  resultOriginsFor(call: Node): readonly Node[];
}

interface StateAccess {
  readonly record: ProviderInvocationRecord;
  readonly owner: Node;
}

const noOrigins: readonly Node[] = Object.freeze([]);

export function createProviderStateTransportPlan(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  records: ProviderInvocationRecords,
): ProviderStateTransportPlan {
  const stateRecords = records.all.filter((record) =>
    record.fact.state !== undefined
  );
  if (stateRecords.length === 0) {
    return Object.freeze({
      isClosed(_call: Node): boolean {
        return false;
      },
      resultOriginsFor(_call: Node): readonly Node[] {
        return noOrigins;
      },
    });
  }
  const recognizedReferences = new Set<Node>();
  const initializedOwners = new Set<Node>();
  const aliases = new DisjointOwners();
  for (const record of stateRecords) {
    const state = record.fact.state;
    if (state === undefined || state.kind === "access") {
      continue;
    }
    const sourceOwner = state.carrierParameter === undefined
      ? undefined
      : resolveStateOwner(
          source,
          records,
          record.expressionFor(state.carrierParameter),
          recognizedReferences,
          new Set(),
        );
    const destination = stateResultDestination(
      source,
      record.call,
      recognizedReferences,
    );
    if (destination !== undefined) {
      initializedOwners.add(destination);
      aliases.add(destination);
      if (state.kind === "alias" && sourceOwner !== undefined) {
        aliases.union(destination, sourceOwner);
      }
    }
    if (sourceOwner !== undefined) {
      aliases.add(sourceOwner);
    }
  }

  const accesses: StateAccess[] = [];
  for (const record of stateRecords) {
    const state = record.fact.state;
    if (
      state?.kind !== "access" ||
      state.carrierParameter === undefined
    ) {
      continue;
    }
    const owner = resolveStateOwner(
      source,
      records,
      record.expressionFor(state.carrierParameter),
      recognizedReferences,
      new Set(),
    );
    if (owner !== undefined) {
      aliases.add(owner);
      accesses.push(Object.freeze({ record, owner }));
    }
  }

  const propertyInitializers = collectPropertyInitializers(source, program);
  const owners = new Set(accesses.map((access) => access.owner));
  for (const alias of aliases.membersForAny(owners)) {
    owners.add(alias);
  }
  const invalidRoots = new Set<Node>();
  for (const owner of owners) {
    if (!source.navigation.isProjectDeclaration(owner)) {
      if (!isFreshStateCall(records, owner)) {
        invalidRoots.add(aliases.root(owner));
      }
      continue;
    }
    const initializers = [
      ...declarationInitializers(source, owner),
      ...(propertyInitializers.get(owner) ?? []),
      ...bindingWriteInputs(source, program, owner, recognizedReferences),
    ];
    if (initializers.length === 0 && !initializedOwners.has(owner)) {
      invalidRoots.add(aliases.root(owner));
    }
    if (initializers.some((initializer) =>
      !stateInitializerIsClosed(source, records, initializer)
    )) {
      invalidRoots.add(aliases.root(owner));
    }
    for (const reference of source.navigation.referencesToDeclaration(owner)) {
      if (!recognizedReferences.has(reference)) {
        invalidRoots.add(aliases.root(owner));
        break;
      }
    }
  }

  const writes = new Map<Node, Node[]>();
  for (const access of accesses) {
    const state = access.record.fact.state;
    if (state?.kind !== "access") {
      continue;
    }
    const root = aliases.root(access.owner);
    const selected = writes.get(root) ?? [];
    for (const expression of access.record.expressionsFor(
      state.writeParameters,
    )) {
      if (!selected.includes(expression)) {
        selected.push(expression);
      }
    }
    writes.set(root, selected);
  }
  const closedCalls = new Set<Node>();
  const resultOrigins = new Map<Node, readonly Node[]>();
  for (const access of accesses) {
    const root = aliases.root(access.owner);
    if (invalidRoots.has(root)) {
      continue;
    }
    closedCalls.add(access.record.call);
    if (access.record.fact.state?.read === true) {
      resultOrigins.set(
        access.record.call,
        Object.freeze([...(writes.get(root) ?? [])]),
      );
    }
  }
  return Object.freeze({
    isClosed(call: Node): boolean {
      return closedCalls.has(call);
    },
    resultOriginsFor(call: Node): readonly Node[] {
      return resultOrigins.get(call) ?? noOrigins;
    },
  });
}

function resolveStateOwner(
  source: TargetSourceProgram,
  records: ProviderInvocationRecords,
  expression: Node | undefined,
  recognizedReferences: Set<Node>,
  seen: Set<Node>,
): Node | undefined {
  const selected = successfulValueExpression(source, expression);
  if (selected === undefined || seen.has(selected)) {
    return undefined;
  }
  seen.add(selected);
  if (source.ast.is.IsCallExpression(selected)) {
    const record = records.forCall(selected);
    const state = record?.fact.state;
    if (state?.kind === "alias" && state.carrierParameter !== undefined) {
      return resolveStateOwner(
        source,
        records,
        record?.expressionFor(state.carrierParameter),
        recognizedReferences,
        seen,
      );
    }
    return state?.kind === "create" ? selected : undefined;
  }
  const reference = source.navigation.sourceReferenceFor(selected);
  if (reference?.project !== true) {
    return undefined;
  }
  recognizedReferences.add(selected);
  return reference.declaration;
}

function stateResultDestination(
  source: TargetSourceProgram,
  call: Node,
  recognizedReferences: Set<Node>,
): Node | undefined {
  let current = call;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return undefined;
    }
    if (transparentParent(source, parent, current)) {
      current = parent;
      continue;
    }
    if (
      source.ast.is.IsVariableDeclaration(parent) &&
      source.ast.as.AsVariableDeclaration(parent)?.Initializer === current
    ) {
      return parent;
    }
    if (
      source.ast.is.IsPropertyDeclaration(parent) &&
      source.ast.as.AsPropertyDeclaration(parent)?.Initializer === current
    ) {
      return parent;
    }
    if (
      source.ast.is.IsPropertyAssignment(parent) &&
      source.ast.as.AsPropertyAssignment(parent)?.Initializer === current
    ) {
      return source.semantics.forNode(parent)
        .operations.objectLiteralElement(parent)?.sourceSelectedDeclaration;
    }
    if (
      source.ast.is.IsBinaryExpression(parent) &&
      source.ast.operatorKindName(parent) === "KindEqualsToken"
    ) {
      const binary = source.ast.as.AsBinaryExpression(parent);
      if (binary?.Right !== current || binary.Left === undefined) {
        return undefined;
      }
      const reference = source.navigation.sourceReferenceFor(binary.Left);
      if (reference?.project === true) {
        recognizedReferences.add(binary.Left);
        return reference.declaration;
      }
    }
    return undefined;
  }
}

function declarationInitializers(
  source: TargetSourceProgram,
  declaration: Node,
): readonly Node[] {
  const initializer = source.ast.is.IsVariableDeclaration(declaration)
    ? source.ast.as.AsVariableDeclaration(declaration)?.Initializer
    : source.ast.is.IsPropertyDeclaration(declaration)
    ? source.ast.as.AsPropertyDeclaration(declaration)?.Initializer
    : undefined;
  return initializer === undefined ? [] : [initializer];
}

function collectPropertyInitializers(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ReadonlyMap<Node, readonly Node[]> {
  const pending = new Map<Node, Node[]>();
  for (const node of program.nodesOfKind(KindPropertyAssignment)) {
    const property = source.ast.as.AsPropertyAssignment(node);
    const declaration = source.semantics.forNode(node)
      .operations.objectLiteralElement(node)?.sourceSelectedDeclaration;
    if (property?.Initializer === undefined || declaration === undefined) {
      continue;
    }
    const selected = pending.get(declaration);
    if (selected === undefined) {
      pending.set(declaration, [property.Initializer]);
    } else {
      selected.push(property.Initializer);
    }
  }
  return new Map([...pending].map(([owner, values]) => [
    owner,
    Object.freeze(values),
  ]));
}

function bindingWriteInputs(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  declaration: Node,
  recognizedReferences: Set<Node>,
): readonly Node[] {
  const result: Node[] = [];
  for (const write of program.bindingWritesFor(declaration)) {
    const input = exactBindingWriteInput(source, write);
    if (input === undefined) {
      result.push(write.operation);
      continue;
    }
    recognizedReferences.add(write.reference);
    result.push(input);
  }
  return result;
}

function stateInitializerIsClosed(
  source: TargetSourceProgram,
  records: ProviderInvocationRecords,
  expression: Node,
): boolean {
  const selected = successfulValueExpression(source, expression);
  if (selected === undefined || !source.ast.is.IsCallExpression(selected)) {
    return false;
  }
  const state = records.forCall(selected)?.fact.state;
  return state?.kind === "create" || state?.kind === "alias";
}

function isFreshStateCall(
  records: ProviderInvocationRecords,
  owner: Node,
): boolean {
  return records.forCall(owner)?.fact.state?.kind === "create";
}

function transparentParent(
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

class DisjointOwners {
  readonly #parents = new Map<Node, Node>();

  add(owner: Node): void {
    if (!this.#parents.has(owner)) {
      this.#parents.set(owner, owner);
    }
  }

  root(owner: Node): Node {
    this.add(owner);
    const parent = this.#parents.get(owner)!;
    if (parent === owner) {
      return owner;
    }
    const root = this.root(parent);
    this.#parents.set(owner, root);
    return root;
  }

  union(left: Node, right: Node): void {
    const leftRoot = this.root(left);
    const rightRoot = this.root(right);
    if (leftRoot !== rightRoot) {
      this.#parents.set(rightRoot, leftRoot);
    }
  }

  membersForAny(owners: ReadonlySet<Node>): readonly Node[] {
    const roots = new Set([...owners].map((owner) => this.root(owner)));
    return [...this.#parents.keys()].filter((candidate) =>
      roots.has(this.root(candidate))
    );
  }
}
