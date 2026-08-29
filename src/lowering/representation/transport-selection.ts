import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { KindCallExpression } from "@tsonic/tsts/target-ast";

import type { PointerPlanningLedger } from "../pointer/planning-ledger.js";
import type { TargetProgramIndex } from "../program-index.js";
import {
  representationTransportCallableKey,
  type RepresentationTransportCallable,
  type RepresentationTransportContract,
} from "./transport-contract.js";

export function selectRepresentationTransportCalls(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  contract: RepresentationTransportContract,
  ledger: PointerPlanningLedger,
  sourceIdentityFor: (sourceFile: SourceFile) => string,
): ReadonlyMap<Node, ReadonlySet<Node>> {
  if (contract.callables.length === 0) {
    return new Map<Node, ReadonlySet<Node>>();
  }
  const certified = new Set(contract.callables
    .filter((callable) => callable.kind === "generic-kernel")
    .map(representationTransportCallableKey));
  const generatedDeclarations = collectGeneratedTransportDeclarations(
    source,
    program,
    contract,
    ledger,
    sourceIdentityFor,
  );
  const namespaceModules = collectNamespaceModules(source, ledger);
  const selected = new Map<Node, ReadonlySet<Node>>();
  for (const node of program.nodesOfKind(KindCallExpression)) {
    ledger.record("flow-census");
    const semantics = source.semantics.forNode(node);
    const info = semantics.operations.call(node);
    const selectedDeclaration = info?.sourceSelectedSignatureKind === "resolved"
      ? semantics.declarations.signatureDeclaration(info.selectedSignature)
      : undefined;
    if (selectedDeclaration === undefined || info === undefined) {
      continue;
    }
    if (generatedDeclarations.has(selectedDeclaration)) {
      const transportedParameters = representationTransportParameters(
        source,
        selectedDeclaration,
        info.sourceSelectedSignatureParameters.map((parameter) =>
          parameter.parameterDeclaration
        ),
        ledger,
      );
      if (transportedParameters.size !== 0) {
        selected.set(node, transportedParameters);
      }
      continue;
    }
    const call = source.ast.as.AsCallExpression(node);
    const target = call?.Expression;
    if (
      target === undefined ||
      !source.ast.is.IsPropertyAccessExpression(target)
    ) {
      continue;
    }
    const access = source.ast.as.AsPropertyAccessExpression(target);
    if (
      access?.Expression === undefined ||
      access.name === undefined ||
      !source.ast.is.IsIdentifier(access.Expression)
    ) {
      continue;
    }
    const sourceFile = source.ast.getSourceFile(node);
    const receiverReference = source.navigation.sourceReferenceFor(
      access.Expression,
    );
    const moduleSpecifiers = sourceFile === undefined ||
        receiverReference !== undefined
      ? undefined
      : namespaceModules.get(sourceFile)?.get(
          source.ast.text(access.Expression),
        );
    if (moduleSpecifiers === undefined) {
      continue;
    }
    const targetDeclaration = source.navigation.sourceReferenceFor(target)?.declaration;
    if (
      selectedDeclaration === undefined ||
      targetDeclaration !== selectedDeclaration
    ) {
      continue;
    }
    const exportName = source.ast.text(access.name);
    const matches = [...moduleSpecifiers].filter((moduleSpecifier) =>
      certified.has(representationTransportCallableKey({
        kind: "generic-kernel",
        moduleSpecifier,
        exportName,
      }))
    );
    if (matches.length > 1) {
      throw new Error(
        `representation transport call '${exportName}' has ambiguous certified module ownership`,
      );
    }
    if (matches.length === 1) {
      const transportedParameters = representationTransportParameters(
        source,
        selectedDeclaration,
        info.sourceSelectedSignatureParameters.map((parameter) =>
          parameter.parameterDeclaration
        ),
        ledger,
      );
      if (transportedParameters.size !== 0) {
        selected.set(node, transportedParameters);
      }
    }
  }
  return selected;
}

function collectGeneratedTransportDeclarations(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  contract: RepresentationTransportContract,
  ledger: PointerPlanningLedger,
  sourceIdentityFor: (sourceFile: SourceFile) => string,
): ReadonlySet<Node> {
  const generated = contract.callables.filter((callable) =>
    callable.kind !== "generic-kernel"
  );
  if (generated.length === 0) {
    return new Set<Node>();
  }
  const sourceFiles = new Map<string, SourceFile>();
  for (const sourceFile of program.sourceFiles) {
    ledger.record("flow-census");
    const identity = sourceIdentityFor(sourceFile);
    if (identity.length === 0 || sourceFiles.has(identity)) {
      throw new Error(
        `generated representation transport source identity '${identity}' is invalid`,
      );
    }
    sourceFiles.set(identity, sourceFile);
  }
  const declarations = new Set<Node>();
  for (const callable of generated) {
    ledger.record("flow-census");
    const sourceFile = sourceFiles.get(callable.sourcePath);
    if (sourceFile === undefined) {
      throw new Error(
        `generated representation transport source '${callable.sourcePath}' is not selected`,
      );
    }
    const declaration = generatedTransportDeclaration(
      source,
      program,
      sourceFile,
      callable,
      ledger,
    );
    if (source.ast.typeParameters(declaration).length === 0) {
      throw new Error(
        `generated representation transport '${callable.exportName}' is not generic`,
      );
    }
    if (declarations.has(declaration)) {
      throw new Error(
        `generated representation transport '${callable.exportName}' has duplicate declaration ownership`,
      );
    }
    declarations.add(declaration);
  }
  return declarations;
}

