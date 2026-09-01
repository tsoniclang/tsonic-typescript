import type { Node, SourceFile } from "@tsonic/tsts";
import {
  tsonicAttributeBuilderFactKey,
  type TsonicAttributeApplicationFact,
} from "@tsonic/source-core/facts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

export interface SourceAttributeApplication {
  readonly call: Node;
  readonly statement: Node;
  readonly fact: TsonicAttributeApplicationFact;
}

export interface SourceAttributePlan {
  readonly applicationCount: number;
  readonly removableImportBindingCount: number;
  readonly removableDeclarationCount: number;
  applicationsFor(sourceFile: SourceFile): readonly SourceAttributeApplication[];
  removableImportBindingsFor(sourceFile: SourceFile): ReadonlySet<Node>;
  deferredImportBindingsFor(sourceFile: SourceFile): ReadonlySet<Node>;
  removableDeclarationsFor(sourceFile: SourceFile): ReadonlySet<Node>;
  moduleEvaluationImportsFor(sourceFile: SourceFile): ReadonlySet<Node>;
}

export interface SourceAttributeSelection {
  excludeSubtreeRoot(node: Node): boolean;
  finish(): SourceAttributePlan;
}

const noApplications = Object.freeze([]) as readonly SourceAttributeApplication[];
const noNodes = Object.freeze([]) as readonly Node[];

interface RemovableImportCandidate {
  readonly declaration: Node;
  readonly importDeclaration: Node;
  readonly markerOnly: boolean;
}

