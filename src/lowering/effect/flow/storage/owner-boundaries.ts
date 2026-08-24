import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { TypeScriptPlanningObserver } from "../../../planning-observer.js";
import type { InvocationTransportContract } from "../../../invocation-transport.js";
import type { ExactCallImplementations } from "../callable/result-inputs.js";
import { isTransparentParent } from "../callable/input-reference.js";
import {
  resolveExactSourceInvocation,
  sourceValueReference,
} from "../../model/exact-source-invocation.js";
import { isModuleForwardingReference } from "../../model/syntax.js";
import type { TypeScriptActiveCooperativeEffectProfile } from "../../../profile.js";
import {
  type ExactSourceBodyInspection,
  sourceBodyInspectionIsExact,
} from "../../model/source-membership.js";
import {
  selectedStorageOwners,
  storageOwnerMembershipContains,
  storageValueTypeIsClosed,
} from "./owner-types.js";
import { auditStorageOwnerIngress } from "./owner-ingress.js";
import {
  createStorageOwnerTopology,
  type StorageOwnerTopology,
} from "./owner-topology.js";

export interface StorageOwnerBinding {
  readonly declaration: Node;
  readonly owner: Node;
  readonly inputs: readonly Node[];
  valid: boolean;
}

export interface StorageOwnerBoundaryDependencies {
  allowsInvocation(invocation: Node): boolean;
  allowsContextualValue(value: Node): boolean;
  allowsModuleForwardingReference(reference: Node): boolean;
}

export function createStorageOwnerProfileBoundaryDependencies(
  source: TargetSourceProgram,
  cooperativeEffects: TypeScriptActiveCooperativeEffectProfile,
): StorageOwnerBoundaryDependencies {
  return Object.freeze({
    allowsInvocation(): boolean {
      return false;
    },
    allowsContextualValue(): boolean {
      return false;
    },
    allowsModuleForwardingReference(reference: Node): boolean {
      return cooperativeEffects === "closed-program" &&
        isModuleForwardingReference(source, reference);
    },
  });
}

export function composeStorageOwnerBoundaryDependencies(
  dependencies: readonly (StorageOwnerBoundaryDependencies | undefined)[],
): StorageOwnerBoundaryDependencies | undefined {
  const selected = dependencies.filter(
    (dependency): dependency is StorageOwnerBoundaryDependencies =>
      dependency !== undefined,
  );
  return selected.length === 0
    ? undefined
    : Object.freeze({
        allowsInvocation(invocation: Node): boolean {
          return selected.some((dependency) =>
            dependency.allowsInvocation(invocation)
          );
        },
        allowsContextualValue(value: Node): boolean {
          return selected.some((dependency) =>
            dependency.allowsContextualValue(value)
          );
        },
        allowsModuleForwardingReference(reference: Node): boolean {
          return selected.some((dependency) =>
            dependency.allowsModuleForwardingReference(reference)
          );
        },
      });
}

type StorageDestination =
  | { readonly kind: "closed"; readonly owner: Node }
  | { readonly kind: "open" };

export function auditStorageOwnerBoundaries(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  owners: ReadonlySet<Node>,
  bindings: ReadonlyMap<Node, StorageOwnerBinding>,
  storageDeclarationFor: (expression: Node) => Node | undefined,
  validateStoredValues: boolean,
  transports?: InvocationTransportContract,
  exactCallImplementations?: ExactCallImplementations,
  callableReferenceIsClosed?: (reference: Node) => boolean,
  planningObserver?: TypeScriptPlanningObserver,
  topology?: StorageOwnerTopology,
  boundaryDependencies?: StorageOwnerBoundaryDependencies,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
): void {
  if (owners.size === 0) {
    return;
  }
  const invalid = new Set<Node>();
  const dependencies = new Map<Node, Set<Node>>();
  const selectedTopology = topology ?? createStorageOwnerTopology(
    source,
    program,
    owners,
    planningObserver,
    bodyInspectionIsCertified,
  );
  if (!selectedTopology.covers(source, program, owners)) {
    throw new Error("storage-owner topology does not cover its selected owners");
  }
  if (validateStoredValues) {
    rejectOpenStorageValues(source, bindings, owners);
  }
  auditStorageOwnerIngress(
    source,
    program,
    selectedTopology.ownersFor,
    owners,
    invalid,
    transports,
    exactCallImplementations,
    callableReferenceIsClosed,
    boundaryDependencies,
    bodyInspectionIsCertified,
  );
  planningObserver?.("effect-indirect-storage-ingress");
  auditInvocations(
    source,
    selectedTopology,
    owners,
    invalid,
    dependencies,
    transports,
    exactCallImplementations,
    boundaryDependencies,
    bodyInspectionIsCertified,
  );
  planningObserver?.("effect-indirect-storage-invocations");
  auditValueFlows(
    source,
    selectedTopology,
    owners,
    bindings,
    storageDeclarationFor,
    invalid,
    dependencies,
    boundaryDependencies,
  );
  planningObserver?.("effect-indirect-storage-value-flows");
  closeInvalidOwners(invalid, dependencies);
  for (const binding of bindings.values()) {
    if (invalid.has(binding.owner)) {
      binding.valid = false;
    }
  }
}