function generatedTransportDeclaration(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  sourceFile: SourceFile,
  callable: Exclude<RepresentationTransportCallable, { readonly kind: "generic-kernel" }>,
  ledger: PointerPlanningLedger,
): Node {
  const owners = program.nodesFor(sourceFile).filter((node) => {
    ledger.record("flow-census");
    return source.ast.parent(node) === sourceFile &&
      source.ast.text(source.ast.name(node)) === callable.exportName &&
      (callable.kind === "generated-generic-function-kernel"
        ? source.ast.is.IsFunctionDeclaration(node)
        : source.ast.is.IsClassDeclaration(node));
  });
  if (owners.length !== 1 || owners[0] === undefined) {
    throw new Error(
      `generated representation transport '${callable.exportName}' resolved ${owners.length} declarations`,
    );
  }
  if (callable.kind === "generated-generic-function-kernel") {
    return owners[0];
  }
  const members = source.ast.members(owners[0]).filter((member) => {
    ledger.record("flow-census");
    return member !== undefined && source.ast.is.IsMethodDeclaration(member) &&
      source.ast.text(source.ast.name(member)) === callable.memberName;
  });
  if (members.length !== 1 || members[0] === undefined) {
    throw new Error(
      `generated representation transport '${callable.exportName}.${callable.memberName}' resolved ${members.length} declarations`,
    );
  }
  return members[0];
}

function representationTransportParameters(
  source: TargetSourceProgram,
  selectedDeclaration: Node,
  parameters: readonly (Node | undefined)[],
  ledger: PointerPlanningLedger,
): ReadonlySet<Node> {
  const typeParameterNames = new Set<string>();
  for (const parameter of source.ast.typeParameters(selectedDeclaration)) {
    if (parameter !== undefined) {
      typeParameterNames.add(source.ast.text(source.ast.name(parameter)));
    }
  }
  if (typeParameterNames.size === 0) {
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
        typeParameterNames,
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
  typeParameterNames: ReadonlySet<string>,
  ledger: PointerPlanningLedger,
): boolean {
  if (root === undefined) {
    return false;
  }
  const evidence = inspectTypeParameterReferences(
    source,
    root,
    typeParameterNames,
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
  typeParameterNames: ReadonlySet<string>,
  ledger: PointerPlanningLedger,
): TypeParameterReferenceEvidence {
  ledger.record("flow-census");
  let owned = false;
  let nestedDeclaration = source.ast.is.IsTypeParameterDeclaration(root);
  if (source.ast.is.IsTypeReferenceNode(root)) {
    const typeName = source.ast.as.AsTypeReferenceNode(root)?.TypeName;
    owned =
      typeName !== undefined &&
      source.ast.is.IsIdentifier(typeName) &&
      typeParameterNames.has(source.ast.text(typeName));
  }
  for (const child of source.ast.children(root)) {
    if (child !== undefined) {
      const childEvidence = inspectTypeParameterReferences(
        source,
        child,
        typeParameterNames,
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
      if (statement !== undefined) {
        collectNamespaceModule(source, sourceFile, statement, result);
      }
    }
  }
  return result;
}

function collectNamespaceModule(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  statement: Node,
  result: Map<SourceFile, Map<string, Set<string>>>,
): void {
  const declaration = source.ast.as.AsImportDeclaration(statement);
  const clause = declaration?.ImportClause === undefined
    ? undefined
    : source.ast.as.AsImportClause(declaration.ImportClause);
  const binding = clause?.NamedBindings;
  if (
    binding === undefined ||
    !source.ast.is.IsNamespaceImport(binding) ||
    declaration?.ModuleSpecifier === undefined ||
    source.ast.getSourceFile(statement) !== sourceFile
  ) {
    return;
  }
  const name = source.ast.name(binding);
  if (name === undefined) {
    return;
  }
  const moduleSpecifier = source.ast.text(declaration.ModuleSpecifier);
  let byName = result.get(sourceFile);
  if (byName === undefined) {
    byName = new Map();
    result.set(sourceFile, byName);
  }
  const localName = source.ast.text(name);
  const existing = byName.get(localName);
  if (existing === undefined) {
    byName.set(localName, new Set([moduleSpecifier]));
  } else {
    existing.add(moduleSpecifier);
  }
}
