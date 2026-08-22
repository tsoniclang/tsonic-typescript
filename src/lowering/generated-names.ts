import type { SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { TargetProgramIndex } from "./program-index.js";

const generatedBindingNameBrand: unique symbol = Symbol(
  "generated-binding-name",
);

export interface GeneratedBindingName {
  readonly text: string;
  readonly [generatedBindingNameBrand]: true;
}

export interface SourceFileGeneratedNames {
  readonly sourceFile: SourceFile;
  reserve(preferred: string): GeneratedBindingName;
}

export interface ProgramGeneratedNames {
  forFile(sourceFile: SourceFile): SourceFileGeneratedNames;
}

export function createProgramGeneratedNames(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ProgramGeneratedNames {
  const owners = new Map<SourceFile, SourceFileGeneratedNames>();
  for (const sourceFile of program.sourceFiles) {
    if (source.ast.getSourceFile(sourceFile) !== sourceFile) {
      throw new Error("generated-name owner received a foreign source-file index");
    }
    owners.set(sourceFile, createSourceFileGeneratedNames(
      sourceFile,
      (name) => program.hasAuthoredIdentifierName(sourceFile, name),
    ));
  }
  return Object.freeze({
    forFile(sourceFile: SourceFile): SourceFileGeneratedNames {
      const owner = owners.get(sourceFile);
      if (owner === undefined) {
        throw new Error("generated names requested for an unindexed source file");
      }
      return owner;
    },
  });
}

function createSourceFileGeneratedNames(
  sourceFile: SourceFile,
  hasAuthoredName: (name: string) => boolean,
): SourceFileGeneratedNames {
  const generated = new Set<string>();
  return Object.freeze({
    sourceFile,
    reserve(preferred: string): GeneratedBindingName {
      if (preferred.length === 0) {
        throw new Error("generated binding requires a non-empty preferred name");
      }
      if (!hasAuthoredName(preferred) && !generated.has(preferred)) {
        generated.add(preferred);
        return generatedBindingName(preferred);
      }
      for (let suffix = 2; ; suffix += 1) {
        const candidate = `${preferred}${suffix}`;
        if (!hasAuthoredName(candidate) && !generated.has(candidate)) {
          generated.add(candidate);
          return generatedBindingName(candidate);
        }
      }
    },
  });
}

function generatedBindingName(text: string): GeneratedBindingName {
  const name: GeneratedBindingName = {
    text,
    [generatedBindingNameBrand]: true,
  };
  return Object.freeze(name);
}
