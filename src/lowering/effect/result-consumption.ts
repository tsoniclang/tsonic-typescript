import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  KindCallExpression,
  KindIdentifier,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";
import {
  callableDispatchIsClosed,
  containingAwait,
  containingReturn,
  directContainingCall,
  isDiscardedCall,
  isFunctionLike,
  isModuleForwardingReference,
} from "./syntax.js";

export interface CooperativeResultConsumption {
  returnedCallHasClosedConsumers(call: Node): boolean;
  evidence(): CooperativeResultConsumptionEvidence;
}

export interface CooperativeResultConsumptionEvidence {
  readonly callEntries: number;
  readonly referenceEntries: number;
  readonly ownerEvaluations: number;
  readonly consumerEdges: number;
}

export function createCooperativeResultConsumption(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  candidates: ReadonlySet<Node>,
): CooperativeResultConsumption {
  let indexes: ResultConsumptionIndexes | undefined;
  const ownerResults = new Map<Node, boolean>();
  let ownerEvaluations = 0;
  let consumerEdges = 0;
  return Object.freeze({
    returnedCallHasClosedConsumers(call: Node): boolean {
      const returned = containingReturn(source, call);
      const owner = returned === undefined
        ? undefined
        : containingFunction(source, returned);
      if (owner === undefined || candidates.has(owner)) {
        return false;
      }
      indexes ??= createIndexes(source, program);
      return ownerResultHasClosedConsumers(
          source,
          program,
          owner,
          candidates,
          indexes.callsByDeclaration,
          indexes.referencesByDeclaration,
          ownerResults,
          new Set(),
          () => {
            ownerEvaluations += 1;
          },
          () => {
            consumerEdges += 1;
          },
      );
    },
    evidence(): CooperativeResultConsumptionEvidence {
      return Object.freeze({
        callEntries: indexes?.callEntries ?? 0,
        referenceEntries: indexes?.referenceEntries ?? 0,
        ownerEvaluations,
        consumerEdges,
      });
    },
  });
}

interface ResultConsumptionIndexes {
  readonly callEntries: number;
  readonly referenceEntries: number;
  readonly callsByDeclaration: ReadonlyMap<Node, readonly Node[]>;
  readonly referencesByDeclaration: ReadonlyMap<Node, readonly Node[]>;
}

