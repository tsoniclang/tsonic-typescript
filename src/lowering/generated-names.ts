import type { Node, SourceFile } from "@tsonic/tsts";
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
  reserveExact(preferred: string): GeneratedBindingName | undefined;
  reserve(preferred: string): GeneratedBindingName;
}

export interface ClassGeneratedNames {
  readonly classDeclaration: Node;
  reserveExact(preferred: string): GeneratedBindingName | undefined;
  reserve(preferred: string): GeneratedBindingName;
}

export interface ProgramGeneratedNames {
  forFile(sourceFile: SourceFile): SourceFileGeneratedNames;
  forClass(classDeclaration: Node): ClassGeneratedNames;
}

export function createProgramGeneratedNames(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ProgramGeneratedNames {
  const owners = new Map<SourceFile, SourceFileGeneratedNames>();
  const classOwners = new Map<Node, ClassGeneratedNames>();
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
    forClass(classDeclaration: Node): ClassGeneratedNames {
      if (!source.ast.is.IsClassDeclaration(classDeclaration)) {
        throw new Error("generated class-member names require a class declaration");
      }
      const cached = classOwners.get(classDeclaration);
      if (cached !== undefined) {
        return cached;
      }
      const sourceFile = source.ast.getSourceFile(classDeclaration);
      if (sourceFile === undefined || !owners.has(sourceFile)) {
        throw new Error("generated class-member names require a selected project class");
      }
      const authoredNames = classMemberNames(source, classDeclaration);
      const generated = createGeneratedNames(
        (name) => authoredNames.has(name),
      );
      const owner: ClassGeneratedNames = Object.freeze({
        classDeclaration,
        ...generated,
      });
      classOwners.set(classDeclaration, owner);
      return owner;
    },
  });
}

function createSourceFileGeneratedNames(
  sourceFile: SourceFile,
  hasAuthoredName: (name: string) => boolean,
): SourceFileGeneratedNames {
  const generated = createGeneratedNames(hasAuthoredName);
  return Object.freeze({
    sourceFile,
    ...generated,
  });
}

function createGeneratedNames(
  hasAuthoredName: (name: string) => boolean,
): Pick<SourceFileGeneratedNames, "reserveExact" | "reserve"> {
  const generated = new Set<string>();
  return Object.freeze({
    reserveExact(preferred: string): GeneratedBindingName | undefined {
      requirePreferredName(preferred);
      if (hasAuthoredName(preferred) || generated.has(preferred)) {
        return undefined;
      }
      generated.add(preferred);
      return generatedBindingName(preferred);
    },
    reserve(preferred: string): GeneratedBindingName {
      requirePreferredName(preferred);
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

function classMemberNames(
  source: TargetSourceProgram,
  classDeclaration: Node,
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const member of source.ast.members(classDeclaration)) {
    const name = source.ast.name(member);
    if (name !== undefined) {
      names.add(source.ast.text(name));
    }
    if (member !== undefined && source.ast.is.IsConstructorDeclaration(member)) {
      for (const parameter of source.ast.parameters(member)) {
        const parameterName = source.ast.name(parameter);
        if (parameterName !== undefined) {
          names.add(source.ast.text(parameterName));
        }
      }
    }
  }
  return names;
}

function requirePreferredName(preferred: string): void {
  if (preferred.length === 0) {
    throw new Error("generated binding requires a non-empty preferred name");
  }
}

function generatedBindingName(text: string): GeneratedBindingName {
  const name: GeneratedBindingName = {
    text,
    [generatedBindingNameBrand]: true,
  };
  return Object.freeze(name);
}
