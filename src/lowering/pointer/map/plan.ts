import type {
  Node,
  PointerOperationFact,
  SourceFile,
} from "@tsonic/tsts";
import {
  AsCallExpression,
  AsConstructorDeclaration,
  AsMethodDeclaration,
  AsNewExpression,
  AsParameterDeclaration,
  AsReturnStatement,
  AsVariableDeclaration,
  AsVariableDeclarationList,
  IsBlock,
  IsCallExpression,
  IsClassDeclaration,
  IsConstructorDeclaration,
  IsIdentifier,
  IsMethodDeclaration,
  IsNewExpression,
  IsReturnStatement,
  IsVariableDeclaration,
  IsVariableDeclarationList,
  IsVariableStatement,
} from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type {
  GeneratedBindingName,
  ProgramGeneratedNames,
} from "../../generated-names.js";
import type { PointerTypedFactLedger } from "../flow-fact-ledger.js";
import type { PointerFlowRepresentation } from "../flow-representation.js";
import type { PointerPlanningLedger } from "../planning-ledger.js";

export interface CanonicalPointerKeyMapPlan {
  readonly classDeclaration: Node;
  readonly sourceFile: SourceFile;
  readonly helperName: GeneratedBindingName;
  readonly constructorDeclaration: Node;
  readonly storageParameter: Node;
  readonly storageConstruction: Node;
  readonly hashMethod: Node;
  readonly equalMethod: Node;
  readonly hashCallReplacements: ReadonlyMap<Node, Node>;
  readonly equalCallReplacements: readonly Node[];
  readonly hashVariableStatement: Node;
  readonly hashVariableReferenceReplacements: ReadonlyMap<Node, string>;
}

export type CanonicalPointerKeyMapRewrite =
  | { readonly kind: "constructor"; readonly plan: CanonicalPointerKeyMapPlan }
  | { readonly kind: "storage-construction"; readonly plan: CanonicalPointerKeyMapPlan }
  | { readonly kind: "remove-hash-method"; readonly plan: CanonicalPointerKeyMapPlan }
  | { readonly kind: "remove-equal-method"; readonly plan: CanonicalPointerKeyMapPlan }
  | { readonly kind: "replace-hash-call"; readonly plan: CanonicalPointerKeyMapPlan; readonly expression: Node }
  | { readonly kind: "replace-equal-call"; readonly plan: CanonicalPointerKeyMapPlan }
  | { readonly kind: "remove-hash-variable"; readonly plan: CanonicalPointerKeyMapPlan }
  | { readonly kind: "replace-hash-reference"; readonly plan: CanonicalPointerKeyMapPlan; readonly name: string };

export interface CanonicalPointerKeyMapPlans {
  rewriteFor(node: Node): CanonicalPointerKeyMapRewrite | undefined;
  classesFor(sourceFile: SourceFile): readonly CanonicalPointerKeyMapPlan[];
  readonly count: number;
}

interface CandidateOperations {
  hash?: Extract<PointerOperationFact, { readonly operation: "hash-pointer" }>;
  hashMethod?: Node;
  equal?: Extract<PointerOperationFact, { readonly operation: "equal-pointer" }>;
  equalMethod?: Node;
}

interface MethodCalls {
  readonly method: Node;
  readonly hashCalls: readonly Node[];
  readonly equalCalls: readonly Node[];
}

const noPlans = Object.freeze([]) as readonly CanonicalPointerKeyMapPlan[];

