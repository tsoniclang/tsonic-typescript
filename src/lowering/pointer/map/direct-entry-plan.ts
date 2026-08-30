import type { Node } from "@tsonic/tsts";
import {
  AsCallExpression,
  AsIfStatement,
  AsMethodDeclaration,
  AsParameterDeclaration,
  AsVariableDeclaration,
  AsVariableDeclarationList,
  AsVariableStatement,
  IsArrayTypeNode,
  IsBlock,
  IsCallExpression,
  IsClassDeclaration,
  IsIdentifier,
  IsIfStatement,
  IsMethodDeclaration,
  IsVariableDeclaration,
  IsVariableDeclarationList,
  IsVariableStatement,
} from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

export type DirectEntryMethodRole =
  | "remove-find"
  | "lookup"
  | "lookup-ok"
  | "store"
  | "delete"
  | "keys";

export interface DirectEntryMethodPlan {
  readonly methods: ReadonlyMap<Node, DirectEntryMethodRole>;
  readonly className: string;
  readonly storageName: string;
  readonly countName: string;
  readonly zeroValueName: string;
  readonly copyKeyName: string;
  readonly copyValueName: string;
  readonly lookupKeyName: string;
  readonly lookupEntryName: string;
  readonly lookupOkKeyName: string;
  readonly lookupOkEntryName: string;
  readonly storeKeyName: string;
  readonly storeValueName: string;
  readonly storeStorageName: string;
  readonly storeEntryName: string;
  readonly storeStorageDeclaration: Node;
  readonly storeNilGuard: Node;
  readonly deleteKeyName: string;
}

export function exactDirectEntryMethodPlan(
  source: TargetSourceProgram,
  classDeclaration: Node,
  constructorDeclaration: Node,
  storageParameter: Node,
  findMethod: Node,
  storeMethod: Node,
  deleteMethod: Node,
  hashMethod: Node,
  equalMethod: Node,
): DirectEntryMethodPlan | undefined {
  const className = identifierName(source, source.ast.name(classDeclaration));
  const constructorParameters = source.ast.parameters(constructorDeclaration);
  const zeroValueName = identifierName(
    source,
    source.ast.name(constructorParameters[0]),
  );
  const storageName = identifierName(source, source.ast.name(storageParameter));
  const countName = identifierName(
    source,
    source.ast.name(constructorParameters[2]),
  );
  if (
    className === undefined ||
    constructorParameters.length !== 3 ||
    zeroValueName === undefined ||
    storageName === undefined ||
    countName === undefined
  ) {
    return undefined;
  }

  const findCalls = callsToDeclaration(source, findMethod);
  if (findCalls.length !== 3) {
    return undefined;
  }
  const callers = new Map<Node, Node>();
  for (const call of findCalls) {
    const method = containingMethod(source, call);
    if (
      method === undefined ||
      source.ast.parent(method) !== classDeclaration ||
      source.ast.hasModifierKind(method, "static") ||
      callers.has(method)
    ) {
      return undefined;
    }
    callers.set(method, call);
  }
  if (!callers.has(deleteMethod)) {
    return undefined;
  }
  const valueCallers = [...callers].filter(([method]) => method !== deleteMethod);
  if (valueCallers.length !== 2) {
    return undefined;
  }
  const lookup = valueCallers.find(([method]) => methodStatements(source, method).length === 2);
  const lookupOk = valueCallers.find(([method]) => methodStatements(source, method).length === 3);
  if (
    lookup === undefined ||
    lookupOk === undefined ||
    lookup[0] === lookupOk[0]
  ) {
    return undefined;
  }
  const lookupBinding = exactCallBinding(source, lookup[0], lookup[1]);
  const lookupOkBinding = exactCallBinding(source, lookupOk[0], lookupOk[1]);
  const lookupKeyName = soleParameterName(source, lookup[0]);
  const lookupOkKeyName = soleParameterName(source, lookupOk[0]);
  const deleteKeyName = soleParameterName(source, deleteMethod);
  if (
    lookupBinding === undefined ||
    lookupOkBinding === undefined ||
    lookupKeyName === undefined ||
    lookupOkKeyName === undefined ||
    deleteKeyName === undefined
  ) {
    return undefined;
  }

  const storeParameters = source.ast.parameters(storeMethod);
  const storeKeyName = identifierName(source, source.ast.name(storeParameters[0]));
  const storeValueName = identifierName(source, source.ast.name(storeParameters[1]));
  const storeShape = exactStoreShape(source, storeMethod, storageParameter);
  if (
    storeParameters.length !== 2 ||
    storeKeyName === undefined ||
    storeValueName === undefined ||
    storeShape === undefined
  ) {
    return undefined;
  }
  const copyKeyName = exactCopyMethodName(
    source,
    classDeclaration,
    storeMethod,
    storeParameters[0],
    new Set([hashMethod, equalMethod]),
  );
  const copyValueName = exactCopyMethodName(
    source,
    classDeclaration,
    storeMethod,
    storeParameters[1],
    new Set([hashMethod, equalMethod]),
  );
  const keysMethod = exactKeysMethod(
    source,
    classDeclaration,
    storageParameter,
  );
  if (
    copyKeyName === undefined ||
    copyValueName === undefined ||
    keysMethod === undefined
  ) {
    return undefined;
  }

  const methods = new Map<Node, DirectEntryMethodRole>([
    [findMethod, "remove-find"],
    [lookup[0], "lookup"],
    [lookupOk[0], "lookup-ok"],
    [storeMethod, "store"],
    [deleteMethod, "delete"],
    [keysMethod, "keys"],
  ]);
  if (methods.size !== 6) {
    return undefined;
  }
  return Object.freeze({
    methods,
    className,
    storageName,
    countName,
    zeroValueName,
    copyKeyName,
    copyValueName,
    lookupKeyName,
    lookupEntryName: lookupBinding,
    lookupOkKeyName,
    lookupOkEntryName: lookupOkBinding,
    storeKeyName,
    storeValueName,
    storeStorageName: storeShape.storageName,
    storeEntryName: storeShape.entryName,
    storeStorageDeclaration: storeShape.storageDeclaration,
    storeNilGuard: storeShape.nilGuard,
    deleteKeyName,
  });
}

