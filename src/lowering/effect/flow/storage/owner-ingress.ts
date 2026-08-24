import type { Node, Symbol } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  KindCallExpression,
  KindElementAccessExpression,
  KindIdentifier,
  KindParameter,
  KindPropertyAccessExpression,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import {
  isInvocationTransportInput,
  type InvocationTransportContract,
} from "../../../invocation-transport.js";
import {
  exactSourceCallImplementationInputs,
  exactSourceCallInputsForDeclaration,
} from "../invocation/call-binding.js";
import type { ExactCallImplementations } from "../callable/result-inputs.js";
import type { StorageOwnerBoundaryDependencies } from "./owner-boundaries.js";
import {
  declarationForSymbols,
  indexDeclarationSymbols,
} from "../callable/input-reference.js";
import {
  directContainingCall,
  isModuleForwardingReference,
} from "../../model/syntax.js";
import {
  selectedStorageOwners,
  type StorageOwnerMembership,
} from "./owner-types.js";
import {
  exactSourceCallableImplementation,
  resolveExactSourceInvocation,
} from "../../model/exact-source-invocation.js";
import type { ExactSourceBodyInspection } from "../../model/source-membership.js";

interface OwnerIngress {
  readonly declaration: Node;
  readonly owners: ReadonlySet<Node>;
  readonly parameters: ReadonlySet<Node>;
  open: boolean;
}

export function auditStorageOwnerIngress(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  ownersFor: (node: Node) => StorageOwnerMembership,
  selectedOwners: ReadonlySet<Node>,
  invalid: Set<Node>,
  transports?: InvocationTransportContract,
  exactCallImplementations?: ExactCallImplementations,
  callableReferenceIsClosed?: (reference: Node) => boolean,
  boundaryDependencies?: StorageOwnerBoundaryDependencies,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
): void {
  const ingress = collectOwnerIngress(
    source,
    program,
    ownersFor,
    selectedOwners,
    bodyInspectionIsCertified,
  );
  if (ingress.size === 0) {
    return;
  }
  auditExactInvocations(
    source,
    program,
    ingress,
    exactCallImplementations,
    bodyInspectionIsCertified,
  );
  auditCallableReferences(
    source,
    program,
    ingress,
    transports,
    exactCallImplementations,
    callableReferenceIsClosed,
    boundaryDependencies,
    bodyInspectionIsCertified,
  );
  for (const entry of ingress.values()) {
    if (entry.open) {
      for (const owner of entry.owners) {
        invalid.add(owner);
      }
    }
  }
}

function collectOwnerIngress(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  ownersFor: (node: Node) => StorageOwnerMembership,
  selectedOwners: ReadonlySet<Node>,
  bodyInspectionIsCertified: ExactSourceBodyInspection | undefined,
): Map<Node, OwnerIngress> {
  const result = new Map<Node, OwnerIngress>();
  for (const parameter of program.nodesOfKind(KindParameter)) {
    const owners = new Set(selectedStorageOwners(
      ownersFor(parameter),
      selectedOwners,
    ));
    const declaration = source.ast.parent(parameter);
    if (
      owners.size === 0 ||
      declaration === undefined ||
      source.ast.is.IsConstructorDeclaration(declaration) ||
      exactSourceCallableImplementation(
          source,
          declaration,
          bodyInspectionIsCertified,
        ) !== declaration ||
      source.ast.body(declaration) === undefined
    ) {
      continue;
    }
    const existing = result.get(declaration);
    if (existing !== undefined) {
      const merged = new Set(existing.owners);
      for (const owner of owners) {
        merged.add(owner);
      }
      result.set(declaration, {
        ...existing,
        owners: merged,
        parameters: new Set([...existing.parameters, parameter]),
        open: existing.open,
      });
      continue;
    }
    result.set(declaration, {
      declaration,
      owners: new Set(owners),
      parameters: new Set([parameter]),
      open: program.hasBindingWrite(declaration),
    });
  }
  return result;
}

