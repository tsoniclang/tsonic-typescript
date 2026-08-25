import {
  pointerFactKey,
  sourceMarkerFactKey,
} from "@tsonic/tsts";
import type {
  Node,
  PointerFact,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import { PointerLoweringError } from "./diagnostic.js";

export function validatePointerFact(
  source: TargetSourceProgram,
  subject: Node,
  fact: PointerFact,
): void {
  const typeReference = pointerTypeReferenceForSubject(source, subject);
  const reference = source.ast.as.AsTypeReferenceNode(typeReference);
  const typeName = reference?.TypeName;
  if (typeName === undefined) {
    fail(source, subject, "has no exact type-name subject");
  }
  const typeArguments = source.ast.typeArguments(typeReference);
  const pointee = typeArguments[0];
  if (typeArguments.length !== 1 || pointee === undefined) {
    fail(source, subject, "does not select exactly one pointer type argument");
  }
  const marker = source.sourceFacts.getFact(typeName, sourceMarkerFactKey);
  if (marker?.kind !== "type-marker" || marker.marker !== "pointer") {
    fail(source, subject, "has no exact canonical pointer selection");
  }
  const referenceFact = source.sourceFacts.getFact(
    typeReference,
    pointerFactKey,
  );
  const typeNameFact = source.sourceFacts.getFact(typeName, pointerFactKey);
  if (referenceFact === undefined || typeNameFact === undefined) {
    fail(source, subject, "is not paired across its type reference and type name");
  }
  for (const candidate of [fact, referenceFact, typeNameFact]) {
    if (candidate.pointee !== pointee) {
      fail(source, subject, "pointee disagrees with its exact type argument");
    }
    if (candidate.mutability !== "readwrite") {
      fail(source, subject, "mutability is not the supported readwrite contract");
    }
  }
}

function pointerTypeReferenceForSubject(
  source: TargetSourceProgram,
  subject: Node,
): Node {
  if (source.ast.is.IsTypeReferenceNode(subject)) {
    return subject;
  }
  const parent = source.ast.parent(subject);
  if (parent === undefined) {
    fail(source, subject, "is not a type reference or its exact type name");
  }
  const reference = source.ast.as.AsTypeReferenceNode(parent);
  if (reference?.TypeName !== subject) {
    fail(source, subject, "is not a type reference or its exact type name");
  }
  return parent;
}

function fail(
  source: TargetSourceProgram,
  subject: Node,
  detail: string,
): never {
  throw new PointerLoweringError(
    `pointer type fact at ${source.ast.kindName(subject)} ${detail}`,
  );
}
