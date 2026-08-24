import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  KindAwaitExpression,
  KindReturnStatement,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../program-index.js";
import type { CooperativeEffectCandidate } from "../inventory/candidates.js";
import { blockCooperativeEffect } from "../closure/retention.js";
import type { DeclaredInterfaceDispatch } from "../flow/interface/dispatch.js";
import type { ReturnValueFlow } from "../flow/return/value.js";
import {
  directContainingCall,
  exactCallExpression,
  isModuleForwardingReference,
} from "../model/syntax.js";
import type { CallableValueFlow } from "../flow/callable/value-flow.js";
import { isCallableNonEscapingObservation } from "../flow/callable/input-reference.js";
import { connectCooperativeEffectDependency } from "../closure/dependency.js";
import { classifyReturnedExpression } from "./classification/returned-expression.js";
import type { ConditionalProviderEffectFlow } from "../flow/provider/conditional.js";
import type { ExactSourceBodyInspection } from "../model/source-membership.js";
import { resolvedCallProducesDefinitelySynchronousValue } from "../model/synchronous.js";
import { enclosingCooperativeCandidate } from "./classification/owner.js";

const noDependencies: readonly Node[] = Object.freeze([]);

export function classifyCooperativeEffectProgram(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  calls: ReadonlyMap<Node, CooperativeEffectCandidate>,
  interfaces: DeclaredInterfaceDispatch,
  valueFlow: CallableValueFlow,
  returnFlow: ReturnValueFlow,
  providers: ConditionalProviderEffectFlow,
  conditionalSettlements: (dependencies: Iterable<Node>) =>
    ReadonlySet<Node> | undefined,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
): void {
  for (const node of program.nodesOfKind(KindAwaitExpression)) {
    classifyAwaitDependencies(
      source,
      candidates,
      calls,
      interfaces,
      valueFlow,
      returnFlow,
      providers,
      conditionalSettlements,
      bodyInspectionIsCertified,
      node,
    );
  }
  for (const node of program.nodesOfKind(KindReturnStatement)) {
    classifyReturnDependencies(
      source,
      candidates,
      calls,
      interfaces,
      valueFlow,
      returnFlow,
      conditionalSettlements,
      bodyInspectionIsCertified,
      node,
    );
  }
  for (const candidate of candidates.values()) {
    const body = source.ast.is.IsArrowFunction(candidate.declaration)
      ? source.ast.body(candidate.declaration)
      : undefined;
    if (body !== undefined && !source.ast.is.IsBlock(body)) {
      classifyReturnedExpression(
        source,
        candidates,
        calls,
        interfaces,
        valueFlow,
        returnFlow,
        conditionalSettlements,
        bodyInspectionIsCertified,
        candidate,
        body,
      );
    }
  }
  for (const candidate of candidates.values()) {
    for (
      const reference of source.navigation.referencesToDeclaration(
        candidate.declaration,
      )
    ) {
      if (
        reference === source.ast.name(candidate.declaration) ||
        isModuleForwardingReference(source, reference) ||
        isCallableNonEscapingObservation(source, reference) ||
        valueFlow.allowsCallableReference(reference)
      ) {
        continue;
      }
      const call = directContainingCall(source, reference);
      if (call === undefined || calls.get(call) !== candidate) {
        blockCooperativeEffect(candidate, "escaping-callable", reference);
      }
    }
  }
  for (const candidate of candidates.values()) {
    if (
      (source.ast.is.IsArrowFunction(candidate.declaration) ||
        source.ast.is.IsFunctionExpression(candidate.declaration)) &&
      !valueFlow.allowsCallableReference(candidate.declaration) &&
      directContainingCall(source, candidate.declaration) === undefined
    ) {
      blockCooperativeEffect(
        candidate,
        "escaping-callable",
        candidate.declaration,
      );
    }
  }
}

