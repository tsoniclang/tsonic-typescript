import type {
  CompilerExtension,
  Node,
  SourceAnalysisContext,
  SourceFile,
  TypeCheckerQueries,
} from "@tsonic/tsts";

import type {
  ProviderInvocationContract,
  ProviderInvocationManifest,
} from "../../../../config/provider-invocation-manifest.js";
import {
  providerInvocationExtensionId,
  providerInvocationFactKey,
} from "./fact.js";

export function createProviderInvocationExtension(
  manifests: readonly ProviderInvocationManifest[],
): CompilerExtension {
  const contracts = Object.freeze(manifests.flatMap((manifest) =>
    manifest.contracts
  ));
  return Object.freeze({
    identity: Object.freeze({
      id: providerInvocationExtensionId,
      version: "1.0.0",
    }),
    analyzeSource(context: SourceAnalysisContext): void {
      const declarations = indexProviderDeclarations(context, contracts);
      for (const sourceFile of context.source.getSourceFiles()) {
        if (sourceFile !== undefined) {
          attachProviderInvocationFacts(context, sourceFile, declarations);
        }
      }
    },
  });
}

function indexProviderDeclarations(
  context: SourceAnalysisContext,
  contracts: readonly ProviderInvocationContract[],
): ReadonlyMap<Node, ProviderInvocationContract> {
  const result = new Map<Node, ProviderInvocationContract>();
  const contractsByFile = new Map<string, ProviderInvocationContract[]>();
  for (const contract of contracts) {
    const selected = contractsByFile.get(contract.declarationFileName) ?? [];
    selected.push(contract);
    contractsByFile.set(contract.declarationFileName, selected);
  }
  for (const [fileName, fileContracts] of contractsByFile) {
    const sourceFile = context.source.getSourceFile(fileName);
    if (sourceFile === undefined) {
      continue;
    }
    if (!context.source.ast.isDeclarationFile(sourceFile)) {
      throw new Error(
        `Provider invocation declaration '${fileName}' is not a declaration file`,
      );
    }
    const checker = context.source.getSourceFileQueries(sourceFile).checker;
    for (const contract of fileContracts) {
      const declarations = findStaticMethodDeclarations(
        context,
        checker,
        sourceFile,
        contract,
      );
      if (declarations.length === 0) {
        throw new Error(
          `Provider invocation contract '${contract.semanticKey}' has no selected declaration`,
        );
      }
      for (const declaration of declarations) {
        const existing = result.get(declaration);
        if (existing !== undefined && existing !== contract) {
          throw new Error(
            `Provider declaration has multiple invocation contracts '${existing.semanticKey}' and '${contract.semanticKey}'`,
          );
        }
        result.set(declaration, contract);
      }
    }
  }
  return result;
}

function findStaticMethodDeclarations(
  context: SourceAnalysisContext,
  checker: TypeCheckerQueries,
  sourceFile: SourceFile,
  contract: ProviderInvocationContract,
): readonly Node[] {
  const ast = context.source.ast;
  const owners = ast.statements(sourceFile).filter((statement) =>
    ast.is.IsClassDeclaration(statement) &&
    ast.text(ast.name(statement)) === contract.exportName &&
    ast.hasModifierKind(statement, "export")
  );
  if (owners.length !== 1) {
    throw new Error(
      `Provider invocation contract '${contract.semanticKey}' selected ${owners.length} exported class declarations`,
    );
  }
  const owner = owners[0];
  if (owner === undefined) {
    throw new Error(`Provider invocation contract '${contract.semanticKey}' lost its class declaration`);
  }
  const members = ast.members(owner).filter((member) =>
    ast.is.IsMethodDeclaration(member) &&
    ast.text(ast.name(member)) === contract.member &&
    ast.hasModifierKind(member, "static")
  );
  if (members.length !== 1) {
    throw new Error(
      `Provider invocation contract '${contract.semanticKey}' selected ${members.length} static members`,
    );
  }
  const member = members[0];
  if (member === undefined) {
    throw new Error(`Provider invocation contract '${contract.semanticKey}' lost its member declaration`);
  }
  validateSelectedDeclaration(context, checker, member, contract);
  const symbol = checker.getSymbolAtLocation(ast.name(member));
  const declarations = checker.getSymbolDeclarations(symbol).flatMap((declaration) =>
    declaration !== undefined && ast.getSourceFile(declaration) === sourceFile
      ? [declaration]
      : []
  );
  if (declarations.length !== 1) {
    throw new Error(
      `Provider invocation contract '${contract.semanticKey}' selected ${declarations.length} symbol declarations`,
    );
  }
  return Object.freeze([...declarations]);
}

function attachProviderInvocationFacts(
  context: SourceAnalysisContext,
  sourceFile: SourceFile,
  declarations: ReadonlyMap<Node, ProviderInvocationContract>,
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
    const selected = [
      checker.getSignatureDeclaration(call.selectedSignature),
      call.sourceCalleeAccess?.selectedDeclaration,
      call.sourceCallee.selectedDeclaration,
    ].flatMap((declaration) => {
      if (declaration === undefined) {
        return [];
      }
      const contract = declarations.get(declaration);
      return contract === undefined ? [] : [contract];
    });
    const unique = [...new Set(selected)];
    if (unique.length === 0) {
      return;
    }
    if (unique.length !== 1) {
      throw new Error("Provider invocation selected conflicting contracts");
    }
    const contract = unique[0];
    if (contract === undefined) {
      return;
    }
    validateSelectedParameters(call.sourceSelectedSignatureParameters.length, contract);
    const write = context.facts.set(
      node,
      providerInvocationFactKey,
      contract,
      Object.freeze([Object.freeze({
        message: "Exact provider invocation declaration selected",
        details: Object.freeze({
          manifestContract: contract.identity,
          declarationFileName: contract.declarationFileName,
          targetFingerprint: contract.targetFingerprint,
        }),
      })]),
    );
    if (write !== "inserted" && write !== "idempotent") {
      throw new Error(
        `Provider invocation fact '${contract.semanticKey}' was not attached: ${write}`,
      );
    }
  });
}

function validateSelectedDeclaration(
  context: SourceAnalysisContext,
  checker: TypeCheckerQueries,
  declaration: Node,
  contract: ProviderInvocationContract,
): void {
  const name = context.source.ast.name(declaration);
  const symbol = checker.getSymbolAtLocation(name ?? declaration);
  const type = symbol === undefined
    ? checker.getTypeAtLocation(declaration)
    : checker.getTypeOfSymbol(symbol);
  const actualType = type === undefined ? "" : checker.typeToString(type);
  if (actualType !== contract.targetType) {
    throw new Error(
      `Provider invocation contract '${contract.semanticKey}' expected type '${contract.targetType}' but selected '${actualType}'`,
    );
  }
}

function validateSelectedParameters(
  parameterCount: number,
  contract: ProviderInvocationContract,
): void {
  const indexes = [
    ...contract.inputParameters,
    ...contract.resultOriginParameters,
    ...(contract.state?.writeParameters ?? []),
    ...(contract.state?.carrierParameter === undefined
      ? []
      : [contract.state.carrierParameter]),
  ];
  const invalid = indexes.find((index) => index >= parameterCount);
  if (invalid !== undefined) {
    throw new Error(
      `Provider invocation contract '${contract.semanticKey}' parameter ${invalid} exceeds selected arity ${parameterCount}`,
    );
  }
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