export function planCanonicalPointerKeyMaps(
  source: TargetSourceProgram,
  facts: PointerTypedFactLedger,
  generatedNames: ProgramGeneratedNames,
  representationFor: (node: Node | undefined) => PointerFlowRepresentation,
  ledger: PointerPlanningLedger,
): CanonicalPointerKeyMapPlans {
  const candidates = new Map<Node, CandidateOperations>();
  const rejectedClasses = new Set<Node>();
  const helperNames = new Map<SourceFile, GeneratedBindingName>();
  for (const entry of facts.operationEntries) {
    ledger.record("representation");
    const operation = entry.fact;
    if (
      operation.operation !== "hash-pointer" &&
      operation.operation !== "equal-pointer"
    ) {
      continue;
    }
    if (representationFor(operation.call) !== "location") {
      continue;
    }
    const method = exactOperationMethod(source, operation);
    const classDeclaration = method === undefined
      ? undefined
      : source.ast.parent(method);
    if (
      method === undefined ||
      classDeclaration === undefined ||
      !IsClassDeclaration(classDeclaration)
    ) {
      continue;
    }
    if (rejectedClasses.has(classDeclaration)) {
      continue;
    }
    const candidate = candidates.get(classDeclaration) ?? {};
    if (operation.operation === "hash-pointer") {
      if (candidate.hash !== undefined) {
        candidates.delete(classDeclaration);
        rejectedClasses.add(classDeclaration);
        continue;
      }
      candidate.hash = operation;
      candidate.hashMethod = method;
    } else {
      if (candidate.equal !== undefined) {
        candidates.delete(classDeclaration);
        rejectedClasses.add(classDeclaration);
        continue;
      }
      candidate.equal = operation;
      candidate.equalMethod = method;
    }
    candidates.set(classDeclaration, candidate);
  }

  const selected: CanonicalPointerKeyMapPlan[] = [];
  for (const [classDeclaration, candidate] of candidates) {
    ledger.record("representation");
    const plan = completeMapPlan(
      source,
      generatedNames,
      helperNames,
      classDeclaration,
      candidate,
    );
    if (plan !== undefined) {
      selected.push(plan);
    }
  }
  selected.sort((left, right) =>
    source.ast.pos(left.classDeclaration) - source.ast.pos(right.classDeclaration)
  );

  const rewrites = new Map<Node, CanonicalPointerKeyMapRewrite>();
  const byFile = new Map<SourceFile, CanonicalPointerKeyMapPlan[]>();
  for (const plan of selected) {
    addRewrite(rewrites, plan.constructorDeclaration, {
      kind: "constructor",
      plan,
    });
    addRewrite(rewrites, plan.storageConstruction, {
      kind: "storage-construction",
      plan,
    });
    addRewrite(rewrites, plan.hashMethod, {
      kind: "remove-hash-method",
      plan,
    });
    addRewrite(rewrites, plan.equalMethod, {
      kind: "remove-equal-method",
      plan,
    });
    addRewrite(rewrites, plan.hashVariableStatement, {
      kind: "remove-hash-variable",
      plan,
    });
    for (const [call, expression] of plan.hashCallReplacements) {
      addRewrite(rewrites, call, {
        kind: "replace-hash-call",
        plan,
        expression,
      });
    }
    for (const call of plan.equalCallReplacements) {
      addRewrite(rewrites, call, {
        kind: "replace-equal-call",
        plan,
      });
    }
    for (const [reference, name] of plan.hashVariableReferenceReplacements) {
      addRewrite(rewrites, reference, {
        kind: "replace-hash-reference",
        plan,
        name,
      });
    }
    const filePlans = byFile.get(plan.sourceFile);
    if (filePlans === undefined) {
      byFile.set(plan.sourceFile, [plan]);
    } else {
      filePlans.push(plan);
    }
  }
  return Object.freeze({
    rewriteFor(node: Node): CanonicalPointerKeyMapRewrite | undefined {
      return rewrites.get(node);
    },
    classesFor(sourceFile: SourceFile): readonly CanonicalPointerKeyMapPlan[] {
      return byFile.get(sourceFile) ?? noPlans;
    },
    count: selected.length,
  });
}

