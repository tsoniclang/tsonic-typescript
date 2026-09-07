import { sourcePrimitiveFactKey } from "@tsonic/tsts";
import type { SourcePrimitiveFact } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { TsonicMemoryLayoutFact } from "@tsonic/source-core/facts";
import { PointerLoweringError } from "../diagnostic.js";

export interface ScalarMemoryLayout {
  readonly fact: TsonicMemoryLayoutFact;
  readonly runtimeFactory: keyof typeof import("@tsonic/typescript-runtime");
}

export function scalarMemoryLayout(source: TargetSourceProgram, fact: TsonicMemoryLayoutFact): ScalarMemoryLayout {
  const semantics = source.semantics.forNode(fact.call);
  const subjects = fact.explicitTypeNode === undefined
    ? semantics.facts.typeSubjects(fact.sourceType)
    : semantics.facts.authoredTypeSubjects(fact.explicitTypeNode);
  const primitives: SourcePrimitiveFact[] = [];
  for (const subject of subjects) {
    const primitive = source.sourceFacts.getFact(subject, sourcePrimitiveFactKey);
    if (primitive !== undefined) primitives.push(primitive);
  }
  const primitive = primitives[0];
  if (primitive === undefined || primitives.some((candidate) =>
    candidate.kind !== primitive.kind || candidate.runtimeBase !== primitive.runtimeBase ||
    candidate.width !== primitive.width || candidate.signed !== primitive.signed)) {
    throw new PointerLoweringError("memory layout requires one exact finalized scalar domain; aggregate or erased domains are not executable managed memory");
  }
  const selected = scalarCodec(primitive);
  if (selected === undefined || fact.fields.length !== 0 ||
    !(primitive.runtimeBase === "number" ? semantics.types.isNumberLike(fact.sourceType) : semantics.types.isBigIntLike(fact.sourceType)) ||
    primitive.width !== selected.bytes * 8 ||
    fact.byteSize !== selected.bytes) {
    throw new PointerLoweringError("memory layout does not match an exact supported integer storage codec");
  }
  return Object.freeze({ fact, runtimeFactory: selected.factory });
}

function scalarCodec(primitive: SourcePrimitiveFact): { readonly bytes: number; readonly factory: keyof typeof import("@tsonic/typescript-runtime") } | undefined {
  if (primitive.runtimeBase === "number") {
    switch (primitive.kind) {
      case "int8": return { bytes: 1, factory: "int8Layout" };
      case "uint8": return { bytes: 1, factory: "uint8Layout" };
      case "int16": return { bytes: 2, factory: "int16Layout" };
      case "uint16": return { bytes: 2, factory: "uint16Layout" };
      case "int32": return { bytes: 4, factory: "int32Layout" };
      case "uint32": return { bytes: 4, factory: "uint32Layout" };
    }
  }
  if (primitive.runtimeBase === "bigint") {
    switch (primitive.kind) {
      case "int64": return { bytes: 8, factory: "int64Layout" };
      case "uint64": return { bytes: 8, factory: "uint64Layout" };
    }
  }
  return undefined;
}