function createIndexes(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ResultConsumptionIndexes {
  const callNodes = program.nodesOfKind(KindCallExpression);
  const referenceNodes = program.nodesOfKind(KindIdentifier);
  return Object.freeze({
    callEntries: callNodes.length,
    referenceEntries: referenceNodes.length,
    callsByDeclaration: indexCallsByDeclaration(source, callNodes),
    referencesByDeclaration: indexReferencesByDeclaration(
      source,
      referenceNodes,
    ),
  });
}

function ownerResultHasClosedConsumers(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  owner: Node,
  candidates: ReadonlySet<Node>,
  callsByDeclaration: ReadonlyMap<Node, readonly Node[]>,
  referencesByDeclaration: ReadonlyMap<Node, readonly Node[]>,
  ownerResults: Map<Node, boolean>,
  pending: Set<Node>,
  recordOwnerEvaluation: () => void,
  recordConsumerEdge: () => void,
): boolean {
  const existing = ownerResults.get(owner);
  if (existing !== undefined) {
    return existing;
  }
  if (pending.has(owner)) {
    return true;
  }
  recordOwnerEvaluation();
  if (!isInspectablePrivateForwarder(source, program, owner)) {
    ownerResults.set(owner, false);
    return false;
  }
  const calls = callsByDeclaration.get(owner) ?? [];
  if (!allReferencesAreIndexedCalls(
    source,
    referencesByDeclaration.get(owner) ?? [],
    owner,
    new Set(calls),
  )) {
    ownerResults.set(owner, false);
    return false;
  }
  pending.add(owner);
  const result = calls.every((call) => {
    recordConsumerEdge();
    return callResultHasClosedConsumer(
      source,
      program,
      call,
      candidates,
      callsByDeclaration,
      referencesByDeclaration,
      ownerResults,
      pending,
      recordOwnerEvaluation,
      recordConsumerEdge,
    );
  });
  pending.delete(owner);
  ownerResults.set(owner, result);
  return result;
}

function callResultHasClosedConsumer(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  call: Node,
  candidates: ReadonlySet<Node>,
  callsByDeclaration: ReadonlyMap<Node, readonly Node[]>,
  referencesByDeclaration: ReadonlyMap<Node, readonly Node[]>,
  ownerResults: Map<Node, boolean>,
  pending: Set<Node>,
  recordOwnerEvaluation: () => void,
  recordConsumerEdge: () => void,
): boolean {
  if (
    containingAwait(source, call) !== undefined ||
    isDiscardedCall(source, call)
  ) {
    return true;
  }
  const returned = containingReturn(source, call);
  const owner = returned === undefined
    ? undefined
    : containingFunction(source, returned);
  if (owner === undefined) {
    return false;
  }
  if (candidates.has(owner)) {
    return true;
  }
  return ownerResultHasClosedConsumers(
    source,
    program,
    owner,
    candidates,
    callsByDeclaration,
    referencesByDeclaration,
    ownerResults,
    pending,
    recordOwnerEvaluation,
    recordConsumerEdge,
  );
}

function indexCallsByDeclaration(
  source: TargetSourceProgram,
  calls: readonly Node[],
): ReadonlyMap<Node, readonly Node[]> {
  const mutable = new Map<Node, Node[]>();
  for (const call of calls) {
    const semantics = source.semantics.forNode(call);
    const declaration = semantics.getSignatureDeclaration(
      semantics.getResolvedSignature(call),
    );
    if (
      declaration === undefined ||
      !source.navigation.isProjectDeclaration(declaration)
    ) {
      continue;
    }
    const calls = mutable.get(declaration);
    if (calls === undefined) {
      mutable.set(declaration, [call]);
    } else {
      calls.push(call);
    }
  }
  return new Map([...mutable].map(([declaration, calls]) => [
    declaration,
    Object.freeze(calls),
  ]));
}

function allReferencesAreIndexedCalls(
  source: TargetSourceProgram,
  references: readonly Node[],
  declaration: Node,
  calls: ReadonlySet<Node>,
): boolean {
  const name = source.ast.name(declaration);
  for (const node of references) {
    if (node === name) {
      continue;
    }
    if (isModuleForwardingReference(source, node)) {
      return false;
    }
    const call = directContainingCall(source, node);
    if (call === undefined || !calls.has(call)) {
      return false;
    }
  }
  return true;
}

function indexReferencesByDeclaration(
  source: TargetSourceProgram,
  references: readonly Node[],
): ReadonlyMap<Node, readonly Node[]> {
  const mutable = new Map<Node, Node[]>();
  for (const node of references) {
    const declaration = source.navigation.sourceReferenceFor(node)?.declaration;
    if (declaration === undefined) {
      continue;
    }
    const references = mutable.get(declaration);
    if (references === undefined) {
      mutable.set(declaration, [node]);
    } else {
      references.push(node);
    }
  }
  return new Map([...mutable].map(([declaration, references]) => [
    declaration,
    Object.freeze(references),
  ]));
}

function isInspectablePrivateForwarder(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  declaration: Node,
): boolean {
  if (
    !source.ast.is.IsFunctionDeclaration(declaration) ||
    source.ast.body(declaration) === undefined ||
    source.ast.hasModifierKind(declaration, "async") ||
    source.ast.hasModifierKind(declaration, "export") ||
    source.ast.hasModifierKind(declaration, "default") ||
    !callableDispatchIsClosed(source, program, declaration)
  ) {
    return false;
  }
  return source.ast.as.AsFunctionDeclaration(declaration)?.AsteriskToken ===
    undefined;
}

function containingFunction(
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
  return undefined;
}