function completeMapPlan(
  source: TargetSourceProgram,
  generatedNames: ProgramGeneratedNames,
  helperNames: Map<SourceFile, GeneratedBindingName>,
  classDeclaration: Node,
  candidate: CandidateOperations,
): CanonicalPointerKeyMapPlan | undefined {
  const { hashMethod, equalMethod } = candidate;
  if (
    candidate.hash === undefined ||
    candidate.equal === undefined ||
    hashMethod === undefined ||
    equalMethod === undefined
  ) {
    return undefined;
  }
  const hashCalls = callsToDeclaration(source, hashMethod);
  const equalCalls = callsToDeclaration(source, equalMethod);
  if (hashCalls.length !== 3 || equalCalls.length !== 2) {
    return undefined;
  }
  const methodCalls = groupMethodCalls(source, classDeclaration, hashCalls, equalCalls);
  if (methodCalls === undefined) {
    return undefined;
  }
  const find = methodCalls.find((entry) =>
    entry.hashCalls.length === 1 &&
    entry.equalCalls.length === 1 &&
    source.ast.parameters(entry.method).length === 1 &&
    source.ast.hasModifierKind(entry.method, "private")
  );
  const store = methodCalls.find((entry) =>
    entry.hashCalls.length === 1 &&
    entry.equalCalls.length === 1 &&
    source.ast.parameters(entry.method).length === 2 &&
    !source.ast.hasModifierKind(entry.method, "private")
  );
  const deleteMethod = methodCalls.find((entry) =>
    entry.hashCalls.length === 1 &&
    entry.equalCalls.length === 0 &&
    source.ast.parameters(entry.method).length === 1 &&
    !source.ast.hasModifierKind(entry.method, "private")
  );
  if (
    find === undefined ||
    store === undefined ||
    deleteMethod === undefined ||
    new Set([find.method, store.method, deleteMethod.method]).size !== 3
  ) {
    return undefined;
  }
  const constructorDeclaration = soleConstructor(source, classDeclaration);
  const constructor = constructorDeclaration !== undefined &&
      IsConstructorDeclaration(constructorDeclaration)
    ? AsConstructorDeclaration(constructorDeclaration)
    : undefined;
  const constructorParameters = constructor?.Parameters?.Nodes ?? [];
  const storageParameter = constructorParameters[1];
  if (
    constructorDeclaration === undefined ||
    constructor === undefined ||
    constructorParameters.length !== 3 ||
    storageParameter === undefined ||
    !validStorageParameter(source, storageParameter)
  ) {
    return undefined;
  }
  const storageConstruction = soleStorageConstruction(source, classDeclaration);
  if (storageConstruction === undefined) {
    return undefined;
  }
  const storeHashCall = store.hashCalls[0];
  const storeKey = source.ast.parameters(store.method)[0];
  const hashVariable = storeHashCall === undefined
    ? undefined
    : source.ast.parent(storeHashCall);
  const hashVariableStatement = hashVariable === undefined
    ? undefined
    : soleVariableStatement(source, hashVariable);
  const keyNameNode = source.ast.name(storeKey);
  if (
    storeHashCall === undefined ||
    storeKey === undefined ||
    hashVariable === undefined ||
    hashVariableStatement === undefined ||
    !IsVariableDeclaration(hashVariable) ||
    AsVariableDeclaration(hashVariable)?.Initializer !== storeHashCall ||
    keyNameNode === undefined ||
    !IsIdentifier(keyNameNode) ||
    !callArgumentReferencesDeclaration(source, storeHashCall, storeKey)
  ) {
    return undefined;
  }
  const keyName = source.ast.text(keyNameNode);
  const hashVariableReferences = source.navigation.referencesToDeclaration(
    hashVariable,
  );
  if (
    hashVariableReferences.length < 2 ||
    hashVariableReferences.some((reference) =>
      containingMethod(source, reference) !== store.method
    )
  ) {
    return undefined;
  }
  const directHashCalls = hashCalls.filter((call) => call !== storeHashCall);
  if (
    directHashCalls.length !== 2 ||
    directHashCalls.some((call) =>
      AsCallExpression(call)?.Arguments?.Nodes.length !== 1
    )
  ) {
    return undefined;
  }
  const sourceFile = source.ast.getSourceFile(classDeclaration);
  if (sourceFile === undefined || source.ast.isDeclarationFile(sourceFile)) {
    return undefined;
  }
  const hashCallReplacements = new Map<Node, Node>();
  for (const call of directHashCalls) {
    const expression = AsCallExpression(call)?.Arguments?.Nodes[0];
    if (expression === undefined) {
      return undefined;
    }
    hashCallReplacements.set(call, expression);
  }
  let helperName = helperNames.get(sourceFile);
  if (helperName === undefined) {
    helperName = generatedNames.forFile(sourceFile).reserve("$PointerMapStorage");
    helperNames.set(sourceFile, helperName);
  }
  return Object.freeze({
    classDeclaration,
    sourceFile,
    helperName,
    constructorDeclaration,
    storageParameter,
    storageConstruction,
    hashMethod,
    equalMethod,
    hashCallReplacements,
    equalCallReplacements: Object.freeze([...equalCalls]),
    hashVariableStatement,
    hashVariableReferenceReplacements: new Map(
      hashVariableReferences.map((reference) => [reference, keyName] as const),
    ),
  });
}

