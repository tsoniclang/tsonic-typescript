import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

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
import type { ExactCallImplementations } from "../../callable/result-inputs.js";
import type { TypeScriptActiveCooperativeEffectProfile } from "../../../../profile.js";

export type InterfaceImplementationInputSource = ExactImplementationInputSource;

export function createInterfaceImplementationInputIndex(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  sources: Iterable<InterfaceImplementationInputSource>,
  direct: ExactInvocationInputIndex,
  projections?: ExactAggregateProjectionIndex,
  exactCallImplementations?: ExactCallImplementations,
  callableReferenceIsClosed?: (reference: Node) => boolean,
  cooperativeEffects: TypeScriptActiveCooperativeEffectProfile = "closed-direct",
): ExactInvocationInputIndex {
  const entries = [...sources];
  const invalidImplementations = new Set<Node>();
  for (const entry of entries) {
    for (const implementation of entry.implementations) {
      if (!implementationReferencesAreClosed(
        source,
        program,
        implementation,
        exactCallImplementations,
        callableReferenceIsClosed,
        cooperativeEffects,
      )) {
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
  exactCallImplementations?: ExactCallImplementations,
  callableReferenceIsClosed?: (reference: Node) => boolean,
  cooperativeEffects: TypeScriptActiveCooperativeEffectProfile = "closed-direct",
): boolean {
  return source.navigation.referencesToDeclaration(implementation).every((reference) => {
    if (isModuleForwardingReference(source, reference)) {
      return cooperativeEffects === "closed-program";
    }
    const invocation = directContainingInvocation(source, reference);
    return callableReferenceIsClosed?.(reference) === true ||
      invocation !== undefined &&
        (resolveProjectInvocation(source, invocation)?.implementation ===
          implementation ||
          exactCallImplementations?.(invocation)?.includes(implementation) ===
            true);
  });
}
