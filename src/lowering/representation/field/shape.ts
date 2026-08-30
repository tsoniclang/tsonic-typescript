import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { AsPropertyAccessExpression } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../program-index.js";
import type { RepresentationBindingProof } from "../binding-proof.js";
import {
  projectionCallShape,
  type ProjectionCallShape,
} from "../shape.js";
import {
  createDirectLogicalFieldAccessorIndex,
  type DirectLogicalFieldAccessorIndex,
  type DirectLogicalFieldAccessorIndexStatistics,
} from "./accessor-index.js";

export const directLogicalFieldRetentionReasons = Object.freeze([
  "profile-preserved",
  "inexact-projection",
  "inexact-access",
  "missing-accessor",
  "ambiguous-accessor",
  "transformed-accessor",
  "representation-changing",
] as const);

export type DirectLogicalFieldRetentionReason =
  typeof directLogicalFieldRetentionReasons[number];

export interface DirectLogicalFieldShape {
  readonly access: Node;
  readonly projection: ProjectionCallShape;
  readonly logicalName: string;
}

export type DirectLogicalFieldShapeResult =
  | { readonly kind: "unrelated" }
  | {
      readonly kind: "retained";
      readonly access: Node;
      readonly projectionCall?: Node;
      readonly reason: Exclude<
        DirectLogicalFieldRetentionReason,
        "profile-preserved"
      >;
    }
  | { readonly kind: "proved"; readonly shape: DirectLogicalFieldShape };

export interface DirectLogicalFieldShapeStatistics
  extends DirectLogicalFieldAccessorIndexStatistics {
  readonly shapeQueries: number;
}

export interface DirectLogicalFieldShapeResolver {
  resolve(node: Node): DirectLogicalFieldShapeResult;
  statistics(): DirectLogicalFieldShapeStatistics;
}

export function createDirectLogicalFieldShapeResolver(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  bindingProof: RepresentationBindingProof,
): DirectLogicalFieldShapeResolver {
  const accessors = createDirectLogicalFieldAccessorIndex(source);
  let shapeQueries = 0;
  return Object.freeze({
    resolve(node: Node): DirectLogicalFieldShapeResult {
      shapeQueries += 1;
      return directLogicalFieldShape(
        source,
        program,
        bindingProof,
        accessors,
        node,
      );
    },
    statistics(): DirectLogicalFieldShapeStatistics {
      return Object.freeze({ shapeQueries, ...accessors.statistics() });
    },
  });
}

function directLogicalFieldShape(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  bindingProof: RepresentationBindingProof,
  accessors: DirectLogicalFieldAccessorIndex,
  node: Node,
): DirectLogicalFieldShapeResult {
  const access = AsPropertyAccessExpression(node);
  const call = access?.Expression;
  if (
    access === undefined ||
    call === undefined ||
    !source.ast.is.IsCallExpression(call)
  ) {
    return { kind: "unrelated" };
  }
  const projection = projectionCallShape(
    source,
    program,
    bindingProof,
    call,
  );
  if (projection.kind === "unrelated") {
    return { kind: "unrelated" };
  }
  if (projection.kind === "retained") {
    return Object.freeze({
      kind: "retained" as const,
      access: node,
      projectionCall: call,
      reason: "inexact-projection" as const,
    });
  }
  const property = source.semantics.forNode(node).operations.propertyAccess(node);
  if (
    property === undefined ||
    property.expression !== node ||
    property.receiver.expression !== call ||
    property.optionalChain ||
    property.callCallee ||
    property.accessMode === "delete"
  ) {
    return retained(node, call, "inexact-access");
  }
  const classDeclaration = source.ast.parent(projection.declaration);
  if (
    classDeclaration === undefined ||
    !source.ast.is.IsClassDeclaration(classDeclaration)
  ) {
    return retained(node, call, "inexact-projection");
  }
  const needsRead = property.accessMode === "read" ||
    property.accessMode === "read-write";
  const needsWrite = property.accessMode === "write" ||
    property.accessMode === "read-write";
  const readDeclaration = property.selectedReadDeclaration;
  const writeDeclaration = property.selectedWriteDeclaration;
  if (
    needsRead && readDeclaration === undefined ||
    needsWrite && writeDeclaration === undefined
  ) {
    return retained(node, call, "inexact-access");
  }

  const read = needsRead
    ? accessors.resolveGetter(
        classDeclaration,
        projection.storageDeclaration,
        readDeclaration!,
      )
    : undefined;
  const write = needsWrite
    ? accessors.resolveSetter(
        classDeclaration,
        projection.storageDeclaration,
        writeDeclaration!,
      )
    : undefined;
  if (read?.kind === "retained") {
    return retained(node, call, read.reason);
  }
  if (write?.kind === "retained") {
    return retained(node, call, write.reason);
  }
  const logicalName = read?.proof.name ?? write?.proof.name;
  if (
    logicalName === undefined ||
    read?.kind === "proved" && write?.kind === "proved" &&
      read.proof.name !== write.proof.name
  ) {
    return retained(node, call, "ambiguous-accessor");
  }
  return Object.freeze({
    kind: "proved" as const,
    shape: Object.freeze({
      access: node,
      projection,
      logicalName,
    }),
  });
}

function retained(
  access: Node,
  projectionCall: Node,
  reason: Exclude<DirectLogicalFieldRetentionReason, "profile-preserved">,
): DirectLogicalFieldShapeResult {
  return Object.freeze({
    kind: "retained" as const,
    access,
    projectionCall,
    reason,
  });
}