export function createSourceAttributeSelection(
  source: TargetSourceProgram,
): SourceAttributeSelection {
  const byFile = new Map<SourceFile, SourceAttributeApplication[]>();
  const removableImports = new Map<SourceFile, Set<Node>>();
  const importCandidates: RemovableImportCandidate[] = [];
  const candidateDeclarations = new Set<Node>();
  const selectedStatements = new Set<Node>();
  const deferredExclusions = new Set<Node>();
  let applicationCount = 0;
  let finished = false;
  return Object.freeze({
    excludeSubtreeRoot(node: Node): boolean {
      if (finished) {
        throw new Error("source attribute selection is already sealed");
      }
      if (deferredExclusions.delete(node)) {
        return true;
      }
      const statement = source.ast.as.AsExpressionStatement(node);
      const call = statement?.Expression;
      const fact = call === undefined || call === null
        ? undefined
        : source.sourceFacts.getFact(call, tsonicAttributeBuilderFactKey);
      if (fact?.kind === "application") {
        if (call === undefined || call === null) {
          throw new Error("source attribute application has no call subject");
        }
        if (selectedStatements.has(node)) {
          throw new Error("source attribute statement was selected more than once");
        }
        selectedStatements.add(node);
        const sourceFile = source.documents.forNode(call).sourceFile;
        const selected = byFile.get(sourceFile) ?? [];
        selected.push(Object.freeze({ call, statement: node, fact }));
        byFile.set(sourceFile, selected);
        const attributeType = source.ast.children(call).find((child) =>
          child === fact.attributeType
        );
        if (attributeType === undefined) {
          throw new Error(
            "source attribute fact type is not an exact application child",
          );
        }
        const declaration = source.navigation.sourceReferenceFor(attributeType);
        if (declaration?.project === true) {
          candidateDeclarations.add(declaration.declaration);
        }
        applicationCount += 1;
        return true;
      }
      if (
        source.sourceFacts.getFact(node, tsonicAttributeBuilderFactKey)?.kind ===
          "application"
      ) {
        throw new Error(
          "finalized source attribute application is not a standalone expression statement",
        );
      }
      const binding = importBindingRemovalNode(source, node);
      const importCandidate = binding === undefined
        ? undefined
        : attributeOnlyImport(source, binding);
      if (binding === undefined || importCandidate === undefined) {
        return false;
      }
      const sourceFile = source.ast.getSourceFile(binding);
      if (sourceFile === undefined) {
        throw new Error("source attribute import binding has no source file");
      }
      const selected = removableImports.get(sourceFile) ?? new Set<Node>();
      selected.add(binding);
      removableImports.set(sourceFile, selected);
      importCandidates.push(importCandidate);
      if (binding !== node) {
        deferredExclusions.add(binding);
        return false;
      }
      return true;
    },
    finish(): SourceAttributePlan {
      if (finished) {
        throw new Error("source attribute selection was sealed twice");
      }
      finished = true;
      if (deferredExclusions.size !== 0) {
        throw new Error("source attribute import exclusion was not visited");
      }
      const applications = new Map<
        SourceFile,
        readonly SourceAttributeApplication[]
      >();
      for (const [sourceFile, selected] of byFile) {
        applications.set(sourceFile, Object.freeze(selected));
      }
      const importBindings = new Map<SourceFile, readonly Node[]>();
      const removableImportBindings = new Set<Node>();
      const removableImportNodes = new Set<Node>();
      let removableImportBindingCount = 0;
      for (const [sourceFile, selected] of removableImports) {
        const bindings = Object.freeze([...selected]);
        importBindings.set(sourceFile, bindings);
        removableImportBindingCount += bindings.length;
        for (const binding of bindings) {
          removableImportBindings.add(binding);
          collectDescendants(source, binding, removableImportNodes);
        }
      }
      const removableDeclarations = new Map<SourceFile, readonly Node[]>();
      for (const declaration of candidateDeclarations) {
        if (!isRuntimeInertFactDeclaration(source, declaration)) {
          continue;
        }
        const declarationNodes = new Set<Node>();
        collectDescendants(source, declaration, declarationNodes);
        const references = source.navigation.referencesToDeclaration(declaration);
        if (
          references.length === 0 ||
          !references.every((reference) =>
            declarationNodes.has(reference) ||
            removableImportNodes.has(reference) ||
            isInsideSourceAttribute(source, reference)
          )
        ) {
          continue;
        }
        const sourceFile = source.ast.getSourceFile(declaration);
        if (sourceFile === undefined) {
          throw new Error("source attribute fact declaration has no source file");
        }
        const selected = removableDeclarations.get(sourceFile) ?? [];
        removableDeclarations.set(
          sourceFile,
          Object.freeze([...selected, declaration]),
        );
      }
      const removableDeclarationNodes = new Set(
        [...removableDeclarations.values()].flatMap((declarations) =>
          [...declarations]
        ),
      );
      const removableModules = new Set<SourceFile>();
      for (const sourceFile of source.navigation.sourceFiles) {
        const statements = source.ast.statements(sourceFile);
        if (
          statements.length !== 0 &&
          statements.every((statement) =>
            statement !== undefined && removableDeclarationNodes.has(statement)
          )
        ) {
          removableModules.add(sourceFile);
        }
      }
      const moduleEvaluationImports = new Map<SourceFile, readonly Node[]>();
      const deferredImportBindings = new Map<SourceFile, readonly Node[]>();
      const candidatesByImport = new Map<Node, RemovableImportCandidate[]>();
      for (const candidate of importCandidates) {
        const candidates = candidatesByImport.get(candidate.importDeclaration) ?? [];
        candidates.push(candidate);
        candidatesByImport.set(candidate.importDeclaration, candidates);
      }
      for (const [importDeclaration, candidates] of candidatesByImport) {
        const bindings = bindingsOfImport(source, importDeclaration);
        if (
          bindings.length === 0 ||
          !bindings.every((binding) => removableImportBindings.has(binding)) ||
          candidates.every((candidate) => {
            const declarationFile = source.ast.getSourceFile(candidate.declaration);
            return candidate.markerOnly ||
              (declarationFile !== undefined &&
                removableModules.has(declarationFile));
          })
        ) {
          continue;
        }
        const sourceFile = source.ast.getSourceFile(importDeclaration);
        if (sourceFile === undefined) {
          throw new Error("source attribute import declaration has no source file");
        }
        const selectedImports = new Set(
          moduleEvaluationImports.get(sourceFile) ?? noNodes,
        );
        selectedImports.add(importDeclaration);
        moduleEvaluationImports.set(
          sourceFile,
          Object.freeze([...selectedImports]),
        );
        const selectedBindings = new Set(
          deferredImportBindings.get(sourceFile) ?? noNodes,
        );
        for (const binding of bindings) {
          selectedBindings.add(binding);
        }
        deferredImportBindings.set(
          sourceFile,
          Object.freeze([...selectedBindings]),
        );
      }
      const removableDeclarationCount = [...removableDeclarations.values()]
        .reduce((count, declarations) => count + declarations.length, 0);
      return Object.freeze({
        applicationCount,
        removableImportBindingCount,
        removableDeclarationCount,
        applicationsFor(
          sourceFile: SourceFile,
        ): readonly SourceAttributeApplication[] {
          return applications.get(sourceFile) ?? noApplications;
        },
        removableImportBindingsFor(sourceFile: SourceFile): ReadonlySet<Node> {
          return new Set(importBindings.get(sourceFile) ?? noNodes);
        },
        deferredImportBindingsFor(sourceFile: SourceFile): ReadonlySet<Node> {
          return new Set(deferredImportBindings.get(sourceFile) ?? noNodes);
        },
        removableDeclarationsFor(sourceFile: SourceFile): ReadonlySet<Node> {
          return new Set(removableDeclarations.get(sourceFile) ?? noNodes);
        },
        moduleEvaluationImportsFor(sourceFile: SourceFile): ReadonlySet<Node> {
          return new Set(moduleEvaluationImports.get(sourceFile) ?? noNodes);
        },
      });
    },
  });
}

