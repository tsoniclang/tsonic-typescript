import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";

import {
  callableDeclarationSynchronousReturnTypes,
  callableReturnRewrite,
  callableReturnRewriteAdmitsDirectValue,
  selectedCallableReturnType,
  type CallableReturnRewrite,
} from "../../../model/callable-contract.js";
import {
  callableDeclarationHasResolvableType,
} from "../../../model/callable-contract/resolution.js";
import {
  referenceHasExactSemantics,
  resolveProjectInvocation,
} from "../../../model/project-invocation.js";
import {
  exactCallExpression,
  exactCallableTarget,
  transparentExpression,
} from "../../../model/syntax.js";
import {
  sameSelectedType,
  typeMaySuspend,
} from "../../../model/synchronous.js";
import {
  sameValueAlternatives,
} from "../../value/alternatives.js";
import type { CallableContext } from "../provenance-flow.js";
import type { CallableValueResolution } from "../value-resolution.js";
import type {
  CallableReturnContractSourceKind,
} from "./return-contracts.js";

export type CallableExpressionResolution = (
  expression: Node,
) => CallableValueResolution | undefined;

export interface CallableContractSourceRequirement {
  readonly resolvable: boolean;
  readonly candidateDependencies: readonly Node[];
  readonly contractDependencies: readonly Node[];
}

export type CallableCallContractRequirement = CallableContractSourceRequirement;

export function callableCallContractRequirement(
  call: Node,
  context: CallableContext,
  callResolutions: ReadonlyMap<Node, CallableValueResolution>,
  expressionResolution: CallableExpressionResolution,
): CallableCallContractRequirement {
  return collectCallRequirement(
    call,
    context,
    callResolutions,
    expressionResolution,
    new Set(),
  );
}

function collectCallRequirement(
  call: Node,
  context: CallableContext,
  callResolutions: ReadonlyMap<Node, CallableValueResolution>,
  expressionResolution: CallableExpressionResolution,
  pending: Set<Node>,
): CallableCallContractRequirement {
  const { source } = context;
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
  if (rewrite !== undefined) {
    const resolution = callResolutions.get(call);
    if (
      resolution !== undefined &&
      exactCandidateResultsMatchContract(context, resolution, rewrite)
    ) {
      return Object.freeze({
        resolvable: true,
        candidateDependencies: Object.freeze([
          ...resolution.dependencyNodes(),
        ]),
        contractDependencies: emptyNodes,
      });
    }
    if (callableReturnRewriteAdmitsDirectValue(source, rewrite)) {
      return Object.freeze({
        resolvable: true,
        candidateDependencies: emptyNodes,
        contractDependencies: Object.freeze([rewrite.target]),
      });
    }
  }
  const implementation = resolveProjectInvocation(source, call)?.implementation;
  const projected = context.results.sourceFor(call);
  if (
    implementation === undefined ||
    declaration !== implementation ||
    projected?.resultOwner !== implementation ||
    source.ast.body(implementation) === undefined ||
    source.ast.typeNode(implementation) !== undefined ||
    pending.has(implementation)
  ) {
    return unresolvedCallRequirement;
  }
  pending.add(implementation);
  const requirement = mergeRequirements(projected.expressions.map((expression) =>
    expression === undefined
      ? unresolvedRequirement
      : collectRequirement(
          expression,
          "call-result",
          context,
          callResolutions,
          expressionResolution,
          pending,
        )
  ));
  pending.delete(implementation);
  return requirement;
}

function exactCandidateResultsMatchContract(
  context: CallableContext,
  resolution: CallableValueResolution,
  selected: CallableReturnRewrite,
): boolean {
  if (
    !resolution.closed ||
    resolution.dependencyCount === 0 ||
    resolution.synchronousDeclarationCount !== 0
  ) {
    return false;
  }
  const selectedNode = selectedCallableReturnType(
    context.source,
    selected.target,
    selected.selection,
  );
  const selectedSemantics = selectedNode === undefined
    ? undefined
    : context.source.semantics.forNode(selectedNode);
  const selectedType = selectedNode === undefined
    ? undefined
    : selectedSemantics?.types.authoredType(selectedNode);
  if (selectedSemantics === undefined || selectedType === undefined) {
    return false;
  }
  for (const declaration of resolution.dependencyNodes()) {
    if (!context.candidates.has(declaration)) {
      return false;
    }
    const returnType = context.source.ast.typeNode(declaration);
    const rewrite = returnType === undefined
      ? undefined
      : callableReturnRewrite(context.source, returnType);
    const directNode = rewrite === undefined
      ? undefined
      : selectedCallableReturnType(
          context.source,
          rewrite.target,
          rewrite.selection,
        );
    const directType = directNode === undefined
      ? undefined
      : context.source.semantics.forNode(directNode).types.authoredType(
          directNode,
        );
    if (
      rewrite === undefined ||
      !sameSelectedType(selectedSemantics, selectedType, directType)
    ) {
      return false;
    }
  }
  return true;
}

