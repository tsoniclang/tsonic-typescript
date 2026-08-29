import type { Node, SourceFile } from "@tsonic/tsts";
import {
  AsArrayTypeNode,
  AsConstructorDeclaration,
  AsNewExpression,
  AsParameterDeclaration,
  AsSourceFile,
  AsTupleTypeNode,
  AsTypeReferenceNode,
  AsUnionTypeNode,
  IsImportDeclaration,
  KindTrueKeyword,
  KindUndefinedKeyword,
  NewIdentifier,
  NewKeywordExpression,
  NodeFactory_NewNodeList,
  NodeFactory_UpdateConstructorDeclaration,
  NodeFactory_UpdateParameterDeclaration,
  NodeFactory_UpdateSourceFile,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import type { FinalNodeLookup } from "../../final-nodes.js";
import { PointerLoweringError } from "../diagnostic.js";
import type {
  CanonicalPointerKeyMapPlan,
  CanonicalPointerKeyMapRewrite,
} from "./plan.js";
import {
  canonicalPointerMapStorageClass,
  canonicalPointerMapStorageConstruction,
  canonicalPointerMapStorageType,
} from "./storage-ast.js";

export interface CanonicalPointerKeyMapConsumption {
  readonly rewrittenNodes: Set<Node>;
  helperInserted: boolean;
}

interface StorageShape {
  readonly keyType: Node;
  readonly bucketType: Node;
  readonly undefinedType: Node;
}

export function createCanonicalPointerKeyMapConsumption(): CanonicalPointerKeyMapConsumption {
  return {
    rewrittenNodes: new Set(),
    helperInserted: false,
  };
}

export function rewriteCanonicalPointerKeyMapNode(
  factory: NodeFactory,
  original: Node,
  updated: Node,
  rewrite: CanonicalPointerKeyMapRewrite,
  finalNodes: FinalNodeLookup,
  consumed: CanonicalPointerKeyMapConsumption,
): Node | undefined {
  if (consumed.rewrittenNodes.has(original)) {
    throw new PointerLoweringError(
      "canonical pointer-key map node was rewritten twice",
    );
  }
  consumed.rewrittenNodes.add(original);
  switch (rewrite.kind) {
    case "constructor":
      return rewriteConstructor(factory, updated, rewrite.plan);
    case "storage-construction":
      return rewriteStorageConstruction(factory, updated, rewrite.plan);
    case "remove-hash-method":
    case "remove-equal-method":
    case "remove-hash-variable":
      return undefined;
    case "replace-hash-call":
      return requiredFinalNode(
        finalNodes,
        rewrite.expression,
        "canonical pointer-key map hash argument",
      );
    case "replace-hash-reference":
      return requiredNode(
        NewIdentifier(factory, rewrite.name),
        "canonical pointer-key map key reference",
      );
    case "replace-equal-call":
      return requiredNode(
        NewKeywordExpression(factory, KindTrueKeyword),
        "canonical pointer-key map exact-key equality",
      );
  }
}

export function insertCanonicalPointerKeyMapStorage(
  factory: NodeFactory,
  sourceFile: SourceFile,
  plans: readonly CanonicalPointerKeyMapPlan[],
  consumed: CanonicalPointerKeyMapConsumption,
): SourceFile {
  if (plans.length === 0) {
    return sourceFile;
  }
  if (consumed.helperInserted) {
    throw new PointerLoweringError(
      "canonical pointer-key map storage was inserted twice",
    );
  }
  const helperNames = new Set(plans.map((plan) => plan.helperName.text));
  if (helperNames.size !== 1) {
    throw new PointerLoweringError(
      "canonical pointer-key maps in one file disagree on storage identity",
    );
  }
  const helperName = plans[0]?.helperName;
  if (helperName === undefined) {
    throw new PointerLoweringError(
      "canonical pointer-key map storage has no collision-safe name",
    );
  }
  const statements = [...(sourceFile.Statements?.Nodes ?? [])];
  let insertionIndex = 0;
  for (let index = 0; index < statements.length; index += 1) {
    if (IsImportDeclaration(statements[index])) {
      insertionIndex = index + 1;
    }
  }
  statements.splice(
    insertionIndex,
    0,
    canonicalPointerMapStorageClass(factory, helperName),
  );
  const result = AsSourceFile(NodeFactory_UpdateSourceFile(
    factory,
    sourceFile,
    NodeFactory_NewNodeList(factory, statements),
    sourceFile.EndOfFileToken,
  ));
  if (result === undefined) {
    throw new PointerLoweringError(
      "canonical pointer-key map storage insertion lost its source file",
    );
  }
  consumed.helperInserted = true;
  return result;
}

export function assertCanonicalPointerKeyMapConsumption(
  plans: readonly CanonicalPointerKeyMapPlan[],
  consumed: CanonicalPointerKeyMapConsumption,
): void {
  const expected = new Set<Node>();
  for (const plan of plans) {
    expected.add(plan.constructorDeclaration);
    expected.add(plan.storageConstruction);
    expected.add(plan.hashMethod);
    expected.add(plan.equalMethod);
    expected.add(plan.hashVariableStatement);
    for (const call of plan.hashCallReplacements.keys()) {
      expected.add(call);
    }
    for (const call of plan.equalCallReplacements) {
      expected.add(call);
    }
    for (const reference of plan.hashVariableReferenceReplacements.keys()) {
      expected.add(reference);
    }
  }
  if (
    expected.size !== consumed.rewrittenNodes.size ||
    [...expected].some((node) => !consumed.rewrittenNodes.has(node))
  ) {
    throw new PointerLoweringError(
      `canonical pointer-key map consumed ${consumed.rewrittenNodes.size} nodes, expected ${expected.size}`,
    );
  }
  if (consumed.helperInserted !== (plans.length !== 0)) {
    throw new PointerLoweringError(
      "canonical pointer-key map storage insertion was not consumed exactly once",
    );
  }
}

function rewriteConstructor(
  factory: NodeFactory,
  updated: Node,
  plan: CanonicalPointerKeyMapPlan,
): Node {
  const constructor = AsConstructorDeclaration(updated);
  const parameters = [...(constructor?.Parameters?.Nodes ?? [])];
  const storageIndex = sourceParameterIndex(plan);
  const storageParameter = parameters[storageIndex];
  const parsedStorage = AsParameterDeclaration(storageParameter);
  const shape = storageShape(parsedStorage?.Type);
  if (
    constructor === undefined ||
    storageParameter === undefined ||
    parsedStorage === undefined ||
    shape === undefined
  ) {
    throw new PointerLoweringError(
      "canonical pointer-key map constructor lost its storage shape",
    );
  }
  parameters[storageIndex] = requiredNode(
    NodeFactory_UpdateParameterDeclaration(
      factory,
      parsedStorage,
      parsedStorage.modifiers,
      parsedStorage.DotDotDotToken,
      parsedStorage.name,
      parsedStorage.QuestionToken,
      canonicalPointerMapStorageType(
        factory,
        plan.helperName,
        shape.keyType,
        shape.bucketType,
        shape.undefinedType,
      ),
      parsedStorage.Initializer,
    ),
    "canonical pointer-key map storage parameter",
  );
  return requiredNode(
    NodeFactory_UpdateConstructorDeclaration(
      factory,
      constructor,
      constructor.modifiers,
      constructor.TypeParameters,
      NodeFactory_NewNodeList(factory, parameters),
      constructor.Type,
      constructor.FullSignature,
      constructor.Body,
    ),
    "canonical pointer-key map constructor",
  );
}

function rewriteStorageConstruction(
  factory: NodeFactory,
  updated: Node,
  plan: CanonicalPointerKeyMapPlan,
): Node {
  const construction = AsNewExpression(updated);
  const arguments_ = construction?.TypeArguments?.Nodes ?? [];
  const bucketType = arguments_[1];
  const keyType = bucketKeyType(bucketType);
  if (
    construction === undefined ||
    arguments_.length !== 2 ||
    bucketType === undefined ||
    keyType === undefined ||
    construction.Arguments?.Nodes.length !== 0
  ) {
    throw new PointerLoweringError(
      "canonical pointer-key map construction lost its exact bucket shape",
    );
  }
  return canonicalPointerMapStorageConstruction(
    factory,
    plan.helperName,
    keyType,
    bucketType,
  );
}

function sourceParameterIndex(plan: CanonicalPointerKeyMapPlan): number {
  const constructor = AsConstructorDeclaration(plan.constructorDeclaration);
  const index = constructor?.Parameters?.Nodes.indexOf(plan.storageParameter) ?? -1;
  if (index < 0) {
    throw new PointerLoweringError(
      "canonical pointer-key map lost its exact storage parameter",
    );
  }
  return index;
}

function storageShape(type: Node | undefined): StorageShape | undefined {
  const union = AsUnionTypeNode(type);
  const members = union?.Types?.Nodes ?? [];
  if (members.length !== 2) {
    return undefined;
  }
  const undefinedMember = members.find((member) =>
    member?.Kind === KindUndefinedKeyword
  );
  const storageMember = members.find((member) => member !== undefinedMember);
  const reference = AsTypeReferenceNode(storageMember);
  const arguments_ = reference?.TypeArguments?.Nodes ?? [];
  const bucketType = arguments_[1];
  const keyType = bucketKeyType(bucketType);
  return undefinedMember !== undefined &&
      storageMember !== undefined &&
      reference !== undefined &&
      arguments_.length === 2 &&
      bucketType !== undefined &&
      keyType !== undefined
    ? { keyType, bucketType, undefinedType: undefinedMember }
    : undefined;
}

function bucketKeyType(bucketType: Node | undefined): Node | undefined {
  const array = AsArrayTypeNode(bucketType);
  const tuple = AsTupleTypeNode(array?.ElementType);
  const elements = tuple?.Elements?.Nodes ?? [];
  return elements.length === 2 ? elements[0] : undefined;
}

function requiredFinalNode(
  finalNodes: FinalNodeLookup,
  original: Node,
  subject: string,
): Node {
  return requiredNode(finalNodes.forOriginal(original), subject);
}

function requiredNode<T>(value: T | undefined, subject: string): T {
  if (value === undefined) {
    throw new PointerLoweringError(`${subject} was not created`);
  }
  return value;
}
