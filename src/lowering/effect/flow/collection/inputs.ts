import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { KindVariableDeclaration } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import {
  callableReturnRewrite,
  type CallableReturnRewrite,
} from "../../model/callable-contract.js";

import {
  transparentExpression,
} from "../../model/syntax.js";
import {
  containingCallArgument,
  containingFunction,
  forEachDirectFunctionNode,
  isNullishIdentityObservation,
} from "./navigation.js";
import { resolveExactSourceInvocation } from "../../model/exact-source-invocation.js";
import type {
  ExactCallableBodyInspection,
  ExactCallImplementations,
} from "../callable/result-inputs.js";
import {
  exactSourceCallInputsForDeclaration,
} from "../invocation/call-binding.js";
import { sourceBodyInspectionIsExact } from "../../model/source-membership.js";

export interface CallableCollectionContract {
  readonly returnType: CallableReturnRewrite;
  readonly extractedDeclarations: readonly Node[];
}

export interface CallableCollectionInputs {
  readonly values: ReadonlyMap<Node, readonly Node[]>;
  readonly closed: ReadonlySet<Node>;
  readonly contracts: readonly CallableCollectionContract[];
}

interface MutableCollection {
  readonly declaration: Node;
  readonly owner: Node;
  readonly returnType: CallableReturnRewrite;
  readonly values: Node[];
  readonly extractedDeclarations: Set<Node>;
  closed: boolean;
}

interface ArrayOperation {
  readonly kind: "push" | "pop" | "length";
  readonly operation: Node;
  readonly arguments: readonly Node[];
}

export function collectCallableCollectionInputs(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  exactCallImplementations?: ExactCallImplementations,
  bodyInspectionIsCertified?: ExactCallableBodyInspection,
): CallableCollectionInputs {
  const collections = collectCollections(
    source,
    program,
    bodyInspectionIsCertified,
  );
  const extractorParameters = new Map<Node, Node | false>();
  auditCollections(
    source,
    collections,
    extractorParameters,
    exactCallImplementations,
    bodyInspectionIsCertified,
  );
  collectExtractions(
    source,
    program,
    collections,
    extractorParameters,
    exactCallImplementations,
    bodyInspectionIsCertified,
  );
  const values = new Map<Node, readonly Node[]>();
  const closed = new Set<Node>();
  const contracts: CallableCollectionContract[] = [];
  for (const collection of collections.values()) {
    if (
      !collection.closed ||
      collection.values.length === 0 ||
      collection.extractedDeclarations.size === 0
    ) {
      continue;
    }
    const sealedValues = Object.freeze(collection.values);
    const extractedDeclarations = Object.freeze([
      ...collection.extractedDeclarations,
    ]);
    for (const declaration of extractedDeclarations) {
      values.set(declaration, sealedValues);
      closed.add(declaration);
    }
    contracts.push(Object.freeze({
      returnType: collection.returnType,
      extractedDeclarations,
    }));
  }
  return Object.freeze({
    values,
    closed,
    contracts: Object.freeze(contracts),
  });
}

function collectCollections(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  bodyInspectionIsCertified: ExactCallableBodyInspection | undefined,
): ReadonlyMap<Node, MutableCollection> {
  const collections = new Map<Node, MutableCollection>();
  for (const node of program.nodesOfKind(KindVariableDeclaration)) {
    const owner = containingFunction(source, node);
    const returnType = callableArrayReturnType(source, source.ast.typeNode(node));
    const initializer = source.ast.as.AsVariableDeclaration(node)?.Initializer;
    if (
      owner === undefined ||
      !sourceBodyInspectionIsExact(
        source,
        owner,
        bodyInspectionIsCertified,
      ) ||
      returnType === undefined ||
      initializer === undefined ||
      !source.ast.is.IsArrayLiteralExpression(initializer) ||
      source.ast.elements(initializer).length !== 0 ||
      !source.ast.is.IsIdentifier(source.ast.name(node))
    ) {
      continue;
    }
    collections.set(node, {
      declaration: node,
      owner,
      returnType,
      values: [],
      extractedDeclarations: new Set(),
      closed: true,
    });
  }
  return collections;
}