export function callableContractSourceRequirement(
  expression: Node,
  sourceKind: CallableReturnContractSourceKind,
  context: CallableContext,
  callResolutions: ReadonlyMap<Node, CallableValueResolution>,
  expressionResolution: CallableExpressionResolution,
): CallableContractSourceRequirement {
  return collectRequirement(
    expression,
    sourceKind,
    context,
    callResolutions,
    expressionResolution,
    new Set(),
  );
}

function collectRequirement(
  expression: Node,
  sourceKind: CallableReturnContractSourceKind,
  context: CallableContext,
  callResolutions: ReadonlyMap<Node, CallableValueResolution>,
  expressionResolution: CallableExpressionResolution,
  pending: Set<Node>,
): CallableContractSourceRequirement {
  const root = transparentExpression(context.source, expression);
  if (root === undefined || pending.has(root)) {
    return unresolvedRequirement;
  }
  if (
    sourceKind === "call-result" &&
    expressionResultIsDefinitelyNonThenable(context.source, root)
  ) {
    return resolvedRequirement;
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
        collectRequirement(
          alternative,
          sourceKind,
          context,
          callResolutions,
          expressionResolution,
          pending,
        )
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
    if (result !== undefined && result.returnTypes.length !== 0) {
      return contractRequirement(
        result.returnTypes.map((rewrite) => rewrite.target),
      );
    }
    const call = context.source.ast.is.IsCallExpression(root)
      ? root
      : exactCallExpression(
          context.source,
          context.source.ast.as.AsAwaitExpression(root)?.Expression,
        );
    return call === undefined
      ? unresolvedRequirement
      : callSourceRequirement(
          call,
          context,
          callResolutions,
          expressionResolution,
          pending,
        );
  }
  const resolution = expressionResolution(root);
  if (resolution?.closed === true) {
    return Object.freeze({
      resolvable: true,
      candidateDependencies: Object.freeze([
        ...resolution.dependencyNodes(),
      ]),
      contractDependencies: emptyNodes,
    });
  }
  const reference = context.source.navigation.sourceReferenceFor(root);
  if (!referenceHasExactSemantics(context.source, reference)) {
    return unresolvedRequirement;
  }
  return declarationRequirement(reference.declaration, context);
}

function expressionResultIsDefinitelyNonThenable(
  source: TargetSourceProgram,
  expression: Node,
): boolean {
  const semantics = source.semantics.forNode(expression);
  const type = semantics.types.expressionType(expression);
  return type !== undefined && !typeMaySuspend(semantics, type);
}

function callSourceRequirement(
  call: Node,
  context: CallableContext,
  callResolutions: ReadonlyMap<Node, CallableValueResolution>,
  expressionResolution: CallableExpressionResolution,
  pending: Set<Node>,
): CallableContractSourceRequirement {
  const resolution = callResolutions.get(call);
  const contract = collectCallRequirement(
    call,
    context,
    callResolutions,
    expressionResolution,
    pending,
  );
  const target = exactCallableTarget(
    context.source,
    context.source.ast.as.AsCallExpression(call)?.Expression,
  );
  const reference = context.source.navigation.sourceReferenceFor(target);
  const sourceContractIsResolvable =
    referenceHasExactSemantics(context.source, reference) &&
    callableDeclarationHasResolvableType(
      context.source,
      reference.declaration,
    );
  return Object.freeze({
    resolvable: resolution?.closed === true &&
      (contract.resolvable || sourceContractIsResolvable),
    candidateDependencies: Object.freeze(resolution === undefined
      ? contract.candidateDependencies
      : [
          ...new Set([
            ...resolution.dependencyNodes(),
            ...contract.candidateDependencies,
          ]),
        ]),
    contractDependencies: contract.contractDependencies,
  });
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
  candidateDependencies: emptyNodes,
  contractDependencies: emptyNodes,
});
const unresolvedCallRequirement: CallableCallContractRequirement = Object.freeze({
  resolvable: false,
  candidateDependencies: emptyNodes,
  contractDependencies: emptyNodes,
});