function exactStoreShape(
  source: TargetSourceProgram,
  method: Node,
  storageParameter: Node,
): {
  readonly entryName: string;
  readonly storageName: string;
  readonly storageDeclaration: Node;
  readonly nilGuard: Node;
} | undefined {
  const statements = methodStatements(source, method);
  const variableStatements = statements.filter(IsVariableStatement);
  if (statements.length !== 8 || variableStatements.length !== 3) {
    return undefined;
  }
  const storageStatement = variableStatements[0];
  const entryStatement = variableStatements[2];
  if (
    storageStatement === undefined ||
    entryStatement === undefined ||
    statements[0] !== storageStatement ||
    !containsDeclarationReference(source, storageStatement, storageParameter)
  ) {
    return undefined;
  }
  const nilGuard = statements[1];
  const parsedGuard = nilGuard === undefined || !IsIfStatement(nilGuard)
    ? undefined
    : AsIfStatement(nilGuard);
  const entryDeclaration = soleVariableDeclaration(entryStatement);
  const entryName = identifierName(source, source.ast.name(entryDeclaration));
  const storageDeclaration = soleVariableDeclaration(storageStatement);
  const storageName = identifierName(source, source.ast.name(storageDeclaration));
  if (
    nilGuard === undefined ||
    parsedGuard === undefined ||
    parsedGuard.ElseStatement !== undefined ||
    entryDeclaration === undefined ||
    entryName === undefined ||
    storageDeclaration === undefined ||
    storageName === undefined
  ) {
    return undefined;
  }
  return Object.freeze({
    entryName,
    storageName,
    storageDeclaration: storageStatement,
    nilGuard,
  });
}

function exactCallBinding(
  source: TargetSourceProgram,
  method: Node,
  call: Node,
): string | undefined {
  const declaration = source.ast.parent(call);
  const statement = declaration === undefined
    ? undefined
    : soleVariableStatement(source, declaration);
  const statements = methodStatements(source, method);
  return declaration !== undefined &&
      IsVariableDeclaration(declaration) &&
      AsVariableDeclaration(declaration)?.Initializer === call &&
      statement === statements[0]
    ? identifierName(source, source.ast.name(declaration))
    : undefined;
}

