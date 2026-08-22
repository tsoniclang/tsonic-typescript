import type {
  CompilerExtension,
  Node,
  SourceAnalysisContext,
  SourceFile,
  TypeCheckerQueries,
} from "@tsonic/tsts";

import { typeScriptRuntimeModule } from "./package-contract.js";
import {
  type NonThenableTypeScriptRuntimeOperation,
  nonThenableTypeScriptRuntimeOperations,
  typeScriptRuntimeReturnExtensionId,
  typeScriptRuntimeReturnExtensionVersion,
  typeScriptRuntimeReturnFactKey,
} from "./return-fact.js";

export function createTypeScriptRuntimeReturnExtension(): CompilerExtension {
  return Object.freeze({
    identity: Object.freeze({
      id: typeScriptRuntimeReturnExtensionId,
      version: typeScriptRuntimeReturnExtensionVersion,
    }),
    analyzeSource(context: SourceAnalysisContext): void {
      const declarations = indexRuntimeDeclarations(context);
      if (declarations.size === 0) {
        return;
      }
      for (const sourceFile of context.source.getSourceFiles()) {
        if (sourceFile !== undefined) {
          attachRuntimeReturnFacts(context, sourceFile, declarations);
        }
      }
    },
  });
}

function indexRuntimeDeclarations(
  context: SourceAnalysisContext,
): ReadonlyMap<Node, NonThenableTypeScriptRuntimeOperation> {
  const declarations = new Map<Node, NonThenableTypeScriptRuntimeOperation>();
  for (const sourceFile of context.source.getSourceFiles()) {
    if (sourceFile === undefined) {
      continue;
    }
    const checker = context.source.getSourceFileQueries(sourceFile).checker;
    for (const statement of context.source.ast.statements(sourceFile)) {
      if (!context.source.ast.is.IsImportDeclaration(statement)) {
        continue;
      }
      const specifier = context.source.ast.as.AsImportDeclaration(statement)
        ?.ModuleSpecifier;
      if (
        specifier === undefined ||
        context.source.ast.text(specifier) !== typeScriptRuntimeModule
      ) {
        continue;
      }
      indexRuntimeModuleExports(checker, specifier, declarations);
    }
  }
  return declarations;
}

function indexRuntimeModuleExports(
  checker: TypeCheckerQueries,
  specifier: Node,
  declarations: Map<Node, NonThenableTypeScriptRuntimeOperation>,
): void {
  const moduleSymbol = checker.getResolvedExternalModuleSymbol(
    checker.getModuleSymbolFromSpecifier(specifier),
  );
  if (moduleSymbol === undefined) {
    throw new Error(
      `TypeScript runtime module '${typeScriptRuntimeModule}' has no selected module symbol`,
    );
  }
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    if (exported === undefined) {
      continue;
    }
    const operation = selectedRuntimeOperation(checker.getSymbolName(exported));
    if (operation === undefined) {
      continue;
    }
    for (const declaration of checker.getSymbolDeclarations(exported)) {
      if (declaration === undefined) {
        continue;
      }
      const existing = declarations.get(declaration);
      if (existing !== undefined && existing !== operation) {
        throw new Error(
          `TypeScript runtime declaration selected both '${existing}' and '${operation}'`,
        );
      }
      declarations.set(declaration, operation);
    }
  }
}

function attachRuntimeReturnFacts(
  context: SourceAnalysisContext,
  sourceFile: SourceFile,
  declarations: ReadonlyMap<Node, NonThenableTypeScriptRuntimeOperation>,
): void {
  const checker = context.source.getSourceFileQueries(sourceFile).checker;
  visit(context, sourceFile, (node) => {
    if (!context.source.ast.is.IsCallExpression(node)) {
      return;
    }
    const call = checker.getResolvedCallInfo(node);
    if (call === undefined) {
      return;
    }
    const selected = new Set<NonThenableTypeScriptRuntimeOperation>();
    for (const declaration of [
      checker.getSignatureDeclaration(call.selectedSignature),
      call.sourceCalleeAccess?.selectedDeclaration,
      call.sourceCallee.selectedDeclaration,
    ]) {
      const operation = declaration === undefined
        ? undefined
        : declarations.get(declaration);
      if (operation !== undefined) {
        selected.add(operation);
      }
    }
    if (selected.size === 0) {
      return;
    }
    if (selected.size !== 1) {
      throw new Error("TypeScript runtime call selected conflicting return contracts");
    }
    const operation = selected.values().next().value;
    if (operation === undefined) {
      throw new Error("TypeScript runtime call lost its selected return contract");
    }
    const write = context.facts.set(
      node,
      typeScriptRuntimeReturnFactKey,
      Object.freeze({ operation }),
      Object.freeze([Object.freeze({
        message: "Exact TypeScript runtime return contract selected",
        details: Object.freeze({
          module: typeScriptRuntimeModule,
          operation,
        }),
      })]),
    );
    if (write !== "inserted" && write !== "idempotent") {
      throw new Error(
        `TypeScript runtime return fact '${operation}' was not attached: ${write}`,
      );
    }
  });
}

function selectedRuntimeOperation(
  name: string,
): NonThenableTypeScriptRuntimeOperation | undefined {
  return nonThenableTypeScriptRuntimeOperations.find((operation) =>
    operation === name
  );
}

function visit(
  context: SourceAnalysisContext,
  root: Node,
  callback: (node: Node) => void,
): void {
  const pending = [root];
  while (pending.length !== 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    callback(node);
    const children = context.source.ast.children(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
}
