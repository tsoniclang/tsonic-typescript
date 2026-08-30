import type {
  Node,
  ResolvedSourcePropertyAccessInfo,
} from "@tsonic/tsts";
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

export interface DirectLogicalFieldAccessorIndexStatistics {
  readonly accessorQueries: number;
  readonly classIndexEvaluations: number;
  readonly classMemberVisits: number;
  readonly accessorBodyNodeVisits: number;
  readonly indexedAccessorFieldPairs: number;
}

export interface DirectLogicalFieldAccessorIndex {
  resolveGetter(
    classDeclaration: Node,
    storageDeclaration: Node,
    fieldDeclaration: Node,
  ): AccessorResolution;
  resolveSetter(
    classDeclaration: Node,
    storageDeclaration: Node,
    fieldDeclaration: Node,
  ): AccessorResolution;
  statistics(): DirectLogicalFieldAccessorIndexStatistics;
}

interface AccessorProof {
  readonly declaration: Node;
  readonly name: string;
}

export type AccessorResolution =
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

type MutableAccessorTable = Map<Node, Map<Node, Node[]>>;

interface ClassAccessorIndex {
  readonly getters: MutableAccessorTable;
  readonly setters: MutableAccessorTable;
}

const noAccessors = Object.freeze([]) as readonly Node[];

export function createDirectLogicalFieldAccessorIndex(
  source: TargetSourceProgram,
): DirectLogicalFieldAccessorIndex {
  const classes = new Map<Node, ClassAccessorIndex>();
  let accessorQueries = 0;
  let classIndexEvaluations = 0;
  let classMemberVisits = 0;
  let accessorBodyNodeVisits = 0;
  let indexedAccessorFieldPairs = 0;

  const indexFor = (classDeclaration: Node): ClassAccessorIndex => {
    const cached = classes.get(classDeclaration);
    if (cached !== undefined) {
      return cached;
    }
    if (!source.ast.is.IsClassDeclaration(classDeclaration)) {
      throw new Error("logical-field accessor index received a non-class declaration");
    }
    classIndexEvaluations += 1;
    const index: ClassAccessorIndex = {
      getters: new Map(),
      setters: new Map(),
    };
    const members = source.ast.members(classDeclaration);
    classMemberVisits += members.length;
    for (const member of members) {
      if (member === undefined) {
        continue;
      }
      const table = IsGetAccessorDeclaration(member)
        ? index.getters
        : IsSetAccessorDeclaration(member)
        ? index.setters
        : undefined;
      if (table === undefined) {
        continue;
      }
      indexedAccessorFieldPairs += indexAccessorFields(
        source,
        member,
        table,
        () => {
          accessorBodyNodeVisits += 1;
        },
      );
    }
    classes.set(classDeclaration, index);
    return index;
  };

  return Object.freeze({
    resolveGetter(
      classDeclaration: Node,
      storageDeclaration: Node,
      fieldDeclaration: Node,
    ): AccessorResolution {
      accessorQueries += 1;
      const related = indexedAccessors(
        indexFor(classDeclaration).getters,
        storageDeclaration,
        fieldDeclaration,
      );
      return resolveAccessor(
        related,
        (declaration) =>
          proveGetter(source, declaration, storageDeclaration, fieldDeclaration),
      );
    },
    resolveSetter(
      classDeclaration: Node,
      storageDeclaration: Node,
      fieldDeclaration: Node,
    ): AccessorResolution {
      accessorQueries += 1;
      const related = indexedAccessors(
        indexFor(classDeclaration).setters,
        storageDeclaration,
        fieldDeclaration,
      );
      return resolveAccessor(
        related,
        (declaration) =>
          proveSetter(source, declaration, storageDeclaration, fieldDeclaration),
      );
    },
    statistics(): DirectLogicalFieldAccessorIndexStatistics {
      return Object.freeze({
        accessorQueries,
        classIndexEvaluations,
        classMemberVisits,
        accessorBodyNodeVisits,
        indexedAccessorFieldPairs,
      });
    },
  });
}