function auditCollections(
  source: TargetSourceProgram,
  collections: ReadonlyMap<Node, MutableCollection>,
  extractorParameters: Map<Node, Node | false>,
  exactCallImplementations?: ExactCallImplementations,
  bodyInspectionIsCertified?: ExactCallableBodyInspection,
): void {
  const byOwner = new Map<Node, Map<Node, MutableCollection>>();
  for (const collection of collections.values()) {
    const owned = byOwner.get(collection.owner);
    if (owned === undefined) {
      byOwner.set(
        collection.owner,
        new Map([[collection.declaration, collection]]),
      );
    } else {
      owned.set(collection.declaration, collection);
    }
  }
  for (const [owner, owned] of byOwner) {
    forEachDirectFunctionNode(source, owner, (node) => {
      if (!source.ast.is.IsIdentifier(node)) {
        return;
      }
      const declaration = source.navigation.sourceReferenceFor(node)?.declaration;
      const collection = declaration === undefined
        ? undefined
        : owned.get(declaration);
      if (
        collection === undefined ||
        node === source.ast.name(collection.declaration)
      ) {
        return;
      }
      const operation = selectedArrayOperation(source, node);
      if (operation?.kind === "push") {
        collection.values.push(...operation.arguments);
        return;
      }
      if (operation?.kind === "pop" || operation?.kind === "length") {
        return;
      }
      const argument = containingCallArgument(source, node);
      if (
        argument !== undefined &&
        exactExtractorInput(
          source,
          argument.call,
          extractorParameters,
          exactCallImplementations,
          bodyInspectionIsCertified,
        ) === argument.expression
      ) {
        return;
      }
      collection.closed = false;
    });
  }
}

function collectExtractions(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  collections: ReadonlyMap<Node, MutableCollection>,
  extractorParameters: Map<Node, Node | false>,
  exactCallImplementations?: ExactCallImplementations,
  bodyInspectionIsCertified?: ExactCallableBodyInspection,
): void {
  for (const node of program.nodesOfKind(KindVariableDeclaration)) {
    if (
      !source.ast.is.IsIdentifier(source.ast.name(node))
    ) {
      continue;
    }
    const initializer = source.ast.as.AsVariableDeclaration(node)?.Initializer;
    const collection = extractedCollection(
      source,
      initializer,
      collections,
      extractorParameters,
      exactCallImplementations,
      bodyInspectionIsCertified,
    );
    if (collection !== undefined) {
      collection.extractedDeclarations.add(node);
    }
  }
}

function extractedCollection(
  source: TargetSourceProgram,
  expression: Node | undefined,
  collections: ReadonlyMap<Node, MutableCollection>,
  extractorParameters: Map<Node, Node | false>,
  exactCallImplementations?: ExactCallImplementations,
  bodyInspectionIsCertified?: ExactCallableBodyInspection,
): MutableCollection | undefined {
  const root = transparentExpression(source, expression);
  if (root === undefined || !source.ast.is.IsCallExpression(root)) {
    return undefined;
  }
  const call = source.ast.as.AsCallExpression(root);
  const target = transparentExpression(source, call?.Expression);
  if (target !== undefined && source.ast.is.IsPropertyAccessExpression(target)) {
    const receiver = source.ast.as.AsPropertyAccessExpression(target)?.Expression;
    const reference = transparentExpression(source, receiver);
    const declaration = reference === undefined
      ? undefined
      : source.navigation.sourceReferenceFor(reference)?.declaration;
    const collection = declaration === undefined
      ? undefined
      : collections.get(declaration);
    const operation = reference === undefined
      ? undefined
      : selectedArrayOperation(source, reference);
    return operation?.kind === "pop" ? collection : undefined;
  }
  const argument = exactExtractorInput(
    source,
    root,
    extractorParameters,
    exactCallImplementations,
    bodyInspectionIsCertified,
  );
  const reference = transparentExpression(source, argument);
  const declaration = reference === undefined
    ? undefined
    : source.navigation.sourceReferenceFor(reference)?.declaration;
  return declaration === undefined ? undefined : collections.get(declaration);
}

