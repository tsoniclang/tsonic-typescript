import { providerVirtualDeclarationFactKey } from "@tsonic/tsts";
import type { Node, ProviderVirtualDeclarationFact } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  tsonicCoreLangModule, tsonicCoreTypesModule,
  tsonicCoreProviderVersion, tsonicCoreVirtualModulesProviderId,
} from "@tsonic/source-core/facts";
import { tsonicMemorySignatureIds, tsonicMemoryTypeExports, tsonicPointerViewSignatureIds } from "@tsonic/source-core/extension";
import type { TsonicDataLayoutFact } from "@tsonic/source-core/facts";
import { PointerLoweringError } from "../diagnostic.js";

export function memoryABIKey(abi: TsonicDataLayoutFact): string {
  const provider = abi.providerDeclaration;
  return JSON.stringify([provider.providerId, provider.providerVersion, provider.providerModuleId,
    provider.moduleSpecifier, provider.exportId, abi.fingerprint, abi.byteOrder, abi.addressWidth]);
}

export function memoryProviderDeclaration(
  source: TargetSourceProgram,
  node: Node,
): ProviderVirtualDeclarationFact | undefined {
  const semantics = source.semantics.forNode(node);
  const candidates: ProviderVirtualDeclarationFact[] = [];
  const direct = source.sourceFacts.getFact(node, providerVirtualDeclarationFactKey);
  if (direct !== undefined) candidates.push(direct);
  if (source.ast.is.IsImportSpecifier(node)) {
    const declaration = source.navigation.sourceReferenceFor(source.ast.name(node) ?? node)?.declaration;
    const fact = source.sourceFacts.getFact(declaration, providerVirtualDeclarationFactKey);
    if (fact !== undefined) candidates.push(fact);
  } else if (source.ast.is.IsCallExpression(node)) {
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
        (Object.entries(tsonicMemorySignatureIds).some(([exportId, signatureId]) =>
          candidate.exportId === exportId && candidate.signatureId === signatureId) ||
          candidate.exportId === "viewPointer" && Object.values(tsonicPointerViewSignatureIds).some(signature => candidate.signatureId === signature)) ||
      candidate.providerModuleId === tsonicCoreTypesModule && candidate.moduleSpecifier === tsonicCoreTypesModule &&
        tsonicMemoryTypeExports.some((exportId) => candidate.exportId === exportId)
    ));
  const selected = matching[0];
  if (selected !== undefined && matching.some((candidate) =>
    candidate.providerModuleId !== selected.providerModuleId || candidate.exportId !== selected.exportId ||
    source.ast.is.IsCallExpression(node) && candidate.signatureId !== selected.signatureId)) {
    throw new PointerLoweringError("memory occurrence selects multiple incompatible provider declarations");
  }
  return selected;
}