function auditExactInvocations(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  ingress: ReadonlyMap<Node, OwnerIngress>,
  exactCallImplementations: ExactCallImplementations | undefined,
  bodyInspectionIsCertified: ExactSourceBodyInspection | undefined,
): void {
  for (const call of program.nodesOfKind(KindCallExpression)) {
    const direct = resolveExactSourceInvocation(
      source,
      call,
      bodyInspectionIsCertified,
    )?.implementation;
    const declarations = direct === undefined
      ? exactCallImplementations?.(call) ?? []
      : [direct];
    for (const declaration of declarations) {
      const entry = ingress.get(declaration);
      if (entry === undefined) {
        continue;
      }
      const invocation = direct === declaration
        ? exactSourceCallImplementationInputs(
          source,
          call,
          undefined,
          bodyInspectionIsCertified,
        )
        : exactSourceCallInputsForDeclaration(source, call, declaration);
      if (
        invocation === undefined ||
        ("declaration" in invocation &&
          invocation.declaration !== declaration) ||
        invocation.unresolvedParameters.some((parameter) =>
          entry.parameters.has(parameter)
        )
      ) {
        entry.open = true;
      }
    }
  }
}

function auditCallableReferences(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  ingress: ReadonlyMap<Node, OwnerIngress>,
  transports?: InvocationTransportContract,
  exactCallImplementations?: ExactCallImplementations,
  callableReferenceIsClosed?: (reference: Node) => boolean,
  boundaryDependencies?: StorageOwnerBoundaryDependencies,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
): void {
  const symbols = indexDeclarationSymbols(source, ingress.keys());
  for (const node of program.nodesOfKinds([
    KindIdentifier,
    KindPropertyAccessExpression,
    KindElementAccessExpression,
  ])) {
    const declaration = selectedCallableDeclaration(
      source,
      symbols,
      node,
      bodyInspectionIsCertified,
    );
    const entry = declaration === undefined ? undefined : ingress.get(declaration);
    if (
      declaration === undefined ||
      entry === undefined ||
      node === source.ast.name(declaration) ||
      isTypeOnlyReference(source, node)
    ) {
      continue;
    }
    if (isModuleForwardingReference(source, node)) {
      if (
        boundaryDependencies?.allowsModuleForwardingReference(node) !== true
      ) {
        entry.open = true;
      }
      continue;
    }
    const call = directContainingCall(source, node);
    const selected = call === undefined
      ? undefined
      : resolveExactSourceInvocation(
        source,
        call,
        bodyInspectionIsCertified,
      )?.implementation;
    const indirect = call === undefined
      ? undefined
      : exactCallImplementations?.(call);
    if (
      selected !== declaration &&
      indirect?.includes(declaration) !== true &&
      callableReferenceIsClosed?.(node) !== true &&
      !isInvocationTransportInput(source, node, transports)
    ) {
      entry.open = true;
    }
  }
}

function selectedCallableDeclaration(
  source: TargetSourceProgram,
  symbols: ReadonlyMap<Symbol, Node>,
  node: Node,
  bodyInspectionIsCertified: ExactSourceBodyInspection | undefined,
): Node | undefined {
  if (source.ast.is.IsPropertyAccessExpression(node)) {
    return exactSourceCallableImplementation(
      source,
      source.semantics.forNode(node).operations.propertyAccess(node)
        ?.selectedDeclaration,
      bodyInspectionIsCertified,
    );
  }
  if (source.ast.is.IsElementAccessExpression(node)) {
    return exactSourceCallableImplementation(
      source,
      source.semantics.forNode(node).operations.elementAccess(node)
        ?.selectedDeclaration,
      bodyInspectionIsCertified,
    );
  }
  return source.ast.is.IsIdentifier(node)
    ? declarationForSymbols(source, symbols, node)
    : undefined;
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
      source.ast.is.IsClassDeclaration(current) ||
      source.ast.is.IsSourceFile(current)
    ) {
      return false;
    }
    current = source.ast.parent(current);
  }
  return false;
}
