import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../program-index.js";

export interface RepresentationBindingProofStatistics {
  readonly classQueries: number;
  readonly classEvaluations: number;
  readonly callableQueries: number;
  readonly callableEvaluations: number;
}

export interface RepresentationBindingProof {
  classValueReferencesAreClosed(classDeclaration: Node): boolean;
  stableCallable(declaration: Node): boolean;
  statistics(): RepresentationBindingProofStatistics;
}

export function createRepresentationBindingProof(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): RepresentationBindingProof {
  const classClosures = new Map<Node, boolean>();
  const callableStability = new Map<Node, boolean>();
  let classQueries = 0;
  let classEvaluations = 0;
  let callableQueries = 0;
  let callableEvaluations = 0;
  const classValueReferencesAreClosed = (classDeclaration: Node): boolean => {
    classQueries += 1;
    const cached = classClosures.get(classDeclaration);
    if (cached !== undefined || classClosures.has(classDeclaration)) {
      return cached ?? false;
    }
    if (!source.ast.is.IsClassDeclaration(classDeclaration)) {
      throw new Error("representation class-closure proof received a non-class declaration");
    }
    classEvaluations += 1;
    const closed = classStaticSurfaceIsClosed(source, program, classDeclaration);
    classClosures.set(classDeclaration, closed);
    return closed;
  };
  return Object.freeze({
    classValueReferencesAreClosed,
    stableCallable(declaration: Node): boolean {
      callableQueries += 1;
      const cached = callableStability.get(declaration);
      if (cached !== undefined || callableStability.has(declaration)) {
        return cached ?? false;
      }
      callableEvaluations += 1;
      const stable = callableIsStable(
        source,
        program,
        classValueReferencesAreClosed,
        declaration,
      );
      callableStability.set(declaration, stable);
      return stable;
    },
    statistics(): RepresentationBindingProofStatistics {
      return Object.freeze({
        classQueries,
        classEvaluations,
        callableQueries,
        callableEvaluations,
      });
    },
  });
}

function callableIsStable(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  classValueReferencesAreClosed: (classDeclaration: Node) => boolean,
  declaration: Node,
): boolean {
  const parsed = source.ast.is.IsFunctionDeclaration(declaration)
    ? source.ast.as.AsFunctionDeclaration(declaration)
    : source.ast.is.IsMethodDeclaration(declaration)
    ? source.ast.as.AsMethodDeclaration(declaration)
    : undefined;
  const parent = source.ast.parent(declaration);
  const stableClass = source.ast.is.IsFunctionDeclaration(declaration) ||
    parent !== undefined &&
      source.ast.is.IsClassDeclaration(parent) &&
      classValueReferencesAreClosed(parent);
  return parsed !== undefined &&
    parsed.AsteriskToken === undefined &&
    !source.ast.hasModifierKind(declaration, "async") &&
    !hasDecorator(source, declaration) &&
    !program.hasBindingWrite(declaration) &&
    stableClass &&
    (source.ast.is.IsFunctionDeclaration(declaration) ||
      parent !== undefined &&
        source.ast.is.IsClassDeclaration(parent) &&
        source.ast.extendsHeritageElements(parent).length === 0 &&
        !hasDecorator(source, parent) &&
        !program.hasBindingWrite(parent));
}

function classStaticSurfaceIsClosed(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  classDeclaration: Node,
): boolean {
  return !hasDecorator(source, classDeclaration) &&
    source.ast.members(classDeclaration).every((member) =>
      member !== undefined &&
      !hasDecorator(source, member) &&
      !source.ast.is.IsClassStaticBlockDeclaration(member) &&
      !staticPropertyHasInitializer(source, member) &&
      !staticMemberObservesClassReceiver(source, member)
    ) &&
    classReferenceUsesAreClosed(source, program, classDeclaration);
}

function classReferenceUsesAreClosed(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  classDeclaration: Node,
): boolean {
  return source.navigation.referencesToDeclaration(classDeclaration).every((reference) =>
    isModuleForwardingReference(source, reference) ||
    plainTypeReference(source, reference) ||
    exactConstructionTarget(source, reference) ||
    exactStaticMethodRead(source, program, reference, classDeclaration)
  );
}

function staticMemberObservesClassReceiver(
  source: TargetSourceProgram,
  member: Node,
): boolean {
  if (!source.ast.hasModifierKind(member, "static")) {
    return false;
  }
  let observed = false;
  const visit = (node: Node): void => {
    const kind = source.ast.kindName(node);
    if (kind === "KindThisKeyword" || kind === "KindSuperKeyword") {
      observed = true;
      return;
    }
    source.ast.forEachChild(node, (child) => {
      if (!observed && child !== undefined) {
        visit(child);
      }
    });
  };
  visit(member);
  return observed;
}

function staticPropertyHasInitializer(
  source: TargetSourceProgram,
  member: Node,
): boolean {
  return source.ast.is.IsPropertyDeclaration(member) &&
    source.ast.hasModifierKind(member, "static") &&
    source.ast.as.AsPropertyDeclaration(member)?.Initializer !== undefined;
}

function exactConstructionTarget(
  source: TargetSourceProgram,
  reference: Node,
): boolean {
  const parent = source.ast.parent(reference);
  return parent !== undefined &&
    source.ast.is.IsNewExpression(parent) &&
    source.ast.as.AsNewExpression(parent)?.Expression === reference;
}

function exactStaticMethodRead(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  reference: Node,
  classDeclaration: Node,
): boolean {
  const access = source.ast.parent(reference);
  if (
    access === undefined ||
    !source.ast.is.IsPropertyAccessExpression(access) ||
    source.ast.as.AsPropertyAccessExpression(access)?.Expression !== reference
  ) {
    return false;
  }
  const member = source.navigation.sourceReferenceFor(
    source.ast.as.AsPropertyAccessExpression(access)?.name,
  )?.declaration;
  const use = source.ast.parent(access);
  return member !== undefined &&
    source.ast.is.IsMethodDeclaration(member) &&
    source.ast.hasModifierKind(member, "static") &&
    source.ast.parent(member) === classDeclaration &&
    source.ast.kindName(use) !== "KindDeleteExpression" &&
    !program.hasBindingWrite(member);
}

function plainTypeReference(
  source: TargetSourceProgram,
  reference: Node,
): boolean {
  let current: Node | undefined = reference;
  while (current !== undefined) {
    if (source.ast.is.IsTypeQueryNode(current)) {
      return false;
    }
    if (source.ast.is.IsTypeReferenceNode(current)) {
      return true;
    }
    current = source.ast.parent(current);
  }
  return false;
}

function isModuleForwardingReference(
  source: TargetSourceProgram,
  reference: Node,
): boolean {
  const parent = source.ast.parent(reference);
  return source.ast.is.IsImportSpecifier(reference) ||
    source.ast.is.IsExportSpecifier(reference) ||
    parent !== undefined && (
      source.ast.is.IsImportSpecifier(parent) ||
      source.ast.is.IsExportSpecifier(parent)
    );
}

function hasDecorator(source: TargetSourceProgram, node: Node): boolean {
  return source.ast.modifiers(node).some((modifier) =>
    source.ast.is.IsDecorator(modifier)
  );
}
