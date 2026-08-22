import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../../../../program-index.js";
import { isTransparentParent } from "../../callable/input-reference.js";
import { exactBindingWriteInput } from "../../storage/assignment.js";
import {
  isFunctionLike,
  transparentExpression,
} from "../../../model/syntax.js";

export interface ReturnLocalTopology {
  readIsAdmitted(reference: Node): boolean;
}

interface LocalComponent {
  readonly declarations: ReadonlySet<Node>;
  readonly admitted: ReadonlySet<Node>;
  readonly valid: boolean;
}

export function createReturnLocalTopology(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ReturnLocalTopology {
  const components = new Map<Node, LocalComponent | null>();
  const componentFor = (declaration: Node): LocalComponent | undefined => {
    const existing = components.get(declaration);
    if (existing !== undefined) {
      return existing ?? undefined;
    }
    const owner = localOwner(source, declaration);
    if (owner === undefined) {
      components.set(declaration, null);
      return undefined;
    }
    const declarations = collectIdentityComponent(
      source,
      program,
      declaration,
      owner,
      components,
    );
    const admitted = new Set<Node>();
    let valid = true;
    for (const selected of declarations) {
      const writes = new Set(
        program.bindingWritesFor(selected).map((write) => write.reference),
      );
      for (const reference of source.navigation.referencesToDeclaration(selected)) {
        if (writes.has(reference)) {
          continue;
        }
        if (
          containingLocalScope(source, reference) === owner &&
          referenceIsAdmitted(source, program, reference, declarations)
        ) {
          admitted.add(reference);
        } else {
          valid = false;
        }
      }
    }
    const component = Object.freeze({ declarations, admitted, valid });
    for (const selected of declarations) {
      const prior = components.get(selected);
      if (prior !== undefined && prior !== null && prior !== component) {
        throw new Error("return-local identity components overlap");
      }
      components.set(selected, component);
    }
    return component;
  };
  return Object.freeze({
    readIsAdmitted(reference: Node): boolean {
      const declaration = source.navigation.sourceReferenceFor(reference)?.declaration;
      if (declaration === undefined) {
        return false;
      }
      const component = componentFor(declaration);
      return component?.valid === true && component.admitted.has(reference);
    },
  });
}

function collectIdentityComponent(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  root: Node,
  owner: Node,
  known: ReadonlyMap<Node, LocalComponent | null>,
): ReadonlySet<Node> {
  const declarations = new Set<Node>();
  const pending = [root];
  while (pending.length !== 0) {
    const declaration = pending.pop();
    if (declaration === undefined || declarations.has(declaration)) {
      continue;
    }
    const existing = known.get(declaration);
    if (existing !== undefined && existing !== null) {
      if (!existing.declarations.has(root)) {
        throw new Error("return-local reverse identity edge escaped its component");
      }
      return existing.declarations;
    }
    if (localOwner(source, declaration) !== owner) {
      continue;
    }
    declarations.add(declaration);
    for (const input of exactBindingInputs(source, program, declaration)) {
      for (const reference of directIdentityReferences(source, input)) {
        const selected = source.navigation.sourceReferenceFor(reference)?.declaration;
        if (selected !== undefined && localOwner(source, selected) === owner) {
          pending.push(selected);
        }
      }
    }
    for (const reference of source.navigation.referencesToDeclaration(declaration)) {
      const destination = identityDestinationDeclaration(source, reference);
      if (
        destination !== undefined &&
        localOwner(source, destination) === owner &&
        exactBindingInputs(source, program, destination).some((input) =>
          directIdentityReferences(source, input).includes(reference)
        )
      ) {
        pending.push(destination);
      }
    }
  }
  return Object.freeze(declarations);
}

function exactBindingInputs(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  declaration: Node,
): readonly Node[] {
  const initializer = source.ast.as.AsVariableDeclaration(declaration)?.Initializer;
  const inputs: Node[] = initializer === undefined ? [] : [initializer];
  for (const write of program.bindingWritesFor(declaration)) {
    const input = exactBindingWriteInput(source, write);
    if (input !== undefined) {
      inputs.push(input);
    }
  }
  return inputs;
}

function localOwner(
  source: TargetSourceProgram,
  declaration: Node,
): Node | undefined {
  return source.ast.is.IsVariableDeclaration(declaration) &&
      source.ast.is.IsIdentifier(source.ast.name(declaration))
    ? containingLocalScope(source, declaration)
    : undefined;
}

function referenceIsAdmitted(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  reference: Node,
  declarations: ReadonlySet<Node>,
): boolean {
  const destination = identityDestinationDeclaration(source, reference);
  const replacement = awaitedReplacementDeclaration(source, reference);
  return referenceIsAwaited(source, reference) ||
    referenceIsReturned(source, reference) ||
    (destination !== undefined &&
      declarations.has(destination) &&
      exactBindingInputs(source, program, destination).some((input) =>
        directIdentityReferences(source, input).includes(reference)
      )) ||
    (replacement !== undefined && declarations.has(replacement)) ||
    isNullishIdentityObservation(source, reference);
}

function referenceIsAwaited(
  source: TargetSourceProgram,
  reference: Node,
): boolean {
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return false;
    }
    if (isTransparentParent(source, parent, current)) {
      current = parent;
      continue;
    }
    return source.ast.is.IsAwaitExpression(parent) &&
      source.ast.as.AsAwaitExpression(parent)?.Expression === current;
  }
}