function indexAccessorFields(
  source: TargetSourceProgram,
  accessor: Node,
  table: MutableAccessorTable,
  recordNodeVisit: () => void,
): number {
  const body = source.ast.body(accessor);
  if (body === undefined) {
    return 0;
  }
  const fields = new Map<Node, Set<Node>>();
  const visit = (node: Node): void => {
    recordNodeVisit();
    if (IsPropertyAccessExpression(node)) {
      const pair = referencedStorageField(source, node);
      if (pair !== undefined) {
        const selected = fields.get(pair.storageDeclaration);
        if (selected === undefined) {
          fields.set(pair.storageDeclaration, new Set([pair.fieldDeclaration]));
        } else {
          selected.add(pair.fieldDeclaration);
        }
      }
    }
    source.ast.forEachChild(node, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  visit(body);

  let count = 0;
  for (const [storageDeclaration, fieldDeclarations] of fields) {
    let byField = table.get(storageDeclaration);
    if (byField === undefined) {
      byField = new Map();
      table.set(storageDeclaration, byField);
    }
    for (const fieldDeclaration of fieldDeclarations) {
      const declarations = byField.get(fieldDeclaration);
      if (declarations === undefined) {
        byField.set(fieldDeclaration, [accessor]);
      } else {
        declarations.push(accessor);
      }
      count += 1;
    }
  }
  return count;
}

function referencedStorageField(
  source: TargetSourceProgram,
  node: Node,
): {
  readonly storageDeclaration: Node;
  readonly fieldDeclaration: Node;
} | undefined {
  const field = AsPropertyAccessExpression(node);
  const storageExpression = field?.Expression;
  if (storageExpression === undefined) {
    return undefined;
  }
  const fieldInfo = source.semantics.forNode(node).operations.propertyAccess(node);
  const fieldDeclaration = fieldInfo?.selectedReadDeclaration ??
    fieldInfo?.selectedWriteDeclaration;
  const storageDeclaration = storageReceiverDeclaration(source, storageExpression);
  return fieldDeclaration === undefined || storageDeclaration === undefined
    ? undefined
    : { storageDeclaration, fieldDeclaration };
}

function storageReceiverDeclaration(
  source: TargetSourceProgram,
  node: Node,
): Node | undefined {
  const access = AsPropertyAccessExpression(node);
  const info = source.semantics.forNode(node).operations.propertyAccess(node);
  return access?.Expression !== undefined &&
      source.ast.kindName(access.Expression) === "KindThisKeyword" &&
      info?.accessMode === "read"
    ? info.selectedReadDeclaration
    : undefined;
}

function indexedAccessors(
  table: MutableAccessorTable,
  storageDeclaration: Node,
  fieldDeclaration: Node,
): readonly Node[] {
  return table.get(storageDeclaration)?.get(fieldDeclaration) ?? noAccessors;
}

function resolveAccessor(
  related: readonly Node[],
  prove: (declaration: Node) => ExactAccessorShape,
): AccessorResolution {
  if (related.length === 0) {
    return { kind: "retained", reason: "missing-accessor" };
  }
  if (related.length !== 1) {
    return { kind: "retained", reason: "ambiguous-accessor" };
  }
  const declaration = related[0];
  if (declaration === undefined) {
    throw new Error("logical-field accessor index lost its declaration");
  }
  const shape = prove(declaration);
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
    proof: Object.freeze({ declaration, name: source.ast.text(name) }),
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
    proof: Object.freeze({ declaration, name: source.ast.text(name) }),
  });
}

function exactStorageFieldAccess(
  source: TargetSourceProgram,
  node: Node,
  storageDeclaration: Node,
  fieldDeclaration: Node,
  mode: "read" | "write",
): ResolvedSourcePropertyAccessInfo | undefined {
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
