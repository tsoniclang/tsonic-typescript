import { providerVirtualDeclarationFactKey } from "@tsonic/tsts";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { readTsonicDataLayout } from "@tsonic/source-core/facts";
import { PointerLoweringError } from "../diagnostic.js";

export interface ABIOperandUses {
  readonly expressions: ReadonlySet<Node>;
  readonly imports: ReadonlySet<Node>;
  readonly aliases: ReadonlySet<Node>;
}

export function planABIOperandUses(source: TargetSourceProgram, sourceFile: SourceFile, operands: ReadonlySet<Node>): ABIOperandUses {
  const expressions = new Set<Node>();
  const imports = new Set<Node>();
  const aliases = new Set<Node>();
  const origins = new Set<Node>();
  const pending = [...operands].filter((operand) => readTsonicDataLayout(source.sourceFacts, operand) !== undefined);
  while (pending.length !== 0) {
    const expression = pending.pop();
    if (expression === undefined || expressions.has(expression)) continue;
    expressions.add(expression);
    if (source.ast.is.IsParenthesizedExpression(expression)) {
      const inner = source.ast.as.AsParenthesizedExpression(expression)?.Expression;
      if (inner !== undefined) pending.push(inner);
      continue;
    }
    const reference = source.navigation.sourceReferenceFor(expression);
    if (reference === undefined) throw new PointerLoweringError("ABI operand is missing its exact source binding");
    const declaration = reference.declaration;
    if (!reference.project) {
      const selected = readTsonicDataLayout(source.sourceFacts, expression)?.providerDeclaration;
      const provider = source.sourceFacts.getFact(declaration, providerVirtualDeclarationFactKey);
      if (selected === undefined || provider === undefined ||
        selected.providerId !== provider.providerId || selected.providerVersion !== provider.providerVersion ||
        selected.providerModuleId !== provider.providerModuleId || selected.moduleSpecifier !== provider.moduleSpecifier ||
        selected.exportId !== provider.exportId || provider.memberId !== undefined || provider.signatureId !== undefined) {
        throw new PointerLoweringError("ABI operand does not select its certified provider declaration");
      }
      origins.add(declaration);
    } else if (source.ast.is.IsImportSpecifier(declaration)) {
      imports.add(declaration);
    } else if (source.ast.is.IsVariableDeclaration(declaration) && source.ast.variableDeclarationKind(declaration) === "const") {
      const initializer = source.ast.as.AsVariableDeclaration(declaration)?.Initializer;
      if (initializer === undefined) throw new PointerLoweringError("ABI alias is missing its immutable initializer");
      aliases.add(declaration);
      pending.push(initializer);
    } else {
      throw new PointerLoweringError("ABI operand is not a certified immutable token transport");
    }
  }
  for (const declaration of [...origins, ...imports, ...aliases]) {
    for (const reference of source.navigation.referencesToDeclaration(declaration)) {
      if (source.ast.getSourceFile(reference) !== sourceFile) continue;
      if (reference === source.ast.name(declaration)) continue;
      const parent = source.ast.parent(reference);
      if (parent !== undefined && source.ast.is.IsImportSpecifier(parent)) {
        imports.add(parent);
        continue;
      }
      if (!expressions.has(reference)) throw new PointerLoweringError("ABI token has an observable use outside certified memory operations");
    }
    if (aliases.has(declaration) && source.navigation.declarationUseSummary(declaration).exported) {
      throw new PointerLoweringError("exported ABI aliases require a closed external token transport contract");
    }
  }
  return Object.freeze({ expressions, imports, aliases });
}