export function collectSettledCooperativeAwaits(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  calls: ReadonlyMap<Node, CooperativeEffectCandidate>,
  interfaces: DeclaredInterfaceDispatch,
  valueFlow: CallableValueFlow,
  returnFlow: ReturnValueFlow,
  providers: ConditionalProviderEffectFlow,
  optimized: ReadonlySet<Node>,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
): ReadonlySet<Node> {
  const awaits = new Set<Node>();
  for (const node of program.nodesOfKind(KindAwaitExpression)) {
    const expression = source.ast.as.AsAwaitExpression(node)?.Expression;
    if (expression === undefined) {
      continue;
    }
    const call = exactCallExpression(
      source,
      expression,
    );
    if (call === undefined) {
      const returned = returnFlow.resolutionFor(expression);
      if (
        returned.closed &&
        !hasRetainedDependency(returned.dependencyNodes(), candidates, optimized)
      ) {
        awaits.add(node);
      }
      continue;
    }
    const provider = providers.forCall(call);
    if (provider !== undefined) {
      const resolution = providers.resolutionFor(call);
      if (
        resolution !== undefined &&
        !hasRetainedDependency(
          resolution.dependencyNodes(),
          candidates,
          optimized,
        )
      ) {
        awaits.add(node);
      }
      continue;
    }
    const direct = calls.get(call);
    const family = interfaces.calls.get(call);
    if (interfaces.callIsRejected(call)) {
      continue;
    }
    if (
      direct === undefined &&
      family === undefined &&
      resolvedCallProducesDefinitelySynchronousValue(
        source,
        call,
        bodyInspectionIsCertified,
      )
    ) {
      awaits.add(node);
      continue;
    }
    const resolution = direct === undefined
      ? valueFlow.resolutionFor(call)
      : undefined;
    const contract = direct === undefined && family === undefined
      ? valueFlow.contractForCall(call)
      : undefined;
    const dependencies: Iterable<Node> = direct === undefined
      ? resolution?.dependencyNodes() ?? noDependencies
      : [direct.declaration];
    if (
      (direct === undefined &&
        family === undefined &&
        (resolution === undefined || !resolution.closed ||
          contract === undefined || !contract.closed)) ||
      (family !== undefined && !interfaces.callIsSettled(call, optimized)) ||
      hasRetainedDependency(dependencies, candidates, optimized) ||
      (contract !== undefined && hasRetainedDependency(
        contract.dependencyNodes(),
        candidates,
        optimized,
      )) ||
      (direct === undefined &&
        family === undefined &&
        resolution !== undefined &&
        resolution.synchronousDeclarationCount !== 0 &&
        !returnFlow.callResultIsDefinitelyNonThenable(
          call,
          resolution.synchronousDeclarationNodes(),
          optimized,
        ))
    ) {
      continue;
    }
    awaits.add(node);
  }
  return awaits;
}

