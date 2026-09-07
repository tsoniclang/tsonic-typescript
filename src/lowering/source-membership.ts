import { sourceMarkerFactKey, sourcePrimitiveFactKey } from "@tsonic/tsts";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

export function typeScriptLoweringSourceFiles(
  source: TargetSourceProgram,
): readonly SourceFile[] {
  const selected = new Set(source.navigation.sourceFiles);
  for (const file of source.sourceFiles) {
    if (!file.IsDeclarationFile || source.ast.getFileName(file).startsWith("tsts-provider://")) {
      continue;
    }
    if (hasSelectedTypeContract(source, file)) {
      selected.add(file);
    }
  }
  return Object.freeze([...selected]);
}

function hasSelectedTypeContract(source: TargetSourceProgram, file: SourceFile): boolean {
  const pending: Node[] = [file];
  while (pending.length !== 0) {
    const node = pending.pop();
    if (node === undefined) break;
    if (source.sourceFacts.getFact(node, sourceMarkerFactKey) !== undefined ||
        source.sourceFacts.getFact(node, sourcePrimitiveFactKey) !== undefined) {
      return true;
    }
    for (const child of source.ast.children(node)) {
      if (child !== undefined) pending.push(child);
    }
  }
  return false;
}
