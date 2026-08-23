import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { TargetProgramIndex } from "../../../program-index.js";
import type { TypeScriptPlanningObserver } from "../../../planning-observer.js";
import type { InvocationTransportContract } from "../../../invocation-transport.js";
import type { ExactCallImplementations } from "../callable/result-inputs.js";
import {
  callableDeclarationHasResolvableType,
} from "../../model/callable-contract/resolution.js";
import {
  auditStorageOwnerBoundaries,
  type StorageOwnerBoundaryDependencies,
  type StorageOwnerBinding,
} from "./owner-boundaries.js";
import { storageDeclarationCanBeTracked } from "./owners.js";
import {
  createClosedStorageOwnerAnalysis,
  type ClosedStorageOwnerAnalysis,
} from "./analysis.js";

export interface CallableFields {
  readonly declarations: ReadonlySet<Node>;
  readonly initialValues: ReadonlyMap<Node, readonly Node[]>;
  close(
    values: ReadonlyMap<Node, readonly Node[]>,
    transports?: InvocationTransportContract,
    exactCallImplementations?: ExactCallImplementations,
    callableReferenceIsClosed?: (reference: Node) => boolean,
    planningObserver?: TypeScriptPlanningObserver,
    boundaryDependencies?: StorageOwnerBoundaryDependencies,
  ): ReadonlySet<Node>;
}

export function createCallableFieldBoundaryDependencies(
  source: TargetSourceProgram,
  fields: CallableFields,
): StorageOwnerBoundaryDependencies {
  return Object.freeze({
    allowsInvocation(invocation: Node): boolean {
      if (!source.ast.is.IsCallExpression(invocation)) {
        return false;
      }
      const expression = source.ast.as.AsCallExpression(invocation)?.Expression;
      if (expression === undefined) {
        return false;
      }
      const semantics = source.semantics.forNode(invocation);
      const selected = source.ast.is.IsPropertyAccessExpression(expression)
        ? semantics.operations.propertyAccess(expression)?.selectedDeclaration
        : source.ast.is.IsElementAccessExpression(expression)
        ? semantics.operations.elementAccess(expression)?.selectedDeclaration
        : undefined;
      const signature = semantics.operations.call(invocation)?.selectedSignature;
      return selected !== undefined &&
        fields.declarations.has(selected) &&
        signature !== undefined &&
        semantics.types.signatureThisParameterInfo(signature) === undefined;
    },
    allowsContextualValue(): boolean {
      return false;
    },
    allowsModuleForwardingReference(): boolean {
      return false;
    },
  });
}

export function collectCallableFields(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  storageOwners: ClosedStorageOwnerAnalysis = createClosedStorageOwnerAnalysis(
    source,
    program,
  ),
): CallableFields {
  const ownerByField = new Map<Node, Node>();
  const initialValues = new Map<Node, readonly Node[]>();
  for (const owner of storageOwners.owners) {
    for (const member of source.ast.members(owner)) {
      if (member !== undefined && fieldCanCarryCallable(source, member)) {
        addField(source, ownerByField, initialValues, owner, member);
      }
    }
    for (const constructor of source.ast.members(owner)) {
      if (
        constructor === undefined ||
        !source.ast.is.IsConstructorDeclaration(constructor)
      ) {
        continue;
      }
      for (const parameter of source.ast.parameters(constructor)) {
        if (
          parameter !== undefined &&
          parameterPropertyCanCarryCallable(source, parameter)
        ) {
          addField(source, ownerByField, initialValues, owner, parameter);
        }
      }
    }
  }
  const declarations = new Set(ownerByField.keys());
  const owners = new Set(ownerByField.values());
  return Object.freeze({
    declarations,
    initialValues,
    close(
      values: ReadonlyMap<Node, readonly Node[]>,
      transports?: InvocationTransportContract,
      exactCallImplementations?: ExactCallImplementations,
      callableReferenceIsClosed?: (reference: Node) => boolean,
      planningObserver?: TypeScriptPlanningObserver,
      boundaryDependencies?: StorageOwnerBoundaryDependencies,
    ): ReadonlySet<Node> {
      const bindings = new Map<Node, StorageOwnerBinding>();
      for (const field of declarations) {
        const owner = ownerByField.get(field);
        if (owner !== undefined) {
          bindings.set(field, {
            declaration: field,
            owner,
            inputs: values.get(field) ?? initialValues.get(field) ?? [],
            valid: true,
          });
        }
      }
      auditStorageOwnerBoundaries(
        source,
        program,
        owners,
        bindings,
        (expression) => selectedField(source, expression, declarations),
        false,
        transports,
        exactCallImplementations,
        callableReferenceIsClosed,
        planningObserver,
        owners.size === 0 ? undefined : storageOwners.topology(planningObserver),
        boundaryDependencies,
      );
      return new Set([...bindings.values()]
        .filter((binding) => binding.valid)
        .map((binding) => binding.declaration));
    },
  });
}

function addField(
  source: TargetSourceProgram,
  ownerByField: Map<Node, Node>,
  initialValues: Map<Node, readonly Node[]>,
  owner: Node,
  field: Node,
): void {
  ownerByField.set(field, owner);
  const initializer = source.ast.is.IsPropertyDeclaration(field)
    ? source.ast.as.AsPropertyDeclaration(field)?.Initializer
    : source.ast.as.AsParameterDeclaration(field)?.Initializer;
  if (initializer !== undefined) {
    initialValues.set(field, Object.freeze([initializer]));
  }
}

function fieldCanCarryCallable(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  return source.ast.is.IsPropertyDeclaration(node) &&
    storageDeclarationCanBeTracked(source, node) &&
    callableDeclarationHasResolvableType(source, node);
}

function parameterPropertyCanCarryCallable(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  return storageDeclarationCanBeTracked(source, node) &&
    callableDeclarationHasResolvableType(source, node);
}

function selectedField(
  source: TargetSourceProgram,
  expression: Node,
  fields: ReadonlySet<Node>,
): Node | undefined {
  const selected = source.ast.is.IsPropertyAccessExpression(expression)
    ? source.semantics.forNode(expression)
      .operations.propertyAccess(expression)?.selectedDeclaration
    : source.ast.is.IsElementAccessExpression(expression)
    ? source.semantics.forNode(expression)
      .operations.elementAccess(expression)?.selectedDeclaration
    : undefined;
  return selected !== undefined && fields.has(selected) ? selected : undefined;
}