function exactCopyMethodName(
  source: TargetSourceProgram,
  classDeclaration: Node,
  storeMethod: Node,
  parameter: Node | undefined,
  excluded: ReadonlySet<Node>,
): string | undefined {
  if (parameter === undefined) {
    return undefined;
  }
  const declarations = new Set<Node>();
  visit(source, storeMethod, (node) => {
    const call = IsCallExpression(node) ? AsCallExpression(node) : undefined;
    const argument = call?.Arguments?.Nodes[0];
    const declaration = source.navigation.declarationFor(call?.Expression);
    if (
      call === undefined ||
      call.Arguments?.Nodes.length !== 1 ||
      argument === undefined ||
      source.navigation.sourceReferenceFor(argument)?.declaration !== parameter ||
      declaration === undefined ||
      excluded.has(declaration) ||
      source.ast.parent(declaration) !== classDeclaration ||
      !IsMethodDeclaration(declaration) ||
      !source.ast.hasModifierKind(declaration, "private") ||
      !source.ast.hasModifierKind(declaration, "static") ||
      source.ast.parameters(declaration).length !== 1
    ) {
      return;
    }
    declarations.add(declaration);
  });
  const declaration = declarations.size === 1 ? [...declarations][0] : undefined;
  return identifierName(source, source.ast.name(declaration));
}

function exactKeysMethod(
  source: TargetSourceProgram,
  classDeclaration: Node,
  storageParameter: Node,
): Node | undefined {
  const methods = new Set<Node>();
  for (const reference of source.navigation.referencesToDeclaration(storageParameter)) {
    const method = containingMethod(source, reference);
    const parsed = method === undefined ? undefined : AsMethodDeclaration(method);
    if (
      method !== undefined &&
      parsed !== undefined &&
      source.ast.parent(method) === classDeclaration &&
      !source.ast.hasModifierKind(method, "private") &&
      !source.ast.hasModifierKind(method, "static") &&
      source.ast.parameters(method).length === 0 &&
      parsed.Type !== undefined &&
      IsArrayTypeNode(parsed.Type)
    ) {
      methods.add(method);
    }
  }
  return methods.size === 1 ? [...methods][0] : undefined;
}

function methodStatements(source: TargetSourceProgram, method: Node): readonly Node[] {
  const body = AsMethodDeclaration(method)?.Body;
  return body !== undefined && IsBlock(body)
    ? source.ast.statements(body).filter((statement): statement is Node =>
        statement !== undefined
      )
    : [];
}

function soleParameterName(
  source: TargetSourceProgram,
  method: Node,
): string | undefined {
  const parameters = source.ast.parameters(method);
  return parameters.length === 1
    ? identifierName(source, AsParameterDeclaration(parameters[0])?.name)
    : undefined;
}

function soleVariableStatement(
  source: TargetSourceProgram,
  declaration: Node,
): Node | undefined {
  const list = source.ast.parent(declaration);
  const statement = list === undefined ? undefined : source.ast.parent(list);
  return list !== undefined &&
      statement !== undefined &&
      IsVariableDeclarationList(list) &&
      AsVariableDeclarationList(list)?.Declarations?.Nodes.length === 1 &&
      IsVariableStatement(statement)
    ? statement
    : undefined;
}

function soleVariableDeclaration(statement: Node): Node | undefined {
  const list = IsVariableStatement(statement)
    ? AsVariableStatement(statement)?.DeclarationList
    : undefined;
  const declarations = list !== undefined && IsVariableDeclarationList(list)
    ? AsVariableDeclarationList(list)?.Declarations?.Nodes ?? []
    : [];
  return declarations.length === 1 ? declarations[0] : undefined;
}

function callsToDeclaration(
  source: TargetSourceProgram,
  declaration: Node,
): readonly Node[] {
  const calls: Node[] = [];
  for (const reference of source.navigation.referencesToDeclaration(declaration)) {
    const parent = source.ast.parent(reference);
    const direct = parent !== undefined && IsCallExpression(parent) &&
        AsCallExpression(parent)?.Expression === reference
      ? parent
      : undefined;
    const access = direct === undefined ? parent : reference;
    const call = direct ?? (access === undefined ? undefined : source.ast.parent(access));
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

function containsDeclarationReference(
  source: TargetSourceProgram,
  root: Node,
  declaration: Node,
): boolean {
  let found = false;
  visit(source, root, (node) => {
    if (source.navigation.sourceReferenceFor(node)?.declaration === declaration) {
      found = true;
    }
  });
  return found;
}

function visit(
  source: TargetSourceProgram,
  root: Node,
  consume: (node: Node) => void,
): void {
  const pending = [root];
  while (pending.length !== 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    consume(node);
    for (const child of source.ast.children(node)) {
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
}

function identifierName(
  source: TargetSourceProgram,
  node: Node | undefined,
): string | undefined {
  return node !== undefined && IsIdentifier(node) ? source.ast.text(node) : undefined;
}
