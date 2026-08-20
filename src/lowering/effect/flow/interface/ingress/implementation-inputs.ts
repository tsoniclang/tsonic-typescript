import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import type { TargetProgramIndex } from "../../../../program-index.js";
import {
  directContainingInvocation,
  isModuleForwardingReference,
} from "../../../model/syntax.js";
import { resolveProjectInvocation } from "../../../model/project-invocation.js";
import type { ExactAggregateProjectionIndex } from "../../aggregate/projection.js";
import {
  extendExactInvocationInputIndex,
  type ExactImplementationInputSource,
} from "../../invocation/implementation-inputs.js";
import type { ExactInvocationInputIndex } from "../../invocation/inputs.js";

export type InterfaceImplementationInputSource = ExactImplementationInputSource;

export function createInterfaceImplementationInputIndex(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  sources: Iterable<InterfaceImplementationInputSource>,
  direct: ExactInvocationInputIndex,
  projections?: ExactAggregateProjectionIndex,
): ExactInvocationInputIndex {
  const entries = [...sources];
  const invalidImplementations = new Set<Node>();
  for (const entry of entries) {
    for (const implementation of entry.implementations) {
      if (!implementationReferencesAreClosed(source, program, implementation)) {
        invalidImplementations.add(implementation);
      }
    }
  }
  return extendExactInvocationInputIndex(
    source,
    direct,
    entries,
    projections,
    invalidImplementations,
  );
}

function implementationReferencesAreClosed(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  implementation: Node,
): boolean {
  return program.referencesToDeclaration(implementation).every((reference) => {
    if (isModuleForwardingReference(source, reference)) {
      return false;
    }
    const invocation = directContainingInvocation(source, reference);
    return invocation !== undefined &&
      resolveProjectInvocation(source, invocation)?.implementation ===
        implementation;
  });
}
