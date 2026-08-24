import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  KindElementAccessExpression,
  KindPropertyAccessExpression,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../../program-index.js";
import type { TypeScriptPlanningObserver } from "../../../../planning-observer.js";
import { resolveExactSourceInvocation } from "../../../model/exact-source-invocation.js";
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
import type { StorageOwnerBoundaryDependencies } from "../../storage/owner-boundaries.js";
import {
  type ExactSourceBodyInspection,
  sourceBodyInspectionIsExact,
} from "../../../model/source-membership.js";
import {
  collectOpaqueStructuralCallEscapes,
  opaqueCallDoesNotObserveValueSlots,
} from "./structural-boundaries.js";
import type { ExactOpaqueValueSlotTransport } from "./opaque-transport.js";

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
  opaqueCallDoesNotObserveSlots(reference: Node): boolean;
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
  planningObserver?: TypeScriptPlanningObserver,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
  opaqueTransport?: ExactOpaqueValueSlotTransport,
): ExactStructuralSlotWriteIndex {
  const openDeclarations = collectOpaqueStructuralCallEscapes(
    source,
    program,
    exactCallImplementations,
    boundaryDependencies,
    bodyInspectionIsCertified,
  );
  planningObserver?.("effect-value-slot-structural-escapes", {
    declarations: openDeclarations.size,
  });
  const mutations = new Map<Node, ExactStorageMutation[]>();
  for (const node of program.nodesOfKinds([
    KindPropertyAccessExpression,
    KindElementAccessExpression,
  ])) {
    const access = selectedStructuralAccess(
      source,
      node,
      bodyInspectionIsCertified,
    );
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
          exactCallImplementations,
          bodyInspectionIsCertified,
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
  planningObserver?.("effect-value-slot-structural-mutations", {
    declarations: mutations.size,
    values: [...mutations.values()].reduce(
      (total, entries) => total + entries.length,
      0,
    ),
  });
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
        closed: structuralPathIsClosed(
          source,
          path,
          openDeclarations,
          bodyInspectionIsCertified,
        ),
        inputs: Object.freeze(inputs),
      });
    },
    pathCanBeTracked(path: ExactValueSlotPath): boolean {
      return path.some((selector) =>
        selector.kind === "property" &&
        exactStructuralDeclarations(
          source,
          selector,
          bodyInspectionIsCertified,
        ).length === 1
      );
    },
    pathIsClosed(path: ExactValueSlotPath): boolean {
      return structuralPathIsClosed(
        source,
        path,
        openDeclarations,
        bodyInspectionIsCertified,
      );
    },
    opaqueCallDoesNotObserveSlots(reference: Node): boolean {
      return opaqueCallDoesNotObserveValueSlots(
        source,
        reference,
        exactCallImplementations,
        opaqueTransport,
        bodyInspectionIsCertified,
      );
    },
  });
}

function selectedStructuralAccess(
  source: TargetSourceProgram,
  node: Node,
  bodyInspectionIsCertified: ExactSourceBodyInspection | undefined,
): {
  readonly accessMode: string;
  readonly receiver: Node;
  readonly declarations: readonly Node[];
} | undefined {
  const propertyAccess = source.ast.is.IsPropertyAccessExpression(node);
  const elementAccess = source.ast.is.IsElementAccessExpression(node);
  if (!propertyAccess && !elementAccess) {
    return undefined;
  }
  const semantics = source.semantics.forNode(node);
  const access = propertyAccess
    ? semantics.operations.propertyAccess(node)
    : elementAccess
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
      sourceBodyInspectionIsExact(
        source,
        declaration,
        bodyInspectionIsCertified,
      ) &&
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
  exactCallImplementations: ExactCallImplementations | undefined,
  bodyInspectionIsCertified: ExactSourceBodyInspection | undefined,
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
    const declarations = exactStructuralDeclarations(
      source,
      read.selector,
      bodyInspectionIsCertified,
    );
    if (declarations.length !== 1) {
      return undefined;
    }
    const parent = exactStoragePathForExpression(
      source,
      program,
      closedStorageOwners,
      read.receiver,
      pending,
      exactCallImplementations,
      bodyInspectionIsCertified,
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
          exactCallImplementations,
          bodyInspectionIsCertified,
        )
      ),
    );
  }
  if (source.ast.is.IsCallExpression(root)) {
    const direct = resolveExactSourceInvocation(
      source,
      root,
      bodyInspectionIsCertified,
    )?.implementation;
    const implementations = direct === undefined
      ? exactCallImplementations?.(root) ?? []
      : [direct];
    const returned = implementations.flatMap((implementation) => {
      if (!sourceBodyInspectionIsExact(
        source,
        implementation,
        bodyInspectionIsCertified,
      )) {
        return [undefined];
      }
      return exactCallableReturnExpressions(source, implementation) ?? [undefined];
    });
    return implementations.length === 0 ||
        returned.some((value) => value === undefined)
      ? undefined
      : commonStoragePath(returned.map((value) =>
          exactStoragePathForExpression(
            source,
            program,
            closedStorageOwners,
            value!,
            pending,
            exactCallImplementations,
            bodyInspectionIsCertified,
          )
        ));
  }
  if (!source.ast.is.IsIdentifier(root)) {
    return undefined;
  }
  const reference = source.navigation.sourceReferenceFor(root);
  const declaration = reference !== undefined &&
      sourceBodyInspectionIsExact(
        source,
        reference.declaration,
        bodyInspectionIsCertified,
      )
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
          exactCallImplementations,
          bodyInspectionIsCertified,
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
  bodyInspectionIsCertified: ExactSourceBodyInspection | undefined,
): readonly Node[] {
  return [...selector.declarations].filter((declaration) =>
    sourceBodyInspectionIsExact(
      source,
      declaration,
      bodyInspectionIsCertified,
    ) &&
    source.ast.is.IsPropertySignatureDeclaration(declaration)
  );
}

function structuralPathIsClosed(
  source: TargetSourceProgram,
  path: ExactValueSlotPath,
  openDeclarations: ReadonlySet<Node>,
  bodyInspectionIsCertified: ExactSourceBodyInspection | undefined,
): boolean {
  for (const selector of path) {
    if (selector.kind !== "property") {
      continue;
    }
    const declarations = exactStructuralDeclarations(
      source,
      selector,
      bodyInspectionIsCertified,
    );
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