function exactExtractorInput(
  source: TargetSourceProgram,
  call: Node,
  cache: Map<Node, Node | false>,
  exactCallImplementations?: ExactCallImplementations,
  bodyInspectionIsCertified?: ExactCallableBodyInspection,
): Node | undefined {
  const direct = resolveExactSourceInvocation(
    source,
    call,
    bodyInspectionIsCertified,
  )?.implementation;
  const implementations = direct === undefined
    ? exactCallImplementations?.(call) ?? []
    : [direct];
  if (implementations.length === 0) {
    return undefined;
  }
  let input: Node | undefined;
  for (const declaration of implementations) {
    const existing = cache.get(declaration);
    let parameter: Node | undefined;
    if (existing !== undefined) {
      parameter = existing === false ? undefined : existing;
    } else {
      parameter = inspectExtractor(
        source,
        declaration,
        bodyInspectionIsCertified,
      );
      cache.set(declaration, parameter ?? false);
    }
    const invocation = exactSourceCallInputsForDeclaration(
      source,
      call,
      declaration,
    );
    const inputs = parameter === undefined
      ? undefined
      : invocation?.inputs.get(parameter);
    const selected = inputs?.length === 1 ? inputs[0] : undefined;
    if (selected === undefined || input !== undefined && input !== selected) {
      return undefined;
    }
    input = selected;
  }
  return input;
}

function inspectExtractor(
  source: TargetSourceProgram,
  declaration: Node,
  bodyInspectionIsCertified: ExactCallableBodyInspection | undefined,
): Node | undefined {
  if (
    !sourceBodyInspectionIsExact(
      source,
      declaration,
      bodyInspectionIsCertified,
    ) ||
    !source.ast.is.IsFunctionDeclaration(declaration) ||
    source.ast.body(declaration) === undefined
  ) {
    return undefined;
  }
  const returns: Node[] = [];
  forEachDirectFunctionNode(source, declaration, (node) => {
    if (source.ast.is.IsReturnStatement(node)) {
      returns.push(node);
    }
  });
  if (returns.length !== 1) {
    return undefined;
  }
  const returned = transparentExpression(
    source,
    source.ast.as.AsReturnStatement(returns[0])?.Expression,
  );
  const valueDeclaration = returned === undefined
    ? undefined
    : source.navigation.sourceReferenceFor(returned)?.declaration;
  if (
    returned === undefined ||
    !source.ast.is.IsIdentifier(returned) ||
    valueDeclaration === undefined ||
    !source.ast.is.IsVariableDeclaration(valueDeclaration)
  ) {
    return undefined;
  }
  const initializer = source.ast.as.AsVariableDeclaration(valueDeclaration)
    ?.Initializer;
  const popCall = transparentExpression(source, initializer);
  const target = popCall !== undefined && source.ast.is.IsCallExpression(popCall)
    ? transparentExpression(
        source,
        source.ast.as.AsCallExpression(popCall)?.Expression,
      )
    : undefined;
  const receiver = target !== undefined &&
      source.ast.is.IsPropertyAccessExpression(target)
    ? transparentExpression(
        source,
        source.ast.as.AsPropertyAccessExpression(target)?.Expression,
      )
    : undefined;
  const parameterDeclaration = receiver === undefined
    ? undefined
    : source.navigation.sourceReferenceFor(receiver)?.declaration;
  if (
    parameterDeclaration === undefined ||
    receiver === undefined ||
    selectedArrayOperation(source, receiver)?.kind !== "pop" ||
    !extractorReferencesAreClosed(
      source,
      declaration,
      valueDeclaration,
      returned,
      parameterDeclaration,
      receiver,
    )
  ) {
    return undefined;
  }
  return parameterDeclaration;
}