function directIdentityReferences(
  source: TargetSourceProgram,
  expression: Node,
): readonly Node[] {
  const root = transparentExpression(source, expression);
  if (root === undefined) {
    return [];
  }
  if (source.ast.is.IsIdentifier(root)) {
    return [root];
  }
  if (!source.ast.is.IsConditionalExpression(root)) {
    return [];
  }
  const conditional = source.ast.as.AsConditionalExpression(root);
  return [conditional?.WhenTrue, conditional?.WhenFalse].flatMap((branch) =>
    branch === undefined ? [] : directIdentityReferences(source, branch)
  );
}

function referenceIsReturned(
  source: TargetSourceProgram,
  reference: Node,
): boolean {
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return false;
    }
    if (
      isTransparentParent(source, parent, current) ||
      isConditionalBranch(source, parent, current) ||
      isArrayElement(source, parent, current)
    ) {
      current = parent;
      continue;
    }
    if (source.ast.is.IsReturnStatement(parent)) {
      return source.ast.as.AsReturnStatement(parent)?.Expression === current;
    }
    return source.ast.is.IsArrowFunction(parent) &&
      source.ast.body(parent) === current;
  }
}

function identityDestinationDeclaration(
  source: TargetSourceProgram,
  reference: Node,
): Node | undefined {
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return undefined;
    }
    if (
      isTransparentParent(source, parent, current) ||
      isConditionalBranch(source, parent, current)
    ) {
      current = parent;
      continue;
    }
    if (source.ast.is.IsVariableDeclaration(parent)) {
      return source.ast.as.AsVariableDeclaration(parent)?.Initializer === current
        ? parent
        : undefined;
    }
    if (!source.ast.is.IsBinaryExpression(parent)) {
      return undefined;
    }
    const binary = source.ast.as.AsBinaryExpression(parent);
    const target = binary?.Right === current &&
        source.ast.operatorKindName(parent) === "KindEqualsToken"
      ? transparentExpression(source, binary.Left)
      : undefined;
    return target !== undefined && source.ast.is.IsIdentifier(target)
      ? source.navigation.sourceReferenceFor(target)?.declaration
      : undefined;
  }
}

function awaitedReplacementDeclaration(
  source: TargetSourceProgram,
  reference: Node,
): Node | undefined {
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined || isFunctionLike(source, parent)) {
      return undefined;
    }
    if (!source.ast.is.IsBinaryExpression(parent)) {
      current = parent;
      continue;
    }
    const binary = source.ast.as.AsBinaryExpression(parent);
    const target = binary?.Right === current &&
        source.ast.operatorKindName(parent) === "KindEqualsToken"
      ? transparentExpression(source, binary.Left)
      : undefined;
    const value = transparentExpression(source, binary?.Right);
    return target !== undefined &&
        source.ast.is.IsIdentifier(target) &&
        value !== undefined &&
        source.ast.is.IsAwaitExpression(value)
      ? source.navigation.sourceReferenceFor(target)?.declaration
      : undefined;
  }
}

function isConditionalBranch(
  source: TargetSourceProgram,
  parent: Node,
  child: Node,
): boolean {
  if (!source.ast.is.IsConditionalExpression(parent)) {
    return false;
  }
  const conditional = source.ast.as.AsConditionalExpression(parent);
  return conditional?.WhenTrue === child || conditional?.WhenFalse === child;
}

function isArrayElement(
  source: TargetSourceProgram,
  parent: Node,
  child: Node,
): boolean {
  return source.ast.is.IsArrayLiteralExpression(parent) &&
    source.ast.elements(parent).includes(child);
}

function isNullishIdentityObservation(
  source: TargetSourceProgram,
  reference: Node,
): boolean {
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return false;
    }
    if (source.ast.is.IsBinaryExpression(parent)) {
      if (!new Set([
        "KindEqualsEqualsEqualsToken",
        "KindExclamationEqualsEqualsToken",
      ]).has(source.ast.operatorKindName(parent) ?? "")) {
        return false;
      }
      const binary = source.ast.as.AsBinaryExpression(parent);
      const other = binary?.Left === current
        ? binary.Right
        : binary?.Right === current
        ? binary.Left
        : undefined;
      if (other === undefined) {
        return false;
      }
      const semantics = source.semantics.forNode(other);
      const type = semantics.types.expressionType(other);
      return type !== undefined && semantics.types.isNullish(type);
    }
    if (!isTransparentParent(source, parent, current)) {
      return false;
    }
    current = parent;
  }
}

function containingLocalScope(
  source: TargetSourceProgram,
  node: Node,
): Node | undefined {
  let current = source.ast.parent(node);
  while (current !== undefined) {
    if (isFunctionLike(source, current)) {
      return current;
    }
    current = source.ast.parent(current);
  }
  return source.ast.getSourceFile(node);
}
