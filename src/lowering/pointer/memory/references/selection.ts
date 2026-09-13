import { pointerFactKey, rawPointerFactKey, providerVirtualDeclarationFactKey } from "@tsonic/tsts";
import type { Node, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { readTsonicMemoryType, tsonicCoreTypesModule, tsonicCoreProviderVersion, tsonicCoreVirtualModulesProviderId } from "@tsonic/source-core/facts";
import type { TsonicMemoryLayoutFact, TsonicMemoryTypeIdentity } from "@tsonic/source-core/facts";
import { PointerLoweringError } from "../../diagnostic.js";
import { validatePointerFact } from "../../type-contract.js";

export interface ReferenceSelection {
  readonly memoryType: TsonicMemoryTypeIdentity;
  readonly valueTypeNode: Node;
  readonly excludeUndefined: boolean;
}

export function selectReferenceMemory(source: TargetSourceProgram, fact: TsonicMemoryLayoutFact): ReferenceSelection | undefined {
  if (fact.kind !== "value") return undefined;
  const syntax = fact.explicitTypeNode;
  if (fact.fields.length !== 0 || syntax === undefined) return undefined;
  const semantics = source.semantics.forNode(fact.call);
  const members = source.ast.is.IsUnionTypeNode(syntax) ? source.ast.as.AsUnionTypeNode(syntax)?.Types?.Nodes ?? [] : [syntax];
  const selected: { readonly type: Type; readonly typeNode: Node }[] = [];
  for (const member of members) {
    if (member === undefined) continue;
    const type = semantics.types.authoredType(member);
    if (type === undefined || semantics.types.isNullish(type)) continue;
    const subjects = semantics.facts.authoredTypeSubjects(member);
    for (const subject of subjects) {
      const pointer = source.sourceFacts.getFact(subject, pointerFactKey);
      const raw = source.sourceFacts.getFact(subject, rawPointerFactKey);
      if (pointer === undefined && raw === undefined) continue;
      if (pointer !== undefined) {
        const reference = source.ast.parent(pointer.pointee);
        if (reference === undefined) throw new PointerLoweringError("reference layout lost its authored pointer type");
        validatePointerFact(source, reference, pointer);
      }
      selected.push({ type, typeNode: member });
    }
  }
  const result = selected[0];
  if (result === undefined) return undefined;
  const valueType = semantics.types.withoutMissingOrUndefined(fact.sourceType);
  const nonNilTypes = semantics.types.unionOrIntersectionTypes(fact.sourceType).filter(type => !semantics.types.isNullish(type));
  if (selected.some(candidate => candidate.type !== result.type) ||
      !semantics.types.isUnion(fact.sourceType) || nonNilTypes.length !== 1 ||
      valueType === undefined || nonNilTypes[0] === undefined || !semantics.types.isIdentical(valueType, nonNilTypes[0]) ||
      fact.byteSize * 8 !== fact.dataLayout.addressWidth) {
    throw new PointerLoweringError("managed reference memory requires one closed nullable pointer domain and its exact ABI width");
  }
  const referenceType = semantics.facts.typeSubjects(valueType).some(subject => {
    const provider = source.sourceFacts.getFact(subject, providerVirtualDeclarationFactKey);
    return provider?.providerId === tsonicCoreVirtualModulesProviderId && provider.providerVersion === tsonicCoreProviderVersion &&
      provider.providerModuleId === tsonicCoreTypesModule && provider.moduleSpecifier === tsonicCoreTypesModule &&
      provider.memberId === undefined && provider.signatureId === undefined &&
      (provider.exportId === "Pointer" || provider.exportId === "RawPointer");
  });
  if (!referenceType) throw new PointerLoweringError("reference memory layout requires a selected pointer type, not a record containing one");
  for (const node of descendants(source, result.typeNode)) {
    if (!source.ast.is.IsIdentifier(node)) continue;
    let declaration = source.navigation.sourceReferenceFor(node)?.declaration;
    while (declaration !== undefined && !source.ast.is.IsSourceFile(declaration)) {
      if (source.ast.is.IsBlock(declaration) || source.ast.is.IsModuleBlock(declaration)) {
        throw new PointerLoweringError("managed reference memory type cannot capture a local declaration in a file-level codec");
      }
      declaration = source.ast.parent(declaration);
    }
  }
  const memoryType = readTsonicMemoryType(source.sourceFacts, fact.call);
  if (memoryType === undefined || memoryType.sourceType !== fact.sourceType) {
    throw new PointerLoweringError("managed reference memory requires its authenticated shared memory-type identity");
  }
  return Object.freeze({ valueTypeNode: result.typeNode, excludeUndefined: semantics.types.isUnion(result.type), memoryType: memoryType.identity });
}

function descendants(source: TargetSourceProgram, root: Node): Node[] {
  const result: Node[] = [];
  const pending = [root];
  while (pending.length !== 0) {
    const node = pending.pop();
    if (node === undefined) break;
    result.push(node);
    for (const child of source.ast.children(node)) if (child !== undefined) pending.push(child);
  }
  return result;
}
