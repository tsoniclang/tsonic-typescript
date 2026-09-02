import {
  canonicalIdentityFactKey,
  sourcePrimitiveFactKey,
} from "@tsonic/tsts";
import type {
  ExtensionCanonicalIdentity,
  Node,
  SourceFile,
  SourcePrimitiveFact,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  AsTypeReferenceNode,
  IsExportSpecifier,
  IsImportSpecifier,
  IsNamespaceImport,
  IsQualifiedName,
  IsTypeReferenceNode,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";

export type TypeScriptPrimitiveKind = SourcePrimitiveFact["runtimeBase"];

export interface SourcePrimitiveTypeRewrite {
  readonly node: Node;
  readonly fact: SourcePrimitiveFact;
  readonly primitive: TypeScriptPrimitiveKind;
}

export interface SourcePrimitiveLoweringPlan {
  readonly typeReferenceCount: number;
  readonly removableImportBindingCount: number;
  owns(source: TargetSourceProgram): boolean;
  rewriteFor(node: Node): SourcePrimitiveTypeRewrite | undefined;
  rewritesFor(sourceFile: SourceFile): readonly SourcePrimitiveTypeRewrite[];
  removableImportBindingsFor(sourceFile: SourceFile): ReadonlySet<Node>;
}

const noRewrites = Object.freeze([]) as readonly SourcePrimitiveTypeRewrite[];
const noNodes = Object.freeze([]) as readonly Node[];

export function createSourcePrimitiveLoweringPlan(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): SourcePrimitiveLoweringPlan {
  const factNodes: Node[] = [];
  const rewrites: SourcePrimitiveTypeRewrite[] = [];
  const importBindings: Node[] = [];
  for (const node of program.nodes) {
    const fact = source.sourceFacts.getFact(node, sourcePrimitiveFactKey);
    if (fact === undefined) {
      continue;
    }
    factNodes.push(node);
    if (IsTypeReferenceNode(node)) {
      rewrites.push(Object.freeze({
        node,
        fact,
        primitive: primitiveKind(fact),
      }));
      continue;
    }
    if (IsImportSpecifier(node)) {
      assertTypeOnlyBinding(source, node, "import");
      importBindings.push(node);
      continue;
    }
    if (IsExportSpecifier(node)) {
      throw new Error(
        "TypeScript source-primitive lowering does not yet materialize external primitive re-exports",
      );
    }
  }

  const rewriteRoots = new Set(rewrites.map((rewrite) => rewrite.node));
  const bindingRoots = new Set(importBindings);
  for (const node of factNodes) {
    if (
      isWithin(source, node, rewriteRoots) ||
      isWithin(source, node, bindingRoots)
    ) {
      continue;
    }
    throw new Error(
      `source primitive fact at ${source.ast.kindName(node)} has no exact TypeScript lowering owner`,
    );
  }

  const removableBindings = new Set(importBindings);
  for (const node of program.nodes) {
    if (!IsNamespaceImport(node)) {
      continue;
    }
    rejectSelectedNamespacePrimitive(source, node, rewrites);
  }

  const byNode = new Map<Node, SourcePrimitiveTypeRewrite>();
  const rewritesByFile = new Map<SourceFile, SourcePrimitiveTypeRewrite[]>();
  for (const rewrite of rewrites) {
    if (byNode.has(rewrite.node)) {
      throw new Error("one source primitive type was selected twice");
    }
    byNode.set(rewrite.node, rewrite);
    const sourceFile = requiredSourceFile(source, rewrite.node);
    const selected = rewritesByFile.get(sourceFile) ?? [];
    selected.push(rewrite);
    rewritesByFile.set(sourceFile, selected);
  }
  const bindingsByFile = new Map<SourceFile, Node[]>();
  for (const binding of removableBindings) {
    const sourceFile = requiredSourceFile(source, binding);
    const selected = bindingsByFile.get(sourceFile) ?? [];
    selected.push(binding);
    bindingsByFile.set(sourceFile, selected);
  }
  const sealedRewrites = new Map<SourceFile, readonly SourcePrimitiveTypeRewrite[]>();
  const sealedBindings = new Map<SourceFile, readonly Node[]>();
  for (const [sourceFile, selected] of rewritesByFile) {
    sealedRewrites.set(sourceFile, Object.freeze([...selected]));
  }
  for (const [sourceFile, selected] of bindingsByFile) {
    sealedBindings.set(sourceFile, Object.freeze([...selected]));
  }

  return Object.freeze({
    typeReferenceCount: rewrites.length,
    removableImportBindingCount: removableBindings.size,
    owns(candidate: TargetSourceProgram): boolean {
      return candidate === source;
    },
    rewriteFor(node: Node): SourcePrimitiveTypeRewrite | undefined {
      return byNode.get(node);
    },
    rewritesFor(sourceFile: SourceFile): readonly SourcePrimitiveTypeRewrite[] {
      return sealedRewrites.get(sourceFile) ?? noRewrites;
    },
    removableImportBindingsFor(sourceFile: SourceFile): ReadonlySet<Node> {
      return new Set(sealedBindings.get(sourceFile) ?? noNodes);
    },
  });
}

function rejectSelectedNamespacePrimitive(
  source: TargetSourceProgram,
  namespaceImport: Node,
  rewrites: readonly SourcePrimitiveTypeRewrite[],
): void {
  const namespaceIdentity = source.sourceFacts.getFact(
    namespaceImport,
    canonicalIdentityFactKey,
  );
  const namespaceModule = moduleIdentity(namespaceIdentity);
  if (namespaceModule === undefined) {
    return;
  }
  const sourceFile = requiredSourceFile(source, namespaceImport);
  const selected = rewrites.some((rewrite) => {
    const typeName = AsTypeReferenceNode(rewrite.node)?.TypeName;
    return typeName !== undefined &&
      IsQualifiedName(typeName) &&
      requiredSourceFile(source, rewrite.node) === sourceFile &&
      moduleIdentity(source.sourceFacts.getFact(
          rewrite.node,
          canonicalIdentityFactKey,
        )) === namespaceModule;
  });
  if (selected) {
    throw new Error(
      "TypeScript source-primitive lowering requires exact namespace-binding references before it can erase a namespace primitive import",
    );
  }
}

function moduleIdentity(
  identity: ExtensionCanonicalIdentity | undefined,
): string | undefined {
  if (
    identity === undefined ||
    (identity.kind !== "module" && identity.kind !== "export")
  ) {
    return undefined;
  }
  const subpath = identity.subpath ??
    (identity.kind === "module" ? identity.id : undefined);
  return subpath === undefined
    ? undefined
    : `${identity.packageName ?? ""}\u0000${identity.packageVersion ?? ""}\u0000${subpath}`;
}

function primitiveKind(fact: SourcePrimitiveFact): TypeScriptPrimitiveKind {
  switch (fact.runtimeBase) {
    case "bigint":
    case "boolean":
    case "number":
    case "object":
    case "string":
      return fact.runtimeBase;
  }
}

function assertTypeOnlyBinding(
  source: TargetSourceProgram,
  binding: Node,
  subject: string,
): void {
  if (!source.ast.isTypeOnlyImportOrExportDeclaration(binding)) {
    throw new Error(
      `source primitive ${subject} must be explicitly type-only before TypeScript lowering`,
    );
  }
}

function isWithin(
  source: TargetSourceProgram,
  node: Node,
  roots: ReadonlySet<Node>,
): boolean {
  for (
    let current: Node | undefined = node;
    current !== undefined;
    current = source.ast.parent(current)
  ) {
    if (roots.has(current)) {
      return true;
    }
  }
  return false;
}

function requiredSourceFile(
  source: TargetSourceProgram,
  node: Node,
): SourceFile {
  const sourceFile = source.ast.getSourceFile(node);
  if (sourceFile === undefined) {
    throw new Error("planned source primitive has no source file");
  }
  return sourceFile;
}
