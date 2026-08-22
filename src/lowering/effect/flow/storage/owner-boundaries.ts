import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { TypeScriptPlanningObserver } from "../../../planning-observer.js";
import type { InvocationTransportContract } from "../../../invocation-transport.js";
import type { ExactCallImplementations } from "../callable/result-inputs.js";
import type { ExactInvocationInputIndex } from "../invocation/inputs.js";
import { isTransparentParent } from "../callable/input-reference.js";
import { resolveProjectInvocation } from "../../model/project-invocation.js";
import {
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
  invocationInputs?: ExactInvocationInputIndex,
  exactCallImplementations?: ExactCallImplementations,
  callableReferenceIsClosed?: (reference: Node) => boolean,
  planningObserver?: TypeScriptPlanningObserver,
  topology?: StorageOwnerTopology,
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
    invocationInputs,
    exactCallImplementations,
    callableReferenceIsClosed,
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
): void {
  for (const invocation of topology.invocations) {
    const { node, resultOwners } = invocation;
    const projectInvocation = invocationHasProjectImplementation(
      source,
      node,
      exactCallImplementations,
    );
    const transport = transports?.transportFor(node);
    if (!projectInvocation && transport === undefined) {
      for (const owner of resultOwners) {
        if (!selectedOwners.has(owner)) {
          continue;
        }
        invalid.add(owner);
      }
    } else if (!projectInvocation && transport !== undefined) {
      for (const owner of resultOwners) {
        if (!selectedOwners.has(owner)) {
          continue;
        }
        if (
          transport.resultOriginExpressions === undefined ||
          !transport.resultOriginExpressions.some((input) =>
            topology.ownersFor(input).includes(owner)
          )
        ) {
          invalid.add(owner);
        }
      }
    }
    for (const argument of invocation.arguments) {
      for (const owner of argument.owners) {
        if (!selectedOwners.has(owner)) {
          continue;
        }
        if (transport?.inputExpressions.includes(argument.expression)) {
          continue;
        }
        if (!projectInvocation || !argument.contextualOwners.includes(owner)) {
          invalid.add(owner);
        } else {
          for (const resultOwner of resultOwners) {
            if (selectedOwners.has(resultOwner)) {
              appendOwnerDependency(dependencies, owner, resultOwner);
            }
          }
        }
      }
    }
    if (!projectInvocation && transport === undefined) {
      for (const owner of invocation.receiverOwners) {
        if (selectedOwners.has(owner)) {
          invalid.add(owner);
        }
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
): void {
  for (const flow of topology.valueFlows) {
    const { node, owners } = flow;
    if (flow.childOwners !== undefined) {
      for (const owner of owners) {
        if (!selectedOwners.has(owner)) {
          continue;
        }
        if (!flow.childOwners.includes(owner)) {
          invalid.add(owner);
        }
      }
    }
    if (flow.transparentParentOwners !== undefined) {
      for (const owner of owners) {
        if (!selectedOwners.has(owner)) {
          continue;
        }
        if (!flow.transparentParentOwners.includes(owner)) {
          invalid.add(owner);
        }
      }
    }
    if (flow.compositeOwners !== undefined) {
      for (const owner of owners) {
        if (!selectedOwners.has(owner)) {
          continue;
        }
        if (!flow.compositeOwners.includes(owner)) {
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
      for (const owner of owners) {
        if (selectedOwners.has(owner)) {
          invalid.add(owner);
        }
      }
    } else if (destination?.kind === "closed") {
      for (const owner of owners) {
        if (selectedOwners.has(owner)) {
          appendOwnerDependency(dependencies, owner, destination.owner);
        }
      }
    }
    if (flow.contextualOwners !== undefined) {
      for (const owner of owners) {
        if (!selectedOwners.has(owner)) {
          continue;
        }
        if (!flow.contextualOwners.includes(owner)) {
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

function declarationHasProjectBody(
  source: TargetSourceProgram,
  declaration: Node | undefined,
): declaration is Node {
  return declaration !== undefined &&
    source.navigation.isProjectDeclaration(declaration) &&
    !source.ast.hasModifierKind(declaration, "ambient") &&
    source.ast.body(declaration) !== undefined;
}

function invocationHasProjectImplementation(
  source: TargetSourceProgram,
  invocation: Node,
  exactCallImplementations: ExactCallImplementations | undefined,
): boolean {
  if (
    declarationHasProjectBody(
      source,
      resolveProjectInvocation(source, invocation)?.implementation,
    )
  ) {
    return true;
  }
  const implementations = exactCallImplementations?.(invocation);
  if (
    implementations !== undefined &&
    implementations.length !== 0 &&
    implementations.every((implementation) =>
      declarationHasProjectBody(source, implementation)
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
    : source.navigation.sourceReferenceFor(expression)?.declaration;
  return selected !== undefined &&
    source.navigation.isProjectDeclaration(selected) &&
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
