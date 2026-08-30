import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  AsBinaryExpression,
  AsExpressionStatement,
  AsGetAccessorDeclaration,
  AsPropertyAccessExpression,
  AsSetAccessorDeclaration,
  IsGetAccessorDeclaration,
  IsIdentifier,
  IsPropertyAccessExpression,
  IsSetAccessorDeclaration,
  KindEqualsToken,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../program-index.js";
import type { RepresentationBindingProof } from "../binding-proof.js";
import {
  projectionCallShape,
  type ProjectionCallShape,
} from "../shape.js";

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

interface AccessorProof {
  readonly declaration: Node;
  readonly name: string;
}

type AccessorResolution =
  | { readonly kind: "proved"; readonly proof: AccessorProof }
  | {
      readonly kind: "retained";
      readonly reason:
        | "missing-accessor"
        | "ambiguous-accessor"
        | "transformed-accessor"
        | "representation-changing";
    };

type ExactAccessorShape =
  | { readonly kind: "proved"; readonly proof: AccessorProof }
  | { readonly kind: "transformed" }
  | { readonly kind: "representation-changing" };

export function directLogicalFieldShape(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  bindingProof: RepresentationBindingProof,
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
    ? resolveGetter(
        source,
        classDeclaration,
        projection.storageDeclaration,
        readDeclaration!,
      )
    : undefined;
  const write = needsWrite
    ? resolveSetter(
        source,
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

function resolveGetter(
  source: TargetSourceProgram,
  classDeclaration: Node,
  storageDeclaration: Node,
  fieldDeclaration: Node,
): AccessorResolution {
  const related = source.ast.members(classDeclaration).filter((member) =>
    member !== undefined &&
    IsGetAccessorDeclaration(member) &&
    accessorReferencesField(
      source,
      member,
      storageDeclaration,
      fieldDeclaration,
    )
  ) as Node[];
  if (related.length === 0) {
    return { kind: "retained", reason: "missing-accessor" };
  }
  if (related.length !== 1) {
    return { kind: "retained", reason: "ambiguous-accessor" };
  }
  return accessorResolution(
    proveGetter(source, related[0]!, storageDeclaration, fieldDeclaration),
  );
}

function resolveSetter(
  source: TargetSourceProgram,
  classDeclaration: Node,
  storageDeclaration: Node,
  fieldDeclaration: Node,
): AccessorResolution {
  const related = source.ast.members(classDeclaration).filter((member) =>
    member !== undefined &&
    IsSetAccessorDeclaration(member) &&
    accessorReferencesField(
      source,
      member,
      storageDeclaration,
      fieldDeclaration,
    )
  ) as Node[];
  if (related.length === 0) {
    return { kind: "retained", reason: "missing-accessor" };
  }
  if (related.length !== 1) {
    return { kind: "retained", reason: "ambiguous-accessor" };
  }
  return accessorResolution(
    proveSetter(source, related[0]!, storageDeclaration, fieldDeclaration),
  );
}

function accessorResolution(shape: ExactAccessorShape): AccessorResolution {
  return shape.kind === "proved"
    ? shape
    : {
        kind: "retained",
        reason: shape.kind === "transformed"
          ? "transformed-accessor"
          : "representation-changing",
      };
}

function proveGetter(
  source: TargetSourceProgram,
  declaration: Node,
  storageDeclaration: Node,
  fieldDeclaration: Node,
): ExactAccessorShape {
  const getter = AsGetAccessorDeclaration(declaration);
  const name = source.ast.name(declaration);
  const expression = soleReturnedExpression(source, declaration);
  if (
    getter === undefined ||
    name === undefined ||
    !IsIdentifier(name) ||
    getter.Type === undefined ||
    source.ast.parameters(declaration).length !== 0 ||
    !plainInstanceAccessor(source, declaration) ||
    expression === undefined ||
    !IsPropertyAccessExpression(expression)
  ) {
    return { kind: "transformed" };
  }
  const field = exactStorageFieldAccess(
    source,
    expression,
    storageDeclaration,
    fieldDeclaration,
    "read",
  );
  if (field === undefined || field.sourceReadType === undefined) {
    return { kind: "transformed" };
  }
  const declaredType = source.semantics.forNode(declaration)
    .types.authoredType(getter.Type);
  if (
    declaredType === undefined ||
    source.semantics.forNode(expression).types.relationship(
      declaredType,
      field.sourceReadType,
    ) !== "identical"
  ) {
    return { kind: "representation-changing" };
  }
  return Object.freeze({
    kind: "proved" as const,
    proof: Object.freeze({
      declaration,
      name: source.ast.text(name),
    }),
  });
}

function proveSetter(
  source: TargetSourceProgram,
  declaration: Node,
  storageDeclaration: Node,
  fieldDeclaration: Node,
): ExactAccessorShape {
  const setter = AsSetAccessorDeclaration(declaration);
  const name = source.ast.name(declaration);
  const parameter = source.ast.parameters(declaration)[0];
  const parsedParameter = source.ast.as.AsParameterDeclaration(parameter);
  const assignment = soleExpression(source, declaration);
  const binary = AsBinaryExpression(assignment);
  if (
    setter === undefined ||
    name === undefined ||
    !IsIdentifier(name) ||
    parameter === undefined ||
    parsedParameter === undefined ||
    parsedParameter.Type === undefined ||
    parsedParameter.DotDotDotToken !== undefined ||
    parsedParameter.QuestionToken !== undefined ||
    parsedParameter.Initializer !== undefined ||
    !IsIdentifier(parsedParameter.name) ||
    source.ast.parameters(declaration).length !== 1 ||
    !plainInstanceAccessor(source, declaration) ||
    binary?.Left === undefined ||
    binary.Right === undefined ||
    binary.OperatorToken?.Kind !== KindEqualsToken ||
    source.navigation.sourceReferenceFor(binary.Right)?.declaration !== parameter
  ) {
    return { kind: "transformed" };
  }
  const field = exactStorageFieldAccess(
    source,
    binary.Left,
    storageDeclaration,
    fieldDeclaration,
    "write",
  );
  if (field === undefined || field.sourceWriteType === undefined) {
    return { kind: "transformed" };
  }
  const declaredType = source.semantics.forNode(parameter)
    .types.authoredType(parsedParameter.Type);
  if (
    declaredType === undefined ||
    source.semantics.forNode(binary.Left).types.relationship(
      declaredType,
      field.sourceWriteType,
    ) !== "identical"
  ) {
    return { kind: "representation-changing" };
  }
  return Object.freeze({
    kind: "proved" as const,
    proof: Object.freeze({
      declaration,
      name: source.ast.text(name),
    }),
  });
}

function exactStorageFieldAccess(
  source: TargetSourceProgram,
  node: Node,
  storageDeclaration: Node,
  fieldDeclaration: Node,
  mode: "read" | "write",
): ReturnType<ReturnType<TargetSourceProgram["semantics"]["forNode"]>["operations"]["propertyAccess"]> {
  const field = AsPropertyAccessExpression(node);
  const storageExpression = field?.Expression;
  const storage = AsPropertyAccessExpression(storageExpression);
  if (
    field === undefined ||
    storage === undefined ||
    storageExpression === undefined ||
    storage.Expression === undefined ||
    source.ast.kindName(storage.Expression) !== "KindThisKeyword"
  ) {
    return undefined;
  }
  const storageInfo = source.semantics.forNode(storageExpression)
    .operations.propertyAccess(storageExpression);
  const fieldInfo = source.semantics.forNode(node).operations.propertyAccess(node);
  const selectedField = mode === "read"
    ? fieldInfo?.selectedReadDeclaration
    : fieldInfo?.selectedWriteDeclaration;
  return storageInfo !== undefined &&
      storageInfo.expression === storageExpression &&
      storageInfo.accessMode === "read" &&
      !storageInfo.optionalChain &&
      !storageInfo.callCallee &&
      storageInfo.selectedReadDeclaration === storageDeclaration &&
      fieldInfo?.expression === node &&
      fieldInfo.receiver.expression === storageExpression &&
      !fieldInfo.optionalChain &&
      !fieldInfo.callCallee &&
      selectedField === fieldDeclaration
    ? fieldInfo
    : undefined;
}

function accessorReferencesField(
  source: TargetSourceProgram,
  accessor: Node,
  storageDeclaration: Node,
  fieldDeclaration: Node,
): boolean {
  const body = source.ast.body(accessor);
  if (body === undefined) {
    return false;
  }
  let found = false;
  const visit = (node: Node): void => {
    if (found) {
      return;
    }
    if (IsPropertyAccessExpression(node)) {
      const info = source.semantics.forNode(node).operations.propertyAccess(node);
      const selected = info?.selectedReadDeclaration ??
        info?.selectedWriteDeclaration;
      if (
        selected === fieldDeclaration &&
        AsPropertyAccessExpression(node)?.Expression !== undefined &&
        storageReceiverIsExact(
          source,
          AsPropertyAccessExpression(node)!.Expression!,
          storageDeclaration,
        )
      ) {
        found = true;
        return;
      }
    }
    source.ast.forEachChild(node, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  visit(body);
  return found;
}

function storageReceiverIsExact(
  source: TargetSourceProgram,
  node: Node,
  storageDeclaration: Node,
): boolean {
  const access = AsPropertyAccessExpression(node);
  const info = source.semantics.forNode(node).operations.propertyAccess(node);
  return access?.Expression !== undefined &&
    source.ast.kindName(access.Expression) === "KindThisKeyword" &&
    info?.accessMode === "read" &&
    info.selectedReadDeclaration === storageDeclaration;
}

function soleReturnedExpression(
  source: TargetSourceProgram,
  declaration: Node,
): Node | undefined {
  const body = source.ast.body(declaration);
  if (body === undefined || !source.ast.is.IsBlock(body)) {
    return undefined;
  }
  const statements = source.ast.statements(body);
  return statements.length === 1 && statements[0] !== undefined &&
      source.ast.is.IsReturnStatement(statements[0])
    ? source.ast.as.AsReturnStatement(statements[0])?.Expression
    : undefined;
}

function soleExpression(
  source: TargetSourceProgram,
  declaration: Node,
): Node | undefined {
  const body = source.ast.body(declaration);
  if (body === undefined || !source.ast.is.IsBlock(body)) {
    return undefined;
  }
  const statements = source.ast.statements(body);
  return statements.length === 1 && statements[0] !== undefined
    ? AsExpressionStatement(statements[0])?.Expression
    : undefined;
}

function plainInstanceAccessor(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  return !source.ast.hasModifierKind(declaration, "static") &&
    !source.ast.hasModifierKind(declaration, "abstract") &&
    !source.ast.hasModifierKind(declaration, "ambient") &&
    !source.ast.hasModifierKind(declaration, "private") &&
    !source.ast.hasModifierKind(declaration, "protected") &&
    source.ast.modifiers(declaration).every((modifier) =>
      !source.ast.is.IsDecorator(modifier)
    );
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
