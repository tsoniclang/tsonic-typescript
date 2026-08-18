import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import type { TargetProgramIndex } from "../../../program-index.js";
import type { StorageOwnerTransportContract } from "../../../storage-owner-transport.js";
import { callableDeclarationAllowsSynchronousValue } from "../../model/callable-contract.js";
import {
  auditStorageOwnerBoundaries,
  type StorageOwnerBinding,
} from "./owner-boundaries.js";
import {
  collectClosedStorageOwners,
  storageDeclarationCanBeTracked,
} from "./owners.js";

export interface CallableFields {
  readonly declarations: ReadonlySet<Node>;
  readonly initialValues: ReadonlyMap<Node, readonly Node[]>;
  close(
    values: ReadonlyMap<Node, readonly Node[]>,
    transports?: StorageOwnerTransportContract,
  ): ReadonlySet<Node>;
}

export function collectCallableFields(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): CallableFields {
  const owners = new Set<Node>();
  const ownerByField = new Map<Node, Node>();
  const initialValues = new Map<Node, readonly Node[]>();
  for (const owner of collectClosedStorageOwners(source, program)) {
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
  return Object.freeze({
    declarations,
    initialValues,
    close(
      values: ReadonlyMap<Node, readonly Node[]>,
      transports?: StorageOwnerTransportContract,
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
        new Set(ownerByField.values()),
        bindings,
        (expression) => selectedField(source, expression, declarations),
        false,
        transports,
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
    callableDeclarationAllowsSynchronousValue(source, node);
}

function parameterPropertyCanCarryCallable(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  return storageDeclarationCanBeTracked(source, node) &&
    callableDeclarationAllowsSynchronousValue(source, node);
}

function selectedField(
  source: TargetSourceProgram,
  expression: Node,
  fields: ReadonlySet<Node>,
): Node | undefined {
  const selected = source.ast.is.IsPropertyAccessExpression(expression)
    ? source.semantics.forNode(expression)
      .getResolvedPropertyAccessInfo(expression)?.selectedDeclaration
    : source.ast.is.IsElementAccessExpression(expression)
    ? source.semantics.forNode(expression)
      .getResolvedElementAccessInfo(expression)?.selectedDeclaration
    : undefined;
  return selected !== undefined && fields.has(selected) ? selected : undefined;
}