function bindingsOfImport(
  source: TargetSourceProgram,
  declarationNode: Node,
): readonly Node[] {
  const declaration = source.ast.as.AsImportDeclaration(declarationNode);
  const clause = declaration?.ImportClause === undefined
    ? undefined
    : source.ast.as.AsImportClause(declaration.ImportClause);
  if (clause === undefined) {
    return [];
  }
  const bindings: Node[] = [];
  if (clause.name !== undefined) {
    bindings.push(clause.name);
  }
  const named = clause.NamedBindings;
  if (named === undefined) {
    return bindings;
  }
  if (source.ast.is.IsNamespaceImport(named)) {
    bindings.push(named);
    return bindings;
  }
  const imports = source.ast.as.AsNamedImports(named);
  for (const element of imports?.Elements?.Nodes ?? []) {
    if (element !== undefined) {
      bindings.push(element);
    }
  }
  return bindings;
}

function importBindingRemovalNode(
  source: TargetSourceProgram,
  node: Node,
): Node | undefined {
  if (
    source.ast.is.IsImportSpecifier(node) ||
    source.ast.is.IsNamespaceImport(node)
  ) {
    return node;
  }
  if (source.ast.is.IsImportClause(node)) {
    return source.ast.as.AsImportClause(node)?.name;
  }
  return undefined;
}

function importBindingName(
  source: TargetSourceProgram,
  binding: Node,
): Node {
  return source.ast.name(binding) ?? binding;
}

function attributeOnlyImport(
  source: TargetSourceProgram,
  binding: Node,
): RemovableImportCandidate | undefined {
  const reference = source.navigation.sourceReferenceFor(
    importBindingName(source, binding),
  );
  if (reference === undefined) {
    return undefined;
  }
  const bindingNodes = new Set<Node>();
  collectDescendants(source, binding, bindingNodes);
  const references = source.navigation.referencesToDeclaration(reference.declaration);
  const selectedReferences = references.filter((candidate) =>
    !bindingNodes.has(candidate)
  );
  if (
    selectedReferences.length === 0 ||
    !selectedReferences.every((candidate) =>
      isInsideSourceAttribute(source, candidate)
    )
  ) {
    return undefined;
  }
  const importDeclaration = enclosingImportDeclaration(source, binding);
  if (importDeclaration === undefined) {
    throw new Error("source attribute import binding has no import declaration");
  }
  return Object.freeze({
    declaration: reference.declaration,
    importDeclaration,
    markerOnly: selectedReferences.every((candidate) =>
      isInsideAttributeBuilder(source, candidate)
    ),
  });
}

function enclosingImportDeclaration(
  source: TargetSourceProgram,
  node: Node,
): Node | undefined {
  let current: Node | undefined = node;
  while (current !== undefined) {
    if (source.ast.is.IsImportDeclaration(current)) {
      return current;
    }
    current = source.ast.parent(current);
  }
  return undefined;
}

function isInsideAttributeBuilder(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  let current: Node | undefined = node;
  while (current !== undefined) {
    const fact = source.sourceFacts.getFact(
      current,
      tsonicAttributeBuilderFactKey,
    );
    if (fact?.kind === "builder-state") {
      return true;
    }
    if (fact?.kind === "application") {
      return false;
    }
    current = source.ast.parent(current);
  }
  return false;
}

function isRuntimeInertFactDeclaration(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  if (
    !source.ast.is.IsClassDeclaration(declaration) ||
    source.ast.extendsHeritageElements(declaration).length !== 0 ||
    hasDecorator(source, declaration)
  ) {
    return false;
  }
  return source.ast.members(declaration).every((member) => {
    if (
      member === undefined ||
      !source.ast.is.IsPropertyDeclaration(member) ||
      hasDecorator(source, member)
    ) {
      return false;
    }
    const property = source.ast.as.AsPropertyDeclaration(member);
    return property !== undefined &&
      property.Initializer === undefined &&
      source.ast.is.IsIdentifier(property.name);
  });
}

function hasDecorator(source: TargetSourceProgram, node: Node): boolean {
  return source.ast.modifiers(node).some((modifier) =>
    source.ast.is.IsDecorator(modifier)
  );
}

function isInsideSourceAttribute(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  let current: Node | undefined = node;
  while (current !== undefined) {
    if (
      source.sourceFacts.getFact(current, tsonicAttributeBuilderFactKey)?.kind ===
        "application"
    ) {
      return true;
    }
    current = source.ast.parent(current);
  }
  return false;
}

function collectDescendants(
  source: TargetSourceProgram,
  root: Node,
  selected: Set<Node>,
): void {
  const pending = [root];
  while (pending.length !== 0) {
    const node = pending.pop();
    if (node === undefined || selected.has(node)) {
      continue;
    }
    selected.add(node);
    for (const child of source.ast.children(node)) {
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
}
