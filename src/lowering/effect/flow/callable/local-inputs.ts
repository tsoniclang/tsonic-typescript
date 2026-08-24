import type { Node, Symbol } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { KindVariableDeclaration } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { CallableInputUseContract } from "./input-use.js";
import type { ExactInvocationInputIndex } from "../invocation/inputs.js";
import { exactAssignmentInput } from "../storage/assignment.js";

import {
  callableDeclarationHasExactCallableType,
  callableDeclarationHasResolvableType,
} from "../../model/callable-contract/resolution.js";
import {
  isCallableNonEscapingObservation,
  trackedInputDestination,
  transportedCallableDestinations,
} from "./input-reference.js";
import {
  directContainingCall,
  isModuleForwardingReference,
} from "../../model/syntax.js";
import {
  sourceBodyInspectionIsExact,
  type ExactSourceBodyInspection,
} from "../../model/source-membership.js";
import { declarationIsExported } from "../../model/declaration-surface.js";

interface ReferenceCounts {
  total: number;
  admitted: number;
}

export function collectCallableLocals(
  source: TargetSourceProgram,
  excluded: ReadonlySet<Node>,
  program: TargetProgramIndex,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
  allowExportedDeclarations: boolean = false,
): Map<Node, Node[]> {
  const locals = new Map<Node, Node[]>();
  for (const node of program.nodesOfKind(KindVariableDeclaration)) {
    const name = source.ast.name(node);
    const initializer = source.ast.is.IsVariableDeclaration(node)
      ? source.ast.as.AsVariableDeclaration(node)?.Initializer
      : undefined;
    if (
      !source.ast.is.IsIdentifier(name) ||
      excluded.has(node) ||
      (!allowExportedDeclarations && declarationIsExported(source, node)) ||
      !sourceBodyInspectionIsExact(
        source,
        node,
        bodyInspectionIsCertified,
      ) ||
      (!callableDeclarationHasResolvableType(source, node) &&
        !callableDeclarationHasExactCallableType(source, node))
    ) {
      continue;
    }
    locals.set(node, initializer === undefined ? [] : [initializer]);
  }
  return locals;
}

export function auditCallableLocalUse(
  source: TargetSourceProgram,
  reference: Node,
  local: Node,
  counts: ReferenceCounts,
  values: Map<Node, Node[]>,
  storageDeclarations: ReadonlySet<Node>,
  storageSymbols: ReadonlyMap<Symbol, Node>,
  destinations: Map<Node, Set<Node>>,
  inputUses?: CallableInputUseContract,
  invocationInputs?: ExactInvocationInputIndex,
  callableReferenceIsClosed?: (reference: Node) => boolean,
  allowModuleForwarding: boolean = false,
): void {
  if (!source.ast.is.IsIdentifier(reference)) {
    return;
  }
  if (
    reference === source.ast.name(local) ||
    isTypeOnlyReference(source, reference)
  ) {
    return;
  }
  counts.total += 1;
  if (isModuleForwardingReference(source, reference)) {
    if (allowModuleForwarding) {
      counts.admitted += 1;
    }
    return;
  }
  const assigned = exactAssignedValue(source, reference);
  if (assigned !== undefined) {
    append(values, local, assigned);
    counts.admitted += 1;
    return;
  }
  const destination = trackedInputDestination(
    source,
    reference,
    storageDeclarations,
    storageSymbols,
  );
  const transported = transportedCallableDestinations(
    source,
    reference,
    storageDeclarations,
    storageSymbols,
    inputUses,
  );
  const invocationDestinations = invocationInputs?.parametersFor(reference)
    ?.filter((parameter) => storageDeclarations.has(parameter)) ?? [];
  if (
    directContainingCall(source, reference) !== undefined ||
    callableReferenceIsClosed?.(reference) === true ||
    isCallableNonEscapingObservation(source, reference) ||
    destination !== undefined ||
    transported !== undefined ||
    invocationDestinations.length !== 0
  ) {
    counts.admitted += 1;
    if (destination !== undefined) {
      appendSet(destinations, local, destination);
    }
    for (const transportedDestination of transported ?? []) {
      appendSet(destinations, local, transportedDestination);
    }
    for (const invocationDestination of invocationDestinations) {
      appendSet(destinations, local, invocationDestination);
    }
  }
}

function exactAssignedValue(
  source: TargetSourceProgram,
  reference: Node,
): Node | undefined {
  const parent = source.ast.parent(reference);
  return parent === undefined
    ? undefined
    : exactAssignmentInput(source, parent, reference);
}

function isTypeOnlyReference(source: TargetSourceProgram, node: Node): boolean {
  let current: Node | undefined = node;
  while (current !== undefined) {
    if (source.ast.is.IsTypeReferenceNode(current)) {
      return true;
    }
    if (
      source.ast.is.IsExpressionStatement(current) ||
      source.ast.is.IsVariableDeclaration(current) ||
      source.ast.is.IsCallExpression(current) ||
      source.ast.is.IsNewExpression(current) ||
      source.ast.is.IsClassDeclaration(current) ||
      source.ast.is.IsSourceFile(current)
    ) {
      return false;
    }
    current = source.ast.parent(current);
  }
  return false;
}

function append(target: Map<Node, Node[]>, key: Node, value: Node): void {
  const values = target.get(key);
  if (values === undefined) {
    target.set(key, [value]);
  } else {
    values.push(value);
  }
}

function appendSet(target: Map<Node, Set<Node>>, key: Node, value: Node): void {
  const values = target.get(key);
  if (values === undefined) {
    target.set(key, new Set([value]));
  } else {
    values.add(value);
  }
}
