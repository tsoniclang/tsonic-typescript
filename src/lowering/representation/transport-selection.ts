import type { Node, SourceFile, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { KindCallExpression } from "@tsonic/tsts/target-ast";

import type { PointerPlanningLedger } from "../pointer/planning-ledger.js";
import type { TargetProgramIndex } from "../program-index.js";
import {
  type RepresentationTransportContract,
} from "./transport-contract.js";

export interface InlineRepresentationTransport {
  readonly memberName: string;
  readonly parameterCount: number;
}

export interface RepresentationTransportCall {
  readonly transportedParameters: ReadonlySet<Node>;
  readonly inline: InlineRepresentationTransport | undefined;
}

interface ImportedCallableIdentity {
  readonly moduleSpecifier: string;
  readonly exportName: string;
  readonly bindingDeclaration: Node;
}

export function selectRepresentationTransportCalls(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  contract: RepresentationTransportContract,
  ledger: PointerPlanningLedger,
): ReadonlyMap<Node, RepresentationTransportCall> {
  if (contract.callables.length === 0) {
    return new Map<Node, RepresentationTransportCall>();
  }
  const namespaceModules = collectNamespaceModules(source, ledger);
  const namedImports = collectNamedImports(source, ledger);
  const selected = new Map<Node, RepresentationTransportCall>();
  for (const node of program.nodesOfKind(KindCallExpression)) {
    ledger.record("flow-census");
    const call = source.ast.as.AsCallExpression(node);
    const target = call?.Expression;
    if (target === undefined) {
      continue;
    }
    const sourceFile = source.ast.getSourceFile(node);
    if (sourceFile === undefined) {
      continue;
    }
    const identities = importedCallableIdentities(
      source,
      sourceFile,
      target,
      namespaceModules,
      namedImports,
    );
    if (identities.length === 0) {
      continue;
    }
    const matches = contract.callables.filter((callable) =>
      identities.some((identity) =>
        identity.moduleSpecifier === callable.moduleSpecifier &&
        identity.exportName === callable.exportName
      )
    );
    if (matches.length > 1) {
      throw new Error("representation transport call has ambiguous certified ownership");
    }
    const callable = matches[0];
    if (callable === undefined) {
      continue;
    }
    const semantics = source.semantics.forNode(node);
    const info = semantics.operations.call(node);
    const selectedDeclaration = info?.sourceSelectedSignatureKind === "resolved"
      ? semantics.declarations.signatureDeclaration(info.selectedSignature)
      : undefined;
    if (selectedDeclaration === undefined || info === undefined) {
      continue;
    }
    if (
      source.ast.is.IsPropertyAccessExpression(target) &&
      source.navigation.sourceReferenceFor(target)?.declaration !==
        selectedDeclaration
    ) {
      continue;
    }
    const parameters = info.sourceSelectedSignatureParameters.map((parameter) =>
      parameter.parameterDeclaration
    );
    const transportedParameters = representationTransportParameters(
      source,
      selectedDeclaration,
      parameters,
      ledger,
    );
    if (transportedParameters.size === 0) {
      continue;
    }
    const inline = callable.kind === "inline-generic-method-call"
      ? inlineGenericMethodTransport(
          source,
          selectedDeclaration,
          parameters,
          transportedParameters,
        )
      : undefined;
    selected.set(node, Object.freeze({
      transportedParameters,
      inline,
    }));
  }
  return selected;
}

function importedCallableIdentities(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  target: Node,
  namespaceModules: ReadonlyMap<
    SourceFile,
    ReadonlyMap<string, ReadonlySet<string>>
  >,
  namedImports: ReadonlyMap<
    SourceFile,
    ReadonlyMap<string, readonly ImportedCallableIdentity[]>
  >,
): readonly ImportedCallableIdentity[] {
  if (source.ast.is.IsPropertyAccessExpression(target)) {
    const access = source.ast.as.AsPropertyAccessExpression(target);
    if (
      access?.Expression === undefined ||
      access.name === undefined ||
      !source.ast.is.IsIdentifier(access.Expression) ||
      source.navigation.sourceReferenceFor(access.Expression) !== undefined
    ) {
      return [];
    }
    const exportName = source.ast.text(access.name);
    return [...(namespaceModules.get(sourceFile)?.get(
      source.ast.text(access.Expression),
    ) ?? [])].map((moduleSpecifier) => Object.freeze({
      moduleSpecifier,
      exportName,
      bindingDeclaration: access.Expression as Node,
    }));
  }
  if (!source.ast.is.IsIdentifier(target)) {
    return [];
  }
  const declaration = source.navigation.sourceReferenceFor(target)?.declaration;
  if (declaration === undefined) {
    return [];
  }
  return (namedImports.get(sourceFile)?.get(source.ast.text(target)) ?? [])
    .filter((identity) => identity.bindingDeclaration === declaration);
}

function inlineGenericMethodTransport(
  source: TargetSourceProgram,
  declarationNode: Node,
  parameters: readonly (Node | undefined)[],
  transportedParameters: ReadonlySet<Node>,
): InlineRepresentationTransport {
  const declaration = source.ast.as.AsFunctionDeclaration(declarationNode);
  const parameterDeclarations = parameters.map((parameter) =>
    parameter === undefined
      ? undefined
      : source.ast.as.AsParameterDeclaration(parameter)
  );
  const body = declaration?.Body;
  const statements = body !== undefined && source.ast.is.IsBlock(body)
    ? source.ast.as.AsBlock(body)?.Statements?.Nodes ?? []
    : [];
  const statement = statements.length === 1
    ? source.ast.as.AsExpressionStatement(statements[0])
    : undefined;
  const bodyCall = statement?.Expression === undefined
    ? undefined
    : source.ast.as.AsCallExpression(statement.Expression);
  const access = bodyCall?.Expression === undefined ||
      !source.ast.is.IsPropertyAccessExpression(bodyCall.Expression)
    ? undefined
    : source.ast.as.AsPropertyAccessExpression(bodyCall.Expression);
  const bodyArguments = bodyCall?.Arguments?.Nodes ?? [];
  if (
    declaration === undefined ||
    declaration.AsteriskToken !== undefined ||
    source.ast.hasModifierKind(declarationNode, "async") ||
    parameters.length < 2 ||
    parameterDeclarations.some((parameter, index) =>
      parameter === undefined ||
      parameters[index] === undefined ||
      source.ast.parent(parameters[index]) !== declarationNode ||
      parameter.DotDotDotToken !== undefined ||
      parameter.QuestionToken !== undefined ||
      parameter.Initializer !== undefined ||
      source.ast.modifiers(parameters[index]).length !== 0
    ) ||
    transportedParameters.size !== parameters.length ||
    access?.Expression === undefined ||
    access.name === undefined ||
    !source.ast.is.IsIdentifier(access.Expression) ||
    !source.ast.is.IsIdentifier(access.name) ||
    access.QuestionDotToken !== undefined ||
    bodyCall?.QuestionDotToken !== undefined ||
    (bodyCall?.TypeArguments?.Nodes.length ?? 0) !== 0 ||
    bodyArguments.length !== parameters.length - 1 ||
    !referencesDeclaration(source, access.Expression, parameters[0]) ||
    bodyArguments.some((argument, index) =>
      argument === undefined ||
      !source.ast.is.IsIdentifier(argument) ||
      !referencesDeclaration(source, argument, parameters[index + 1])
    )
  ) {
    throw new Error(
      "inline representation transport must have one exact single generic method-call body",
    );
  }
  return Object.freeze({
    memberName: source.ast.text(access.name),
    parameterCount: parameters.length,
  });
}

function referencesDeclaration(
  source: TargetSourceProgram,
  reference: Node,
  declaration: Node | undefined,
): boolean {
  return declaration !== undefined &&
    source.navigation.sourceReferenceFor(reference)?.declaration === declaration;
}

function representationTransportParameters(
  source: TargetSourceProgram,
  selectedDeclaration: Node,
  parameters: readonly (Node | undefined)[],
  ledger: PointerPlanningLedger,
): ReadonlySet<Node> {
  const semantics = source.semantics.forNode(selectedDeclaration);
  const typeParameterTypes: Type[] = [];
  for (const parameter of source.ast.typeParameters(selectedDeclaration)) {
    const type = parameter === undefined
      ? undefined
      : semantics.declarations.declaredType(parameter);
    if (type !== undefined) {
      typeParameterTypes.push(type);
    }
  }
  if (typeParameterTypes.length === 0) {
    return new Set<Node>();
  }
  const result = new Set<Node>();
  for (const parameter of parameters) {
    ledger.record("flow-census");
    if (
      parameter !== undefined &&
      source.ast.parent(parameter) === selectedDeclaration &&
      referencesOwnedTypeParameter(
        source,
        source.ast.typeNode(parameter),
        typeParameterTypes,
        ledger,
      )
    ) {
      result.add(parameter);
    }
  }
  return result;
}

function referencesOwnedTypeParameter(
  source: TargetSourceProgram,
  root: Node | undefined,
  typeParameterTypes: readonly Type[],
  ledger: PointerPlanningLedger,
): boolean {
  if (root === undefined) {
    return false;
  }
  const evidence = inspectTypeParameterReferences(
    source,
    root,
    typeParameterTypes,
    ledger,
  );
  return evidence.owned && !evidence.nestedDeclaration;
}

interface TypeParameterReferenceEvidence {
  readonly owned: boolean;
  readonly nestedDeclaration: boolean;
}

function inspectTypeParameterReferences(
  source: TargetSourceProgram,
  root: Node,
  typeParameterTypes: readonly Type[],
  ledger: PointerPlanningLedger,
): TypeParameterReferenceEvidence {
  ledger.record("flow-census");
  let owned = false;
  let nestedDeclaration = source.ast.is.IsTypeParameterDeclaration(root);
  if (source.ast.is.IsTypeReferenceNode(root)) {
    const semantics = source.semantics.forNode(root);
    const selectedType = semantics.types.authoredType(root);
    owned = selectedType !== undefined && typeParameterTypes.some(
      (parameterType) => semantics.types.isIdentical(selectedType, parameterType),
    );
  }
  for (const child of source.ast.children(root)) {
    if (child !== undefined) {
      const childEvidence = inspectTypeParameterReferences(
        source,
        child,
        typeParameterTypes,
        ledger,
      );
      owned ||= childEvidence.owned;
      nestedDeclaration ||= childEvidence.nestedDeclaration;
    }
  }
  return { owned, nestedDeclaration };
}

function collectNamespaceModules(
  source: TargetSourceProgram,
  ledger: PointerPlanningLedger,
): ReadonlyMap<SourceFile, ReadonlyMap<string, ReadonlySet<string>>> {
  const result = new Map<SourceFile, Map<string, Set<string>>>();
  for (const sourceFile of source.navigation.sourceFiles) {
    for (const statement of sourceFile.Statements?.Nodes ?? []) {
      ledger.record("flow-census");
      if (!source.ast.is.IsImportDeclaration(statement)) {
        continue;
      }
      const declaration = source.ast.as.AsImportDeclaration(statement);
      const clause = declaration?.ImportClause === undefined
        ? undefined
        : source.ast.as.AsImportClause(declaration.ImportClause);
      const binding = clause?.NamedBindings;
      if (
        binding === undefined ||
        !source.ast.is.IsNamespaceImport(binding) ||
        declaration?.ModuleSpecifier === undefined
      ) {
        continue;
      }
      const name = source.ast.name(binding);
      if (name === undefined) {
        continue;
      }
      const byName = mapEntry(result, sourceFile, () => new Map());
      const modules = mapEntry(
        byName,
        source.ast.text(name),
        () => new Set<string>(),
      );
      modules.add(source.ast.text(declaration.ModuleSpecifier));
    }
  }
  return result;
}

function collectNamedImports(
  source: TargetSourceProgram,
  ledger: PointerPlanningLedger,
): ReadonlyMap<
  SourceFile,
  ReadonlyMap<string, readonly ImportedCallableIdentity[]>
> {
  const result = new Map<
    SourceFile,
    Map<string, ImportedCallableIdentity[]>
  >();
  for (const sourceFile of source.navigation.sourceFiles) {
    for (const statement of sourceFile.Statements?.Nodes ?? []) {
      ledger.record("flow-census");
      if (!source.ast.is.IsImportDeclaration(statement)) {
        continue;
      }
      const declaration = source.ast.as.AsImportDeclaration(statement);
      const clause = declaration?.ImportClause === undefined
        ? undefined
        : source.ast.as.AsImportClause(declaration.ImportClause);
      const binding = clause?.NamedBindings;
      if (
        binding === undefined ||
        !source.ast.is.IsNamedImports(binding) ||
        declaration?.ModuleSpecifier === undefined
      ) {
        continue;
      }
      for (const elementNode of source.ast.as.AsNamedImports(binding)?.Elements?.Nodes ?? []) {
        const element = source.ast.as.AsImportSpecifier(elementNode);
        const localName = source.ast.name(elementNode);
        if (
          element === undefined ||
          element.IsTypeOnly ||
          localName === undefined
        ) {
          continue;
        }
        const bindingDeclaration =
          source.navigation.sourceReferenceFor(localName)?.declaration ??
            elementNode;
        const identity = Object.freeze({
          moduleSpecifier: source.ast.text(declaration.ModuleSpecifier),
          exportName: source.ast.text(element.PropertyName ?? localName),
          bindingDeclaration,
        });
        const byName = mapEntry(result, sourceFile, () => new Map());
        const entries = mapEntry(
          byName,
          source.ast.text(localName),
          () => [] as ImportedCallableIdentity[],
        );
        entries.push(identity);
      }
    }
  }
  return result;
}

function mapEntry<K, V>(
  map: Map<K, V>,
  key: K,
  create: () => V,
): V {
  const existing = map.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const value = create();
  map.set(key, value);
  return value;
}
