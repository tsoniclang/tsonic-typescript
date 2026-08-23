import type {
  Node,
  SourceAnalysisContext,
  SourceFile,
  Symbol,
  TypeCheckerQueries,
} from "@tsonic/tsts";

import type {
  ProviderInvocationContract,
  ProviderInvocationTargetContract,
} from "../../../../config/provider-invocation-manifest.js";

export function indexProviderInvocationDeclarations(
  context: SourceAnalysisContext,
  contracts: readonly ProviderInvocationContract[],
): ReadonlyMap<Node, ProviderInvocationContract> {
  const result = new Map<Node, ProviderInvocationContract>();
  const selections = contracts.flatMap((contract) => [
    Object.freeze({ contract, target: contract.target, current: true }),
    ...(contract.conditional === undefined
      ? []
      : [Object.freeze({
          contract,
          target: contract.conditional.replacement,
          current: false,
        })]),
  ]);
  const byFile = new Map<string, typeof selections>();
  for (const selection of selections) {
    const selected = byFile.get(selection.target.declarationFileName) ?? [];
    selected.push(selection);
    byFile.set(selection.target.declarationFileName, selected);
  }
  for (const [fileName, fileSelections] of byFile) {
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
    for (const selection of fileSelections) {
      const declarations = findProviderTargetDeclarations(
        context,
        checker,
        sourceFile,
        selection.target,
      );
      if (declarations.length === 0) {
        throw new Error(
          `Provider invocation target '${targetKey(selection.target)}' has no selected declaration`,
        );
      }
      if (!selection.current) {
        continue;
      }
      for (const declaration of declarations) {
        const existing = result.get(declaration);
        if (existing !== undefined && existing !== selection.contract) {
          throw new Error(
            `Provider declaration has multiple invocation contracts '${existing.semanticKey}' and '${selection.contract.semanticKey}'`,
          );
        }
        result.set(declaration, selection.contract);
      }
    }
  }
  return result;
}

function findProviderTargetDeclarations(
  context: SourceAnalysisContext,
  checker: TypeCheckerQueries,
  sourceFile: SourceFile,
  target: ProviderInvocationTargetContract,
): readonly Node[] {
  return target.access === "static-method"
    ? findStaticMethodDeclarations(context, checker, sourceFile, target)
    : findExportDeclarations(context, checker, sourceFile, target);
}

function findStaticMethodDeclarations(
  context: SourceAnalysisContext,
  checker: TypeCheckerQueries,
  sourceFile: SourceFile,
  target: ProviderInvocationTargetContract,
): readonly Node[] {
  const memberName = target.member;
  if (memberName === undefined) {
    throw new Error(`Provider target '${targetKey(target)}' lost its member`);
  }
  const ast = context.source.ast;
  const owners = ast.statements(sourceFile).filter((statement) =>
    ast.is.IsClassDeclaration(statement) &&
    ast.text(ast.name(statement)) === target.exportName &&
    ast.hasModifierKind(statement, "export")
  );
  if (owners.length !== 1) {
    throw new Error(
      `Provider target '${targetKey(target)}' selected ${owners.length} exported class declarations`,
    );
  }
  const owner = owners[0];
  if (owner === undefined) {
    throw new Error(`Provider target '${targetKey(target)}' lost its class`);
  }
  const members = ast.members(owner).filter((member) =>
    ast.is.IsMethodDeclaration(member) &&
    ast.text(ast.name(member)) === memberName &&
    ast.hasModifierKind(member, "static")
  );
  if (members.length !== 1) {
    throw new Error(
      `Provider target '${targetKey(target)}' selected ${members.length} static members`,
    );
  }
  const member = members[0];
  if (member === undefined) {
    throw new Error(`Provider target '${targetKey(target)}' lost its member`);
  }
  validateDeclarationType(context, checker, member, target);
  const symbol = checker.getSymbolAtLocation(ast.name(member));
  return declarationsForSymbols(checker, [symbol], sourceFile);
}

function findExportDeclarations(
  context: SourceAnalysisContext,
  checker: TypeCheckerQueries,
  sourceFile: SourceFile,
  target: ProviderInvocationTargetContract,
): readonly Node[] {
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (moduleSymbol === undefined) {
    throw new Error(
      `Provider target '${targetKey(target)}' has no declaration module symbol`,
    );
  }
  const exports = checker.getExportsOfModule(moduleSymbol).filter((symbol) =>
    symbol !== undefined && checker.getSymbolName(symbol) === target.exportName
  );
  if (exports.length !== 1) {
    throw new Error(
      `Provider target '${targetKey(target)}' selected ${exports.length} exports`,
    );
  }
  const selected = exports[0];
  if (selected === undefined) {
    throw new Error(`Provider target '${targetKey(target)}' lost its export`);
  }
  const type = checker.getTypeOfSymbol(selected);
  const actualType = type === undefined ? "" : checker.typeToString(type);
  if (actualType !== target.targetType) {
    throw new Error(
      `Provider target '${targetKey(target)}' expected type '${target.targetType}' but selected '${actualType}'`,
    );
  }
  const selectedDeclarations = checker.getSymbolDeclarations(selected);
  const aliased = selectedDeclarations.some((declaration) =>
      declaration !== undefined &&
      context.source.ast.is.IsExportSpecifier(declaration)
    )
    ? checker.getAliasedSymbol(selected)
    : undefined;
  return declarationsForSymbols(
    checker,
    [selected, aliased, ...checker.getRootSymbols(selected)],
    sourceFile,
  );
}

function declarationsForSymbols(
  checker: TypeCheckerQueries,
  symbols: readonly (Symbol | undefined)[],
  declarationFile: SourceFile,
): readonly Node[] {
  const declarations = new Set<Node>();
  for (const symbol of symbols) {
    if (symbol === undefined) {
      continue;
    }
    for (const declaration of checker.getSymbolDeclarations(symbol)) {
      if (declaration !== undefined) {
        declarations.add(declaration);
      }
    }
  }
  if (declarations.size === 0) {
    throw new Error(
      `Provider declaration file '${declarationFile.FileName}' selected no symbol declarations`,
    );
  }
  return Object.freeze([...declarations]);
}

function validateDeclarationType(
  context: SourceAnalysisContext,
  checker: TypeCheckerQueries,
  declaration: Node,
  target: ProviderInvocationTargetContract,
): void {
  const name = context.source.ast.name(declaration);
  const symbol = checker.getSymbolAtLocation(name ?? declaration);
  const type = symbol === undefined
    ? checker.getTypeAtLocation(declaration)
    : checker.getTypeOfSymbol(symbol);
  const actualType = type === undefined ? "" : checker.typeToString(type);
  if (actualType !== target.targetType) {
    throw new Error(
      `Provider target '${targetKey(target)}' expected type '${target.targetType}' but selected '${actualType}'`,
    );
  }
}

function targetKey(target: ProviderInvocationTargetContract): string {
  return [
    target.specifier,
    target.access,
    target.exportName,
    target.member ?? "",
  ].join("#");
}
