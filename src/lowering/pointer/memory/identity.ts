import { providerVirtualDeclarationFactKey } from "@tsonic/tsts";
import type { Node, ProviderVirtualDeclarationFact } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  tsonicCoreLangModule, tsonicCoreTypesModule,
  tsonicCoreProviderVersion, tsonicCoreVirtualModulesProviderId,
} from "@tsonic/source-core/facts";
import { tsonicMemorySignatureIds, tsonicMemoryTypeExports } from "@tsonic/source-core/extension";
import { PointerLoweringError } from "../diagnostic.js";

export function memoryProviderDeclaration(
  source: TargetSourceProgram,
  node: Node,
): ProviderVirtualDeclarationFact | undefined {
  const semantics = source.semantics.forNode(node);
  const candidates: ProviderVirtualDeclarationFact[] = [];
  const direct = source.sourceFacts.getFact(node, providerVirtualDeclarationFactKey);
  if (direct !== undefined) candidates.push(direct);
  if (source.ast.is.IsCallExpression(node)) {
    const call = semantics.operations.call(node);
    const declaration = call === undefined ? undefined : semantics.declarations.signatureDeclaration(call.selectedSignature);
    const fact = source.sourceFacts.getFact(declaration, providerVirtualDeclarationFactKey);
    if (fact !== undefined) candidates.push(fact);
  } else {
    const type = source.ast.is.IsTypeReferenceNode(node)
      ? semantics.types.authoredType(node)
      : semantics.types.expressionType(source.ast.name(node) ?? node);
    if (type !== undefined) {
      for (const subject of semantics.facts.typeSubjects(type)) {
        const fact = source.sourceFacts.getFact(subject, providerVirtualDeclarationFactKey);
        if (fact !== undefined) candidates.push(fact);
      }
      for (const signature of semantics.types.callSignatures(type)) {
        const fact = source.sourceFacts.getFact(semantics.declarations.signatureDeclaration(signature), providerVirtualDeclarationFactKey);
        if (fact !== undefined) candidates.push(fact);
      }
    }
  }
  const matching = candidates.filter((candidate) =>
    candidate.providerId === tsonicCoreVirtualModulesProviderId &&
    candidate.providerVersion === tsonicCoreProviderVersion &&
    candidate.memberId === undefined && (
      candidate.providerModuleId === tsonicCoreLangModule && candidate.moduleSpecifier === tsonicCoreLangModule &&
        Object.entries(tsonicMemorySignatureIds).some(([exportId, signatureId]) =>
          candidate.exportId === exportId && candidate.signatureId === signatureId) ||
      candidate.providerModuleId === tsonicCoreTypesModule && candidate.moduleSpecifier === tsonicCoreTypesModule &&
        tsonicMemoryTypeExports.some((exportId) => candidate.exportId === exportId)
    ));
  const selected = matching[0];
  if (selected !== undefined && matching.some((candidate) =>
    candidate.providerModuleId !== selected.providerModuleId || candidate.exportId !== selected.exportId ||
    candidate.signatureId !== selected.signatureId)) {
    throw new PointerLoweringError("memory occurrence selects multiple incompatible provider declarations");
  }
  return selected;
}