function classifyAwaitDependencies(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  calls: ReadonlyMap<Node, CooperativeEffectCandidate>,
  interfaces: DeclaredInterfaceDispatch,
  valueFlow: CallableValueFlow,
  returnFlow: ReturnValueFlow,
  providers: ConditionalProviderEffectFlow,
  conditionalSettlements: (dependencies: Iterable<Node>) =>
    ReadonlySet<Node> | undefined,
  bodyInspectionIsCertified: ExactSourceBodyInspection | undefined,
  node: Node,
): void {
  if (!source.ast.is.IsAwaitExpression(node)) {
    return;
  }
  const owner = enclosingCooperativeCandidate(source, candidates, node);
  if (owner === undefined) {
    return;
  }
  const expression = source.ast.as.AsAwaitExpression(node)?.Expression;
  const call = exactCallExpression(source, expression);
  const dependency = call === undefined ? undefined : calls.get(call);
  if (call !== undefined && dependency !== undefined) {
    connectCooperativeEffectDependency(
      owner,
      dependency,
      "callable-invocation",
      call,
    );
    return;
  }
  const family = call === undefined ? undefined : interfaces.calls.get(call);
  if (call !== undefined && family !== undefined) {
    interfaces.addDependencies(
      owner,
      family,
      "callable-invocation",
      call,
    );
    return;
  }
  if (call !== undefined && interfaces.callIsRejected(call)) {
    blockCooperativeEffect(owner, "unresolved-call", call);
    return;
  }
  if (
    call !== undefined &&
    resolvedCallProducesDefinitelySynchronousValue(
      source,
      call,
      bodyInspectionIsCertified,
    )
  ) {
    return;
  }
  const provider = providers.forCall(call);
  if (provider !== undefined && call !== undefined) {
    const resolution = providers.resolutionFor(call);
    if (resolution === undefined) {
      blockCooperativeEffect(owner, "unresolved-call", call);
      return;
    }
    for (const declaration of resolution.dependencyNodes()) {
      const candidate = candidates.get(declaration);
      if (candidate === undefined) {
        blockCooperativeEffect(owner, "unresolved-call", call);
        return;
      }
      connectCooperativeEffectDependency(
        owner,
        candidate,
        "callable-invocation",
        call,
      );
    }
    return;
  }
  if (call === undefined) {
    const resolution = expression === undefined
      ? undefined
      : returnFlow.resolutionFor(expression);
    if (resolution === undefined || !resolution.closed) {
      blockCooperativeEffect(
        owner,
        "unresolved-call",
        expression ?? node,
      );
      return;
    }
    for (const declaration of resolution.dependencyNodes()) {
      const candidate = candidates.get(declaration);
      if (candidate === undefined) {
        blockCooperativeEffect(owner, "unresolved-call", expression ?? node);
        return;
      }
      connectCooperativeEffectDependency(
        owner,
        candidate,
        "result-consumption",
        expression ?? node,
      );
    }
    return;
  }
  const resolution = valueFlow.resolutionFor(call);
  if (resolution === undefined || !resolution.closed) {
    blockCooperativeEffect(
      owner,
      "unresolved-call",
      call ?? expression ?? node,
    );
    return;
  }
  const contract = valueFlow.contractForCall(call);
  if (contract === undefined || !contract.closed) {
    blockCooperativeEffect(owner, "unresolved-call", call);
    return;
  }
  for (const declaration of resolution.dependencyNodes()) {
    const candidate = candidates.get(declaration);
    if (candidate === undefined) {
      blockCooperativeEffect(owner, "unresolved-call", call);
      return;
    }
    connectCooperativeEffectDependency(
      owner,
      candidate,
      "callable-invocation",
      call,
    );
  }
  for (const declaration of contract.dependencyNodes()) {
    const candidate = candidates.get(declaration);
    if (candidate === undefined) {
      blockCooperativeEffect(owner, "unresolved-call", call);
      return;
    }
    connectCooperativeEffectDependency(
      owner,
      candidate,
      "callable-invocation",
      call,
    );
  }
  if (
    resolution.synchronousDeclarationCount !== 0 &&
    !returnFlow.callResultIsDefinitelyNonThenable(
      call,
      resolution.synchronousDeclarationNodes(),
      conditionalSettlements([
        ...resolution.dependencyNodes(),
        ...contract.dependencyNodes(),
      ]),
    )
  ) {
    blockCooperativeEffect(owner, "promise-observed", call);
  }
}

function classifyReturnDependencies(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  calls: ReadonlyMap<Node, CooperativeEffectCandidate>,
  interfaces: DeclaredInterfaceDispatch,
  valueFlow: CallableValueFlow,
  returnFlow: ReturnValueFlow,
  conditionalSettlements: (dependencies: Iterable<Node>) =>
    ReadonlySet<Node> | undefined,
  bodyInspectionIsCertified: ExactSourceBodyInspection | undefined,
  node: Node,
): void {
  if (!source.ast.is.IsReturnStatement(node)) {
    return;
  }
  const owner = enclosingCooperativeCandidate(source, candidates, node);
  if (owner === undefined) {
    return;
  }
  const expression = source.ast.as.AsReturnStatement(node)?.Expression;
  if (expression === undefined) {
    if (
      owner.innerType === undefined ||
      !source.semantics.forNode(node).types.isVoidLike(owner.innerType)
    ) {
      blockCooperativeEffect(owner, "incompatible-return", node);
    }
    return;
  }
  classifyReturnedExpression(
    source,
    candidates,
    calls,
    interfaces,
    valueFlow,
    returnFlow,
    conditionalSettlements,
    bodyInspectionIsCertified,
    owner,
    expression,
  );
}

function hasRetainedDependency(
  dependencies: Iterable<Node>,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  optimized: ReadonlySet<Node>,
): boolean {
  for (const declaration of dependencies) {
    if (candidates.has(declaration) && !optimized.has(declaration)) {
      return true;
    }
  }
  return false;
}