function auditInvocations(
  source: TargetSourceProgram,
  topology: StorageOwnerTopology,
  selectedOwners: ReadonlySet<Node>,
  invalid: Set<Node>,
  dependencies: Map<Node, Set<Node>>,
  transports: InvocationTransportContract | undefined,
  exactCallImplementations: ExactCallImplementations | undefined,
  boundaryDependencies: StorageOwnerBoundaryDependencies | undefined,
  bodyInspectionIsCertified: ExactSourceBodyInspection | undefined,
): void {
  for (const invocation of topology.invocations) {
    const { node, resultOwners } = invocation;
    const exactInvocation = storageInvocationHasExactImplementation(
      source,
      node,
      exactCallImplementations,
      boundaryDependencies,
      bodyInspectionIsCertified,
    );
    const transport = transports?.transportFor(node);
    if (!exactInvocation && transport === undefined) {
      for (const owner of selectedStorageOwners(resultOwners, selectedOwners)) {
        invalid.add(owner);
      }
    } else if (!exactInvocation && transport !== undefined) {
      for (const owner of selectedStorageOwners(resultOwners, selectedOwners)) {
        if (
          transport.resultOriginExpressions === undefined ||
          !transport.resultOriginExpressions.some((input) =>
            storageOwnerMembershipContains(topology.ownersFor(input), owner)
          )
        ) {
          invalid.add(owner);
        }
      }
    }
    for (const argument of invocation.arguments) {
      for (const owner of selectedStorageOwners(argument.owners, selectedOwners)) {
        if (transport?.inputExpressions.includes(argument.expression)) {
          continue;
        }
        if (
          !exactInvocation ||
          (!storageOwnerMembershipContains(argument.contextualOwners, owner) &&
            boundaryDependencies?.allowsContextualValue(argument.expression) !==
              true)
        ) {
          invalid.add(owner);
        } else {
          for (const resultOwner of selectedStorageOwners(
            resultOwners,
            selectedOwners,
          )) {
            appendOwnerDependency(dependencies, owner, resultOwner);
          }
        }
      }
    }
    if (!exactInvocation && transport === undefined) {
      for (const owner of selectedStorageOwners(
        invocation.receiverOwners,
        selectedOwners,
      )) {
        invalid.add(owner);
      }
    }
  }
}

function auditValueFlows(
  source: TargetSourceProgram,
  topology: StorageOwnerTopology,
  selectedOwners: ReadonlySet<Node>,
  bindings: ReadonlyMap<Node, StorageOwnerBinding>,
  storageDeclarationFor: (expression: Node) => Node | undefined,
  invalid: Set<Node>,
  dependencies: Map<Node, Set<Node>>,
  boundaryDependencies: StorageOwnerBoundaryDependencies | undefined,
): void {
  for (const flow of topology.valueFlows) {
    const { node, owners } = flow;
    if (flow.childOwners !== undefined) {
      for (const owner of selectedStorageOwners(owners, selectedOwners)) {
        if (!storageOwnerMembershipContains(flow.childOwners, owner)) {
          invalid.add(owner);
        }
      }
    }
    if (flow.transparentParentOwners !== undefined) {
      for (const owner of selectedStorageOwners(owners, selectedOwners)) {
        if (!storageOwnerMembershipContains(flow.transparentParentOwners, owner)) {
          invalid.add(owner);
        }
      }
    }
    if (flow.compositeOwners !== undefined) {
      for (const owner of selectedStorageOwners(owners, selectedOwners)) {
        if (!storageOwnerMembershipContains(flow.compositeOwners, owner)) {
          invalid.add(owner);
        }
      }
    }
    const destination = storageDestination(
      source,
      node,
      bindings,
      storageDeclarationFor,
    );
    if (destination?.kind === "open") {
      for (const owner of selectedStorageOwners(owners, selectedOwners)) {
        invalid.add(owner);
      }
    } else if (destination?.kind === "closed") {
      for (const owner of selectedStorageOwners(owners, selectedOwners)) {
        appendOwnerDependency(dependencies, owner, destination.owner);
      }
    }
    if (flow.contextualOwners !== undefined) {
      for (const owner of selectedStorageOwners(owners, selectedOwners)) {
        if (
          !storageOwnerMembershipContains(flow.contextualOwners, owner) &&
          boundaryDependencies?.allowsContextualValue(node) !== true
        ) {
          invalid.add(owner);
        }
      }
    }
  }
}

