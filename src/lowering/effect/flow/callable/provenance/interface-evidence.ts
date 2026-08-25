import type { Node } from "@tsonic/tsts";

import type { ExactCallImplementations } from "../result-inputs.js";
import {
  createCallableValueResolution,
  type CallableValueResolution,
} from "../value-resolution.js";

export interface CallableInterfaceEvidence {
  readonly implementationsForCall: ExactCallImplementations;
  resolutionForDeclaration(
    declaration: Node | undefined,
  ): CallableValueResolution | undefined;
  allowsCallableReference(node: Node): boolean;
}

export function finalizeCallableInterfaceEvidence(
  callResolutions: ReadonlyMap<Node, CallableValueResolution>,
  closedCallableReferences: ReadonlySet<Node>,
  declarationResolutions: ReadonlyMap<Node, CallableValueResolution>,
  closedCallableDeclarations: ReadonlySet<Node>,
  settledReturnSources: ReadonlySet<Node>,
  inheritedCallableReferenceIsClosed:
    ((reference: Node) => boolean) | undefined,
): CallableInterfaceEvidence {
  const implementationsByResolution = new Map<
    CallableValueResolution,
    readonly Node[]
  >();
  const implementationsByCall = new Map<Node, readonly Node[]>();
  for (const [call, resolution] of callResolutions) {
    if (!resolution.closed) {
      continue;
    }
    let implementations = implementationsByResolution.get(resolution);
    if (implementations === undefined) {
      implementations = Object.freeze([
        ...new Set([
          ...resolution.dependencyNodes(),
          ...resolution.synchronousDeclarationNodes(),
        ]),
      ]);
      implementationsByResolution.set(resolution, implementations);
    }
    implementationsByCall.set(call, implementations);
  }
  const detachedResolutions = new Map<
    CallableValueResolution,
    CallableValueResolution
  >();
  const resolutionsByDeclaration = new Map<Node, CallableValueResolution>();
  for (const [declaration, resolution] of declarationResolutions) {
    let detached = detachedResolutions.get(resolution);
    if (detached === undefined) {
      detached = createCallableValueResolution(
        resolution.closed,
        resolution.dependencyNodes(),
        resolution.synchronousDeclarationNodes(),
      );
      detachedResolutions.set(resolution, detached);
    }
    resolutionsByDeclaration.set(declaration, detached);
  }
  const allowedReferences = new Set([
    ...closedCallableReferences,
    ...settledReturnSources,
  ]);
  for (const declaration of closedCallableDeclarations) {
    if (resolutionsByDeclaration.get(declaration)?.closed === true) {
      allowedReferences.add(declaration);
    }
  }
  return Object.freeze({
    implementationsForCall(call: Node): readonly Node[] | undefined {
      return implementationsByCall.get(call);
    },
    resolutionForDeclaration(
      declaration: Node | undefined,
    ): CallableValueResolution | undefined {
      return declaration === undefined
        ? undefined
        : resolutionsByDeclaration.get(declaration);
    },
    allowsCallableReference(node: Node): boolean {
      return inheritedCallableReferenceIsClosed?.(node) === true ||
        allowedReferences.has(node);
    },
  });
}