function extractorReferencesAreClosed(
  source: TargetSourceProgram,
  owner: Node,
  valueDeclaration: Node,
  returnedReference: Node,
  parameterDeclaration: Node,
  popReceiver: Node,
): boolean {
  let closed = true;
  forEachDirectFunctionNode(source, owner, (node) => {
    if (!closed || !source.ast.is.IsIdentifier(node)) {
      return;
    }
    const declaration = source.navigation.sourceReferenceFor(node)?.declaration;
    if (declaration === valueDeclaration) {
      if (
        node !== source.ast.name(valueDeclaration) &&
        node !== returnedReference &&
        !isNullishIdentityObservation(source, node)
      ) {
        closed = false;
      }
      return;
    }
    if (
      declaration === parameterDeclaration &&
      node !== source.ast.name(parameterDeclaration) &&
      node !== popReceiver
    ) {
      closed = false;
    }
  });
  return closed;
}

function selectedArrayOperation(
  source: TargetSourceProgram,
  receiver: Node,
): ArrayOperation | undefined {
  const property = source.ast.parent(receiver);
  if (
    property === undefined ||
    !source.ast.is.IsPropertyAccessExpression(property) ||
    source.ast.as.AsPropertyAccessExpression(property)?.Expression !== receiver
  ) {
    return undefined;
  }
  const selected = source.semantics.forNode(property)
    .operations.propertyAccess(property);
  const declaration = selected?.selectedDeclaration;
  const declarationFile = declaration === undefined
    ? undefined
    : source.ast.getSourceFile(declaration);
  const receiverType = source.semantics.forNode(receiver).types.expressionType(receiver);
  if (
    selected === undefined ||
    selected.optionalChain ||
    selected.accessMode !== "read" ||
    declaration === undefined ||
    declarationFile === undefined ||
    !source.ast.isDeclarationFile(declarationFile) ||
    receiverType === undefined ||
    !source.semantics.forNode(receiver).types.isArrayLike(receiverType)
  ) {
    return undefined;
  }
  const name = source.ast.text(source.ast.name(declaration));
  if (name === "length") {
    return { kind: "length", operation: property, arguments: [] };
  }
  const call = source.ast.parent(property);
  if (
    call === undefined ||
    !source.ast.is.IsCallExpression(call) ||
    source.ast.as.AsCallExpression(call)?.Expression !== property
  ) {
    return undefined;
  }
  const arguments_ = source.ast.arguments(call).filter(
    (argument): argument is Node => argument !== undefined,
  );
  if (name === "push" && arguments_.length !== 0) {
    return { kind: "push", operation: call, arguments: arguments_ };
  }
  return name === "pop" && arguments_.length === 0
    ? { kind: "pop", operation: call, arguments: [] }
    : undefined;
}

function callableArrayReturnType(
  source: TargetSourceProgram,
  typeNode: Node | undefined,
): CallableReturnRewrite | undefined {
  const arrayType = unwrapParenthesizedType(source, typeNode);
  if (arrayType === undefined || !source.ast.is.IsArrayTypeNode(arrayType)) {
    return undefined;
  }
  const elementType = unwrapParenthesizedType(
    source,
    source.ast.as.AsArrayTypeNode(arrayType)?.ElementType,
  );
  if (elementType === undefined || !source.ast.is.IsFunctionTypeNode(elementType)) {
    return undefined;
  }
  const returnType = source.ast.typeNode(elementType);
  return returnType === undefined
    ? undefined
    : callableReturnRewrite(source, returnType);
}

function unwrapParenthesizedType(
  source: TargetSourceProgram,
  node: Node | undefined,
): Node | undefined {
  let current = node;
  while (current !== undefined && source.ast.is.IsParenthesizedTypeNode(current)) {
    current = source.ast.as.AsParenthesizedTypeNode(current)?.Type;
  }
  return current;
}
