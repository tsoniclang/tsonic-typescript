import { createHash } from "node:crypto";

import type {
  Node,
  SourceAnalysisContext,
  SourceFile,
  Symbol,
  TypeCheckerQueries,
} from "@tsonic/tsts";

import type {
  SourceInvocationContract,
  SourceInvocationFileContract,
} from "../../../../config/source-invocation-manifest.js";

import type { SourceBodyCertification } from "./fact.js";

export interface SourceInvocationDeclarationIndex {
  readonly contracts: ReadonlyMap<Node, SourceInvocationContract>;
  readonly certifiedBodies: ReadonlyMap<Node, SourceBodyCertification>;
}

export function indexSourceInvocationDeclarations(
  context: SourceAnalysisContext,
  files: readonly SourceInvocationFileContract[],
  contracts: readonly SourceInvocationContract[],
): SourceInvocationDeclarationIndex {
  const result = new Map<Node, SourceInvocationContract>();
  const certifiedBodies = new Map<Node, SourceBodyCertification>();
  const sourceFiles = new Map<SourceInvocationFileContract, SourceFile>();
  for (const file of files) {
    const sourceFile = context.source.getSourceFile(file.sourceFileName);
    if (sourceFile === undefined) {
      throw new Error(
        `Source invocation file '${file.sourceFileName}' is absent from the checked program`,
      );
    }
    if (context.source.ast.isDeclarationFile(sourceFile)) {
      throw new Error(
        `Source invocation file '${file.sourceFileName}' is not an authored source file`,
      );
    }
    verifySourceDigest(context, sourceFile, file);
    sourceFiles.set(file, sourceFile);
    if (file.exact) {
      const certification = Object.freeze({
        identity: file.identity,
        sourceFileName: file.sourceFileName,
        sourceDigest: file.sourceDigest,
      });
      certifiedBodies.set(sourceFile, certification);
    }
  }
  for (const contract of contracts) {
    const sourceFile = sourceFiles.get(contract.file);
    if (sourceFile === undefined) {
      throw new Error(
        `Source invocation '${contract.semanticKey}' lost its source-file owner`,
      );
    }
    const checker = context.source.getSourceFileQueries(sourceFile).checker;
    const declarations = selectExportedCallableOwner(
      context,
      checker,
      sourceFile,
      contract,
    );
    for (const declaration of declarations) {
      const existing = result.get(declaration);
      if (existing !== undefined && existing !== contract) {
        throw new Error(
          `Source declaration has multiple invocation contracts '${existing.semanticKey}' and '${contract.semanticKey}'`,
        );
      }
      result.set(declaration, contract);
      if (contract.exactImplementation && !contract.file.exact) {
        certifiedBodies.set(declaration, Object.freeze({
          identity: contract.identity,
          sourceFileName: contract.file.sourceFileName,
          sourceDigest: contract.file.sourceDigest,
        }));
      }
    }
  }
  return Object.freeze({ contracts: result, certifiedBodies });
}

function verifySourceDigest(
  context: SourceAnalysisContext,
  sourceFile: SourceFile,
  file: SourceInvocationFileContract,
): void {
  const actual = createHash("sha256")
    .update(context.source.ast.getSourceText(sourceFile))
    .digest("hex");
  if (actual !== file.sourceDigest) {
    throw new Error(
      `Source invocation file '${context.source.ast.getFileName(sourceFile)}' does not match its certified digest`,
    );
  }
}

function selectExportedCallableOwner(
  context: SourceAnalysisContext,
  checker: TypeCheckerQueries,
  sourceFile: SourceFile,
  contract: SourceInvocationContract,
): readonly Node[] {
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (moduleSymbol === undefined) {
    throw new Error(
      `Source invocation '${contract.semanticKey}' has no module symbol`,
    );
  }
  const exports = checker.getExportsOfModule(moduleSymbol).filter((symbol) =>
    symbol !== undefined && checker.getSymbolName(symbol) === contract.exportName
  );
  if (exports.length !== 1) {
    throw new Error(
      `Source invocation '${contract.semanticKey}' selected ${exports.length} exports`,
    );
  }
  const selected = exports[0];
  if (selected === undefined) {
    throw new Error(`Source invocation '${contract.semanticKey}' lost its export`);
  }
  const owners = declarationsForSymbols(checker, selected).filter(
    (declaration) =>
      context.source.ast.getSourceFile(declaration) === sourceFile &&
      (
        context.source.ast.is.IsFunctionDeclaration(declaration) ||
        context.source.ast.is.IsClassDeclaration(declaration)
      ),
  );
  if (owners.length !== 1) {
    throw new Error(
      `Source invocation '${contract.semanticKey}' selected ${owners.length} callable owners`,
    );
  }
  const owner = owners[0];
  if (owner === undefined) {
    throw new Error(
      `Source invocation '${contract.semanticKey}' lost its callable owner`,
    );
  }
  if (context.source.ast.is.IsFunctionDeclaration(owner)) {
    return Object.freeze([owner]);
  }
  return Object.freeze(callableDeclarationsWithin(context, owner).filter(
    (declaration) =>
      context.source.ast.is.IsConstructorDeclaration(declaration) &&
      context.source.ast.parent(declaration) === owner,
  ));
}

function callableDeclarationsWithin(
  context: SourceAnalysisContext,
  owner: Node,
): readonly Node[] {
  const declarations: Node[] = [];
  const pending = [owner];
  while (pending.length !== 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    if (isCallableImplementation(context, node)) {
      declarations.push(node);
    }
    const children = context.source.ast.children(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
  return Object.freeze(declarations);
}

function isCallableImplementation(
  context: SourceAnalysisContext,
  node: Node,
): boolean {
  return context.source.ast.body(node) !== undefined &&
    (
      context.source.ast.is.IsFunctionDeclaration(node) ||
      context.source.ast.is.IsFunctionExpression(node) ||
      context.source.ast.is.IsArrowFunction(node) ||
      context.source.ast.is.IsMethodDeclaration(node) ||
      context.source.ast.is.IsConstructorDeclaration(node) ||
      context.source.ast.is.IsGetAccessorDeclaration(node) ||
      context.source.ast.is.IsSetAccessorDeclaration(node)
    );
}

function declarationsForSymbols(
  checker: TypeCheckerQueries,
  symbol: Symbol,
): readonly Node[] {
  const declarations = new Set<Node>();
  for (const selected of [symbol, ...checker.getRootSymbols(symbol)]) {
    for (const declaration of checker.getSymbolDeclarations(selected)) {
      if (declaration !== undefined) {
        declarations.add(declaration);
      }
    }
  }
  return Object.freeze([...declarations]);
}