function exactOperationMethod(
  source: TargetSourceProgram,
  operation: PointerOperationFact,
): Node | undefined {
  const statement = source.ast.parent(operation.call);
  if (statement === undefined || !IsReturnStatement(statement)) {
    return undefined;
  }
  const body = statement === undefined ? undefined : source.ast.parent(statement);
  if (body === undefined || !IsBlock(body)) {
    return undefined;
  }
  const method = body === undefined ? undefined : source.ast.parent(body);
  if (method === undefined || !IsMethodDeclaration(method)) {
    return undefined;
  }
  const parsed = AsMethodDeclaration(method);
  const statements = source.ast.statements(body);
  const returned = AsReturnStatement(statement);
  const parameterCount = operation.operation === "hash-pointer" ? 1 : 2;
  return parsed !== undefined &&
      statements.length === 1 &&
      returned?.Expression === operation.call &&
      parsed.TypeParameters === undefined &&
      source.ast.parameters(method).length === parameterCount &&
      source.ast.hasModifierKind(method, "private") &&
      source.ast.hasModifierKind(method, "static")
    ? method
    : undefined;
}

function callsToDeclaration(
  source: TargetSourceProgram,
  declaration: Node,
): readonly Node[] {
  const calls: Node[] = [];
  for (const reference of source.navigation.referencesToDeclaration(declaration)) {
    const parent = source.ast.parent(reference);
    const directCall = parent !== undefined && IsCallExpression(parent) &&
        AsCallExpression(parent)?.Expression === reference
      ? parent
      : undefined;
    const access = directCall === undefined ? parent : reference;
    const call = directCall ??
      (access === undefined ? undefined : source.ast.parent(access));
    if (
      call !== undefined &&
      IsCallExpression(call) &&
      AsCallExpression(call)?.Expression === access
    ) {
      calls.push(call);
    }
  }
  return Object.freeze(calls);
}

function groupMethodCalls(
  source: TargetSourceProgram,
  classDeclaration: Node,
  hashCalls: readonly Node[],
  equalCalls: readonly Node[],
): readonly MethodCalls[] | undefined {
  const grouped = new Map<Node, { hashCalls: Node[]; equalCalls: Node[] }>();
  for (const [kind, calls] of [
    ["hash", hashCalls],
    ["equal", equalCalls],
  ] as const) {
    for (const call of calls) {
      const method = containingMethod(source, call);
      if (
        method === undefined ||
        source.ast.parent(method) !== classDeclaration ||
        source.ast.hasModifierKind(method, "static")
      ) {
        return undefined;
      }
      const entry = grouped.get(method) ?? { hashCalls: [], equalCalls: [] };
      entry[kind === "hash" ? "hashCalls" : "equalCalls"].push(call);
      grouped.set(method, entry);
    }
  }
  return Object.freeze([...grouped].map(([method, calls]) => Object.freeze({
    method,
    hashCalls: Object.freeze(calls.hashCalls),
    equalCalls: Object.freeze(calls.equalCalls),
  })));
}

