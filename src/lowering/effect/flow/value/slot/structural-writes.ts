import type { Node, Symbol, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  KindCallExpression,
  KindNewExpression,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../../program-index.js";
import { resolveProjectInvocation } from "../../../model/project-invocation.js";
import { transparentExpression } from "../../../model/syntax.js";
import { exactCallableReturnExpressions } from "../../invocation/results.js";
import { sameValueAlternatives } from "../alternatives.js";
import type {
  ExactValueSlotPath,
  ExactValueSlotSelector,
} from "./model.js";
import { exactValueSlotRead } from "./selectors.js";
import { exactClosedStorageSlotOwner } from "./storage.js";
import type { ExactTrackedValueSlotInput } from "./tracked.js";
import type { ExactCallImplementations } from "../../callable/result-inputs.js";
import {
  storageInvocationHasProjectImplementation,
  type StorageOwnerBoundaryDependencies,
} from "../../storage/owner-boundaries.js";

export interface ExactStructuralStorageMutations {
  readonly closed: boolean;
  readonly inputs: readonly ExactTrackedValueSlotInput[];
}

export interface ExactStructuralSlotWriteIndex {
  mutationsFor(
    storageDeclaration: Node,
    path: ExactValueSlotPath,
  ): ExactStructuralStorageMutations;
  pathCanBeTracked(path: ExactValueSlotPath): boolean;
  pathIsClosed(path: ExactValueSlotPath): boolean;
}

interface ExactStoragePath {
  readonly declaration: Node;
  readonly path: readonly Node[];
}

interface ExactStorageMutation extends ExactStoragePath {
  readonly input: Node;
}

export function createExactStructuralSlotWriteIndex(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  closedStorageOwners: ReadonlySet<Node>,
  exactCallImplementations?: ExactCallImplementations,
  boundaryDependencies?: StorageOwnerBoundaryDependencies,
): ExactStructuralSlotWriteIndex {
  const openDeclarations = collectOpaqueCallEscapes(
    source,
    program,
    exactCallImplementations,
    boundaryDependencies,
  );
  const mutations = new Map<Node, ExactStorageMutation[]>();
  for (const node of program.nodes) {
    const access = selectedStructuralAccess(source, node);
    if (access === undefined || access.accessMode === "read") {
      continue;
    }
    if (access.declarations.length !== 1) {
      for (const declaration of access.declarations) {
        openDeclarations.add(declaration);
      }
      continue;
    }
    const declaration = access.declarations[0]!;
    const input = access.accessMode === "write"
      ? exactAssignedValue(source, node)
      : undefined;
    const storage = input === undefined
      ? undefined
      : exactStoragePathForExpression(
          source,
          program,
          closedStorageOwners,
          access.receiver,
          new Set(),
        );
    if (input === undefined || storage === undefined) {
      openDeclarations.add(declaration);
      continue;
    }
    const selected = mutations.get(storage.declaration);
    const mutation = Object.freeze({
      declaration: storage.declaration,
      path: Object.freeze([...storage.path, declaration]),
      input,
    });
    if (selected === undefined) {
      mutations.set(storage.declaration, [mutation]);
    } else {
      selected.push(mutation);
    }
  }
  return Object.freeze({
    mutationsFor(
      storageDeclaration: Node,
      path: ExactValueSlotPath,
    ): ExactStructuralStorageMutations {
      const inputs = (mutations.get(storageDeclaration) ?? [])
        .filter((mutation) => mutationPathIsPrefix(mutation.path, path))
        .map((mutation) => Object.freeze({
          expression: mutation.input,
          path: Object.freeze(path.slice(mutation.path.length)),
        }));
      return Object.freeze({
        closed: structuralPathIsClosed(source, path, openDeclarations),
        inputs: Object.freeze(inputs),
      });
    },
    pathCanBeTracked(path: ExactValueSlotPath): boolean {
      return path.some((selector) =>
        selector.kind === "property" &&
        exactStructuralDeclarations(source, selector).length === 1
      );
    },
    pathIsClosed(path: ExactValueSlotPath): boolean {
      return structuralPathIsClosed(source, path, openDeclarations);
    },
  });
}

function selectedStructuralAccess(
  source: TargetSourceProgram,
  node: Node,
): {
  readonly accessMode: string;
  readonly receiver: Node;
  readonly declarations: readonly Node[];
} | undefined {
  const semantics = source.semantics.forNode(node);
  const access = source.ast.is.IsPropertyAccessExpression(node)
    ? semantics.operations.propertyAccess(node)
    : source.ast.is.IsElementAccessExpression(node)
    ? semantics.operations.elementAccess(node)
    : undefined;
  if (access === undefined) {
    return undefined;
  }
  const declarations = new Set<Node>();
  for (const declaration of [
    access.sourceDeclaration,
    access.selectedDeclaration,
  ]) {
    if (
      declaration !== undefined &&
      source.navigation.isProjectDeclaration(declaration) &&
      source.ast.is.IsPropertySignatureDeclaration(declaration)
    ) {
      declarations.add(declaration);
    }
  }
  return declarations.size === 0
    ? undefined
    : Object.freeze({
        accessMode: access.accessMode,
        receiver: access.receiver.expression,
        declarations: Object.freeze([...declarations]),
      });
}

function exactStoragePathForExpression(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  closedStorageOwners: ReadonlySet<Node>,
  expression: Node,
  seen: Set<Node>,
): ExactStoragePath | undefined {
  const root = transparentExpression(source, expression) ?? expression;
  if (seen.has(root)) {
    return undefined;
  }
  const pending = new Set(seen);
  pending.add(root);
  const read = exactValueSlotRead(source, root);
  if (read?.selector.kind === "property") {
    const storageDeclarations = [...read.selector.declarations].filter(
      (declaration) =>
        exactClosedStorageSlotOwner(
          source,
          declaration,
          closedStorageOwners,
        ) !== undefined,
    );
    if (storageDeclarations.length === 1) {
      return Object.freeze({
        declaration: storageDeclarations[0]!,
        path: Object.freeze([]),
      });
    }
    const declarations = exactStructuralDeclarations(source, read.selector);
    if (declarations.length !== 1) {
      return undefined;
    }
    const parent = exactStoragePathForExpression(
      source,
      program,
      closedStorageOwners,
      read.receiver,
      pending,
    );
    return parent === undefined
      ? undefined
      : Object.freeze({
          declaration: parent.declaration,
          path: Object.freeze([...parent.path, declarations[0]!]),
        });
  }
  const alternatives = sameValueAlternatives(source, root);
  if (alternatives === null) {
    return undefined;
  }
  if (alternatives !== undefined) {
    return commonStoragePath(
      alternatives.map((alternative) =>
        exactStoragePathForExpression(
          source,
          program,
          closedStorageOwners,
          alternative,
          pending,
        )
      ),
    );
  }
  if (source.ast.is.IsCallExpression(root)) {
    const implementation = resolveProjectInvocation(source, root)?.implementation;
    const returned = implementation === undefined
      ? undefined
      : exactCallableReturnExpressions(source, implementation);
    return returned === undefined || returned.some((value) => value === undefined)
      ? undefined
      : commonStoragePath(returned.map((value) =>
          exactStoragePathForExpression(
            source,
            program,
            closedStorageOwners,
            value!,
            pending,
          )
        ));
  }
  if (!source.ast.is.IsIdentifier(root)) {
    return undefined;
  }
  const reference = source.navigation.sourceReferenceFor(root);
  const declaration = reference?.project === true
    ? reference.declaration
    : undefined;
  if (
    declaration !== undefined &&
    source.ast.is.IsVariableDeclaration(declaration) &&
    !program.hasBindingWrite(declaration)
  ) {
    const initializer = source.ast.as.AsVariableDeclaration(declaration)
      ?.Initializer;
    return initializer === undefined
      ? undefined
      : exactStoragePathForExpression(
          source,
          program,
          closedStorageOwners,
          initializer,
          pending,
        );
  }
  return undefined;
}

function commonStoragePath(
  paths: readonly (ExactStoragePath | undefined)[],
): ExactStoragePath | undefined {
  if (paths.length === 0 || paths.some((path) => path === undefined)) {
    return undefined;
  }
  const selected = paths[0]!;
  return paths.every((path) =>
      path?.declaration === selected.declaration &&
      path.path.length === selected.path.length &&
      path.path.every((declaration, index) => declaration === selected.path[index])
    )
    ? selected
    : undefined;
}

function exactStructuralDeclarations(
  source: TargetSourceProgram,
  selector: Extract<ExactValueSlotSelector, { readonly kind: "property" }>,
): readonly Node[] {
  return [...selector.declarations].filter((declaration) =>
    source.navigation.isProjectDeclaration(declaration) &&
    source.ast.is.IsPropertySignatureDeclaration(declaration)
  );
}

function structuralPathIsClosed(
  source: TargetSourceProgram,
  path: ExactValueSlotPath,
  openDeclarations: ReadonlySet<Node>,
): boolean {
  for (const selector of path) {
    if (selector.kind !== "property") {
      continue;
    }
    const declarations = exactStructuralDeclarations(source, selector);
    if (declarations.length > 1) {
      return false;
    }
    if (declarations[0] !== undefined && openDeclarations.has(declarations[0])) {
      return false;
    }
  }
  return true;
}

function mutationPathIsPrefix(
  mutation: readonly Node[],
  selected: ExactValueSlotPath,
): boolean {
  return mutation.length <= selected.length && mutation.every(
    (declaration, index) => {
      const selector = selected[index];
      return selector?.kind === "property" &&
        selector.declarations.has(declaration);
    },
  );
}

function exactAssignedValue(
  source: TargetSourceProgram,
  reference: Node,
): Node | undefined {
  const parent = source.ast.parent(reference);
  if (
    parent === undefined ||
    !source.ast.is.IsBinaryExpression(parent) ||
    source.ast.operatorKindName(parent) !== "KindEqualsToken"
  ) {
    return undefined;
  }
  const assignment = source.ast.as.AsBinaryExpression(parent);
  return assignment?.Left === reference ? assignment.Right : undefined;
}

function collectOpaqueCallEscapes(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  exactCallImplementations: ExactCallImplementations | undefined,
  boundaryDependencies: StorageOwnerBoundaryDependencies | undefined,
): Set<Node> {
  const escaped = new Set<Node>();
  for (const call of program.nodesOfKinds([
    KindCallExpression,
    KindNewExpression,
  ])) {
    if (storageInvocationHasProjectImplementation(
      source,
      call,
      exactCallImplementations,
      boundaryDependencies,
    )) {
      continue;
    }
    const semantics = source.semantics.forNode(call);
    const selectedCall = semantics.operations.call(call);
    const receiver = selectedCall?.sourceReceiver;
    if (receiver !== undefined) {
      collectPropertySignatures(
        source,
        semantics,
        receiver.type,
        escaped,
        new Set(),
      );
    }
    for (const [sourceArgumentIndex, argument] of (
      selectedCall?.sourceArguments ?? []
    ).entries()) {
      const targets = new Set(
        selectedCall?.sourceArgumentBindings.filter((binding) =>
          binding.sourceArgumentIndex === sourceArgumentIndex
        ).map((binding) => binding.selectedParameterType) ?? [],
      );
      if (targets.size === 0) {
        collectPropertySignatures(
          source,
          semantics,
          argument.type,
          escaped,
          new Set(),
        );
        continue;
      }
      for (const target of targets) {
        collectWritablePropertySignatures(
          source,
          semantics,
          argument.type,
          target,
          escaped,
          new Map(),
        );
      }
    }
  }
  return escaped;
}

function collectWritablePropertySignatures(
  source: TargetSourceProgram,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forNode"]>,
  sourceType: Type,
  targetType: Type,
  result: Set<Node>,
  seen: Map<Type, Set<Type>>,
): void {
  let targets = seen.get(sourceType);
  if (targets?.has(targetType) === true) {
    return;
  }
  if (targets === undefined) {
    targets = new Set();
    seen.set(sourceType, targets);
  }
  targets.add(targetType);
  if (semantics.types.isAny(targetType) || semantics.types.isUnknown(targetType)) {
    collectPropertySignatures(source, semantics, sourceType, result, new Set());
    return;
  }
  const sourceProperties = new Map(
    semantics.types.propertyInfos(sourceType).map((property) => [
      property.name,
      property,
    ]),
  );
  for (const targetProperty of semantics.types.propertyInfos(targetType)) {
    const sourceProperty = sourceProperties.get(targetProperty.name);
    if (sourceProperty === undefined) {
      continue;
    }
    if (!targetProperty.readonly) {
      addPropertySignatureDeclarations(
        source,
        semantics,
        sourceProperty.symbol,
        result,
      );
    }
    collectWritablePropertySignatures(
      source,
      semantics,
      sourceProperty.type,
      targetProperty.type,
      result,
      seen,
    );
  }
}

function addPropertySignatureDeclarations(
  source: TargetSourceProgram,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forNode"]>,
  symbol: Symbol,
  result: Set<Node>,
): void {
  for (const declaration of semantics.declarations.symbolDeclarations(symbol)) {
    if (
      declaration !== undefined &&
      source.navigation.isProjectDeclaration(declaration) &&
      source.ast.is.IsPropertySignatureDeclaration(declaration)
    ) {
      result.add(declaration);
    }
  }
}

function collectPropertySignatures(
  source: TargetSourceProgram,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forNode"]>,
  type: Type,
  result: Set<Node>,
  pending: Set<Type>,
): void {
  if (pending.has(type)) {
    return;
  }
  pending.add(type);
  for (const property of semantics.types.propertyInfos(type)) {
    let projectSlot = false;
    for (const declaration of semantics.declarations.symbolDeclarations(
      property.symbol,
    )) {
      if (
        declaration !== undefined &&
        source.navigation.isProjectDeclaration(declaration) &&
        source.ast.is.IsPropertySignatureDeclaration(declaration)
      ) {
        result.add(declaration);
        projectSlot = true;
      }
    }
    if (projectSlot) {
      collectPropertySignatures(source, semantics, property.type, result, pending);
    }
  }
  for (const member of [
    ...(semantics.types.isUnion(type) || semantics.types.isIntersection(type)
      ? semantics.types.unionOrIntersectionTypes(type)
      : []),
    ...(semantics.types.isTypeReference(type)
      ? semantics.types.typeArguments(type)
      : []),
    ...semantics.types.indexInfos(type).map((index) => index.valueType),
  ]) {
    if (member !== undefined) {
      collectPropertySignatures(source, semantics, member, result, pending);
    }
  }
  pending.delete(type);
}
