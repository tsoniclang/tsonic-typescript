import { dirname, relative } from "node:path";
import type { Node, SourceFile } from "@tsonic/tsts";
import { KindCallExpression } from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { readTsonicMemoryLayout } from "@tsonic/source-core/facts";
import type { TsonicMemoryLayoutFact, TsonicMemoryTypeIdentity } from "@tsonic/source-core/facts";
import type { TargetProgramIndex } from "../../../program-index.js";
import type { GeneratedBindingName, ProgramGeneratedNames } from "../../../generated-names.js";
import { PointerLoweringError } from "../../diagnostic.js";
import { memoryABIKey } from "../identity.js";
import { selectReferenceMemory } from "./selection.js";
import type { ReferenceSelection } from "./selection.js";

export interface ReferenceMemoryDefinition {
  readonly fact: TsonicMemoryLayoutFact;
  readonly selection: ReferenceSelection;
  readonly sourceFile: SourceFile;
  readonly name: GeneratedBindingName;
  readonly cache: GeneratedBindingName;
}

export interface ReferenceMemoryLayout {
  readonly kind: "reference";
  readonly fact: TsonicMemoryLayoutFact;
  readonly definition: ReferenceMemoryDefinition;
  readonly name: GeneratedBindingName;
  readonly moduleSpecifier?: string;
}

export interface MemoryReferencePlan {
  owns(source: TargetSourceProgram): boolean;
  forLayout(fact: TsonicMemoryLayoutFact): ReferenceMemoryLayout | undefined;
  forFile(sourceFile: SourceFile): readonly ReferenceMemoryLayout[];
  validate(sourceFile: SourceFile): void;
}

export function createMemoryReferencePlan(source: TargetSourceProgram, program: TargetProgramIndex, names: ProgramGeneratedNames, required: ReadonlySet<Node>): MemoryReferencePlan {
  const definitions = new Map<TsonicMemoryTypeIdentity, Map<string, ReferenceMemoryDefinition>>();
  const layouts = new Map<Node, ReferenceMemoryLayout>();
  const files = new Map<SourceFile, Map<ReferenceMemoryDefinition, ReferenceMemoryLayout>>();
  const failures = new Map<SourceFile, string[]>();
  for (const node of program.nodesOfKind(KindCallExpression)) {
    const fact = readTsonicMemoryLayout(source.sourceFacts, node);
    if (fact?.call !== node || !required.has(node)) continue;
    const sourceFile = source.ast.getSourceFile(node);
    if (sourceFile === undefined) throw new PointerLoweringError("memory reference lost its source file");
    try {
      const selection = selectReferenceMemory(source, fact);
      if (selection === undefined) continue;
      const owner = names.forFile(sourceFile);
      let domains = definitions.get(selection.memoryType);
      if (domains === undefined) { domains = new Map(); definitions.set(selection.memoryType, domains); }
      const identity = JSON.stringify([memoryABIKey(fact.dataLayout), fact.byteSize, fact.byteAlignment, fact.stride]);
      let definition = domains.get(identity);
      if (definition === undefined) {
        definition = Object.freeze({ fact, selection, sourceFile, name: owner.reserve("pointerMemoryLayout"), cache: owner.reserve("pointerMemoryCodec") });
        domains.set(identity, definition);
      }
      let entries = files.get(sourceFile);
      if (entries === undefined) { entries = new Map(); files.set(sourceFile, entries); }
      let entry = entries.get(definition);
      if (entry === undefined) {
        const path = relative(dirname(source.ast.getFileName(sourceFile)), source.ast.getFileName(definition.sourceFile)).replace(/\\/gu, "/").replace(/\.[cm]?tsx?$/u, ".js");
        entry = Object.freeze({ kind: "reference", fact, definition,
          name: sourceFile === definition.sourceFile ? definition.name : owner.reserve(definition.name.text),
          ...(sourceFile === definition.sourceFile ? {} : { moduleSpecifier: path.startsWith(".") ? path : `./${path}` }),
        });
        entries.set(definition, entry);
      }
      layouts.set(node, Object.freeze({ ...entry, fact }));
    } catch (error) {
      if (!(error instanceof PointerLoweringError)) throw error;
      const messages = failures.get(sourceFile) ?? [];
      messages.push(error.message);
      failures.set(sourceFile, messages);
    }
  }
  return Object.freeze({
    owns: (candidate: TargetSourceProgram) => source === candidate,
    forLayout: (fact: TsonicMemoryLayoutFact) => layouts.get(fact.call),
    forFile: (file: SourceFile) => Object.freeze([...(files.get(file)?.values() ?? [])]),
    validate(file: SourceFile): void {
      const messages = failures.get(file);
      if (messages !== undefined) throw new PointerLoweringError(messages.join("; "));
    },
  });
}