function containingMethod(
  source: TargetSourceProgram,
  node: Node,
): Node | undefined {
  let current = source.ast.parent(node);
  while (current !== undefined && !IsClassDeclaration(current)) {
    if (IsMethodDeclaration(current)) {
      return current;
    }
    current = source.ast.parent(current);
  }
  return undefined;
}

function soleConstructor(
  source: TargetSourceProgram,
  classDeclaration: Node,
): Node | undefined {
  const constructors = source.ast.members(classDeclaration).filter(
    (member): member is Node => member !== undefined && IsConstructorDeclaration(member),
  );
  return constructors.length === 1 ? constructors[0] : undefined;
}

function validStorageParameter(
  source: TargetSourceProgram,
  parameter: Node,
): boolean {
  const parsed = AsParameterDeclaration(parameter);
  return parsed !== undefined &&
    parsed.Type !== undefined &&
    parsed.Initializer === undefined &&
    parsed.DotDotDotToken === undefined &&
    parsed.QuestionToken === undefined &&
    IsIdentifier(parsed.name) &&
    source.ast.hasModifierKind(parameter, "private") &&
    source.ast.hasModifierKind(parameter, "readonly");
}

function soleStorageConstruction(
  source: TargetSourceProgram,
  classDeclaration: Node,
): Node | undefined {
  const constructions: Node[] = [];
  for (const reference of source.navigation.referencesToDeclaration(classDeclaration)) {
    const parent = source.ast.parent(reference);
    const construction = parent !== undefined && IsNewExpression(parent)
      ? AsNewExpression(parent)
      : undefined;
    if (
      construction?.Expression !== reference ||
      construction.Arguments?.Nodes.length !== 3 ||
      construction.Arguments.Nodes[1] === undefined ||
      !IsNewExpression(construction.Arguments.Nodes[1]) ||
      parent === undefined ||
      containingMethod(source, parent) === undefined
    ) {
      continue;
    }
    const storage = construction.Arguments.Nodes[1];
    const storageNew = AsNewExpression(storage);
    if (
      storageNew?.Arguments !== undefined &&
      storageNew.Arguments.Nodes.length !== 0
    ) {
      continue;
    }
    constructions.push(storage);
  }
  return constructions.length === 1 ? constructions[0] : undefined;
}

function soleVariableStatement(
  source: TargetSourceProgram,
  declaration: Node,
): Node | undefined {
  const listNode = source.ast.parent(declaration);
  const statement = listNode === undefined ? undefined : source.ast.parent(listNode);
  if (
    listNode === undefined ||
    statement === undefined ||
    !IsVariableDeclarationList(listNode) ||
    !IsVariableStatement(statement)
  ) {
    return undefined;
  }
  const list = AsVariableDeclarationList(listNode);
  return list !== undefined &&
      IsVariableStatement(statement) &&
      list?.Declarations?.Nodes.length === 1
    ? statement
    : undefined;
}

function callArgumentReferencesDeclaration(
  source: TargetSourceProgram,
  call: Node,
  declaration: Node,
): boolean {
  const argument = AsCallExpression(call)?.Arguments?.Nodes[0];
  return argument !== undefined &&
    source.navigation.sourceReferenceFor(argument)?.declaration === declaration;
}

function addRewrite(
  rewrites: Map<Node, CanonicalPointerKeyMapRewrite>,
  node: Node,
  rewrite: CanonicalPointerKeyMapRewrite,
): void {
  if (rewrites.has(node)) {
    throw new Error("canonical pointer-key map assigned one node two rewrites");
  }
  rewrites.set(node, Object.freeze(rewrite));
}