function rejectOpenStorageValues(
  source: TargetSourceProgram,
  bindings: ReadonlyMap<Node, StorageOwnerBinding>,
  owners: ReadonlySet<Node>,
): void {
  for (const binding of bindings.values()) {
    for (const input of binding.inputs) {
      const semantics = source.semantics.forNode(input);
      const type = semantics.types.expressionType(input);
      if (
        type === undefined ||
        !storageValueTypeIsClosed(
          semantics,
          type,
          owners,
          new Set(),
        )
      ) {
        binding.valid = false;
      }
    }
  }
}

function storageDestination(
  source: TargetSourceProgram,
  expression: Node,
  bindings: ReadonlyMap<Node, StorageOwnerBinding>,
  storageDeclarationFor: (expression: Node) => Node | undefined,
): StorageDestination | undefined {
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
    if (source.ast.is.IsBinaryExpression(parent)) {
      const binary = source.ast.as.AsBinaryExpression(parent);
      const declaration = binary?.Right === current &&
          source.ast.operatorKindName(parent) === "KindEqualsToken" &&
          binary.Left !== undefined
        ? storageDeclarationFor(binary.Left)
        : undefined;
      if (binary?.Right !== current || binary.Left === undefined) {
        return undefined;
      }
      if (
        !source.ast.is.IsPropertyAccessExpression(binary.Left) &&
        !source.ast.is.IsElementAccessExpression(binary.Left)
      ) {
        return undefined;
      }
      const owner = declaration === undefined ? undefined : bindings.get(declaration)?.owner;
      return owner === undefined ? { kind: "open" } : { kind: "closed", owner };
    }
    if (source.ast.is.IsPropertyDeclaration(parent)) {
      const declaration = source.ast.as.AsPropertyDeclaration(parent)?.Initializer === current
        ? parent
        : undefined;
      if (declaration === undefined) {
        return undefined;
      }
      const owner = bindings.get(declaration)?.owner;
      return owner === undefined ? { kind: "open" } : { kind: "closed", owner };
    }
    return undefined;
  }
}

function declarationHasExactBody(
  source: TargetSourceProgram,
  declaration: Node | undefined,
  bodyInspectionIsCertified: ExactSourceBodyInspection | undefined,
): declaration is Node {
  return declaration !== undefined &&
    sourceBodyInspectionIsExact(
      source,
      declaration,
      bodyInspectionIsCertified,
    ) &&
    !source.ast.hasModifierKind(declaration, "ambient") &&
    source.ast.body(declaration) !== undefined;
}

export function storageInvocationHasExactImplementation(
  source: TargetSourceProgram,
  invocation: Node,
  exactCallImplementations: ExactCallImplementations | undefined,
  boundaryDependencies: StorageOwnerBoundaryDependencies | undefined,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
): boolean {
  if (
    declarationHasExactBody(
      source,
      resolveExactSourceInvocation(
        source,
        invocation,
        bodyInspectionIsCertified,
      )?.implementation,
      bodyInspectionIsCertified,
    )
  ) {
    return true;
  }
  if (
    boundaryDependencies?.allowsInvocation(invocation) === true
  ) {
    return true;
  }
  const implementations = exactCallImplementations?.(invocation);
  if (
    implementations !== undefined &&
    implementations.length !== 0 &&
    implementations.every((implementation) =>
      declarationHasExactBody(
        source,
        implementation,
        bodyInspectionIsCertified,
      )
    )
  ) {
    return true;
  }
  if (!source.ast.is.IsNewExpression(invocation)) {
    return false;
  }
  const expression = source.ast.as.AsNewExpression(invocation)?.Expression;
  const selected = expression === undefined
    ? undefined
    : sourceValueReference(source, expression)?.declaration;
  return selected !== undefined &&
    sourceBodyInspectionIsExact(
      source,
      selected,
      bodyInspectionIsCertified,
    ) &&
    source.ast.is.IsClassDeclaration(selected) &&
    source.ast.members(selected).every((member) =>
      member === undefined ||
      !source.ast.is.IsConstructorDeclaration(member)
    );
}

function closeInvalidOwners(
  invalid: Set<Node>,
  dependencies: ReadonlyMap<Node, ReadonlySet<Node>>,
): void {
  const dependents = new Map<Node, Set<Node>>();
  for (const [owner, destinations] of dependencies) {
    for (const destination of destinations) {
      const existing = dependents.get(destination);
      if (existing === undefined) {
        dependents.set(destination, new Set([owner]));
      } else {
        existing.add(owner);
      }
    }
  }
  const pending = [...invalid];
  while (pending.length !== 0) {
    const destination = pending.pop();
    if (destination === undefined) {
      continue;
    }
    for (const owner of dependents.get(destination) ?? []) {
      if (!invalid.has(owner)) {
        invalid.add(owner);
        pending.push(owner);
      }
    }
  }
}

function appendOwnerDependency(
  dependencies: Map<Node, Set<Node>>,
  owner: Node,
  destination: Node,
): void {
  if (owner === destination) {
    return;
  }
  const destinations = dependencies.get(owner);
  if (destinations === undefined) {
    dependencies.set(owner, new Set([destination]));
  } else {
    destinations.add(destination);
  }
}
