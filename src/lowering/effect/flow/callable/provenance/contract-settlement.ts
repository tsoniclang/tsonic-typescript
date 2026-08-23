import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";

import {
  callableDeclarationSynchronousReturnTypes,
  callableReturnRewrite,
  callableReturnRewriteAdmitsDirectValue,
} from "../../../model/callable-contract.js";
import {
  referenceHasExactSemantics,
} from "../../../model/project-invocation.js";
import {
  transparentExpression,
} from "../../../model/syntax.js";
import {
  typeMaySuspend,
} from "../../../model/synchronous.js";
import {
  sameValueAlternatives,
} from "../../value/alternatives.js";
import type { CallableContext } from "../provenance-flow.js";

export interface CallableContractSourceRequirement {
  readonly resolvable: boolean;
  readonly candidateDependencies: readonly Node[];
  readonly contractDependencies: readonly Node[];
}

export interface CallableCallContractRequirement {
  readonly resolvable: boolean;
  readonly contractDependencies: readonly Node[];
}

export function callableCallContractRequirement(
  source: TargetSourceProgram,
  call: Node,
): CallableCallContractRequirement {
  const semantics = source.semantics.forNode(call);
  const result = semantics.types.expressionType(call);
  if (result !== undefined && !typeMaySuspend(semantics, result)) {
    return resolvedCallRequirement;
  }
  const signature = semantics.operations.call(call)?.selectedSignature;
  const declaration = signature === undefined
    ? undefined
    : semantics.declarations.signatureDeclaration(signature);
  const returnType = declaration === undefined
    ? undefined
    : source.ast.typeNode(declaration);
  const rewrite = returnType === undefined
    ? undefined
    : callableReturnRewrite(source, returnType);
  return rewrite !== undefined &&
      callableReturnRewriteAdmitsDirectValue(source, rewrite)
    ? Object.freeze({
        resolvable: true,
        contractDependencies: Object.freeze([rewrite.target]),
      })
    : unresolvedCallRequirement;
}

export function callableContractSourceRequirement(
  expression: Node,
  context: CallableContext,
): CallableContractSourceRequirement {
  return collectRequirement(expression, context, new Set());
}

function collectRequirement(
  expression: Node,
  context: CallableContext,
  pending: Set<Node>,
): CallableContractSourceRequirement {
  const root = transparentExpression(context.source, expression);
  if (root === undefined || pending.has(root)) {
    return unresolvedRequirement;
  }
  if (callableValueTypeIsSynchronous(context.source, root)) {
    return resolvedRequirement;
  }
  const alternatives = sameValueAlternatives(context.source, root);
  if (alternatives === null) {
    return unresolvedRequirement;
  }
  if (alternatives !== undefined) {
    pending.add(root);
    const result = mergeRequirements(
      alternatives.map((alternative) =>
        collectRequirement(alternative, context, pending)
      ),
    );
    pending.delete(root);
    return result;
  }
  const semantics = context.source.semantics.forNode(root);
  const type = semantics.types.expressionType(root);
  if (type !== undefined && semantics.types.isNullish(type)) {
    return resolvedRequirement;
  }
  if (
    context.source.ast.is.IsArrowFunction(root) ||
    context.source.ast.is.IsFunctionExpression(root)
  ) {
    return declarationRequirement(root, context);
  }
  if (
    context.source.ast.is.IsCallExpression(root) ||
    context.source.ast.is.IsAwaitExpression(root)
  ) {
    const result = context.results.resultFor(root);
    return result === undefined || result.returnTypes.length === 0
      ? unresolvedRequirement
      : contractRequirement(result.returnTypes.map((rewrite) => rewrite.target));
  }
  const reference = context.source.navigation.sourceReferenceFor(root);
  if (!referenceHasExactSemantics(context.source, reference)) {
    return unresolvedRequirement;
  }
  return declarationRequirement(reference.declaration, context);
}

function declarationRequirement(
  declaration: Node,
  context: CallableContext,
): CallableContractSourceRequirement {
  if (context.candidates.has(declaration)) {
    return Object.freeze({
      resolvable: true,
      candidateDependencies: Object.freeze([declaration]),
      contractDependencies: emptyNodes,
    });
  }
  const rewrites = callableDeclarationSynchronousReturnTypes(
    context.source,
    declaration,
  );
  return rewrites === undefined || rewrites.length === 0
    ? unresolvedRequirement
    : contractRequirement(rewrites.map((rewrite) => rewrite.target));
}

function callableValueTypeIsSynchronous(
  source: TargetSourceProgram,
  expression: Node,
): boolean {
  const semantics = source.semantics.forNode(expression);
  const type = semantics.types.expressionType(expression);
  return type !== undefined && callableTypeIsSynchronous(
    semantics,
    type,
    new Set(),
  );
}

function callableTypeIsSynchronous(
  semantics: SourceFileSemantics,
  type: Type,
  pending: Set<Type>,
): boolean {
  if (pending.has(type)) {
    return false;
  }
  if (semantics.types.isNullish(type)) {
    return true;
  }
  if (semantics.types.isUnion(type) || semantics.types.isIntersection(type)) {
    pending.add(type);
    let callable = false;
    for (const member of semantics.types.unionOrIntersectionTypes(type)) {
      if (member === undefined) {
        pending.delete(type);
        return false;
      }
      if (semantics.types.isNullish(member)) {
        continue;
      }
      if (!callableTypeIsSynchronous(semantics, member, pending)) {
        pending.delete(type);
        return false;
      }
      callable = true;
    }
    pending.delete(type);
    return callable;
  }
  const signatures = semantics.types.callSignatures(type);
  return signatures.length !== 0 && signatures.every((signature) => {
    const result = semantics.types.returnType(signature);
    return result !== undefined && !typeMaySuspend(semantics, result);
  });
}

function contractRequirement(
  dependencies: readonly Node[],
): CallableContractSourceRequirement {
  return Object.freeze({
    resolvable: true,
    candidateDependencies: emptyNodes,
    contractDependencies: Object.freeze([...new Set(dependencies)]),
  });
}

function mergeRequirements(
  requirements: readonly CallableContractSourceRequirement[],
): CallableContractSourceRequirement {
  return Object.freeze({
    resolvable: requirements.every((requirement) => requirement.resolvable),
    candidateDependencies: Object.freeze([
      ...new Set(requirements.flatMap((requirement) =>
        requirement.candidateDependencies
      )),
    ]),
    contractDependencies: Object.freeze([
      ...new Set(requirements.flatMap((requirement) =>
        requirement.contractDependencies
      )),
    ]),
  });
}

const emptyNodes: readonly Node[] = Object.freeze([]);
const resolvedRequirement: CallableContractSourceRequirement = Object.freeze({
  resolvable: true,
  candidateDependencies: emptyNodes,
  contractDependencies: emptyNodes,
});
const unresolvedRequirement: CallableContractSourceRequirement = Object.freeze({
  resolvable: false,
  candidateDependencies: emptyNodes,
  contractDependencies: emptyNodes,
});
const resolvedCallRequirement: CallableCallContractRequirement = Object.freeze({
  resolvable: true,
  contractDependencies: emptyNodes,
});
const unresolvedCallRequirement: CallableCallContractRequirement = Object.freeze({
  resolvable: false,
  contractDependencies: emptyNodes,
});
