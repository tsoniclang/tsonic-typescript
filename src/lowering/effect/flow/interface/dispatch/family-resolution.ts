import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { CooperativeEffectCandidate } from "../../../inventory/candidates.js";
import type { CallableValueResolution } from "../../callable/value-resolution.js";
import type { InterfaceContractComponent } from "../graph.js";
import type {
  DeclaredInterfaceDispatchFamily,
  DeclaredInterfaceImplementationSelection,
  InterfaceFamilyResolution,
} from "./model.js";
import type { InterfaceDispatchRejectionReason } from "../decision.js";
import {
  sourceBodyInspectionIsExact,
  type ExactSourceBodyInspection,
} from "../../../model/source-membership.js";
import {
  interfaceImplementationUsesSynchronousTransport,
} from "../implementation-synchrony.js";
import type { CallableReturnRewrite } from "../../../model/callable-contract.js";

export type InterfaceDispatchFamilyResolution =
  | {
      readonly kind: "admitted";
      readonly family: DeclaredInterfaceDispatchFamily;
    }
  | {
      readonly kind: "rejected";
      readonly reason: Exclude<
        InterfaceDispatchRejectionReason,
        "open-ingress"
      >;
    };

export function resolveInterfaceDispatchFamily(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  component: InterfaceContractComponent,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
): InterfaceDispatchFamilyResolution {
  const selections: DeclaredInterfaceImplementationSelection[] = [];
  const implementationEntries = new Map<Node, readonly Node[]>();
  for (const entry of [
    ...component.entries,
    ...component.abstractTransports,
  ]) {
    const existing = implementationEntries.get(entry.declaration);
    if (existing !== undefined && !sameNodes(existing, entry.implementations)) {
      throw new Error(
        "interface component carries conflicting implementation selections",
      );
    }
    implementationEntries.set(entry.declaration, entry.implementations);
  }
  for (const entry of [
    ...component.entries,
    ...component.abstractTransports,
  ]) {
    if (entry.implementations.length === 0 && entry.calls.length !== 0) {
      return { kind: "rejected", reason: "missing-implementer" };
    }
  }
  for (const [declaration, selected] of implementationEntries) {
    const implementations = new Set<Node>();
    const valueImplementationBindings = new Set<Node>();
    for (const implementation of selected) {
      const candidate = candidates.get(implementation);
      if (candidate !== undefined) {
        implementations.add(implementation);
      } else if (interfaceImplementationUsesSynchronousTransport(
        source,
        implementation,
        bodyInspectionIsCertified,
      )) {
        implementations.add(implementation);
        continue;
      } else if (implementationIsValueBinding(
        source,
        implementation,
        bodyInspectionIsCertified,
      )) {
        valueImplementationBindings.add(implementation);
      } else {
        return {
          kind: "rejected",
          reason: "unproven-synchronous-implementation",
        };
      }
    }
    selections.push(Object.freeze({
      declaration,
      implementations: Object.freeze([...implementations]),
      valueImplementationBindings: Object.freeze([
        ...valueImplementationBindings,
      ]),
    }));
  }
  return admittedFamily(component, selections, candidates);
}

export function resolveInterfaceValueImplementations(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  family: DeclaredInterfaceDispatchFamily,
  resolutionFor: (declaration: Node) => CallableValueResolution | undefined,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
): InterfaceDispatchFamilyResolution {
  if (family.valueImplementationBindings.length === 0) {
    return { kind: "admitted", family };
  }
  const selections = family.implementationSelections.map((selection) =>
    resolveImplementationSelection(
      source,
      candidates,
      selection,
      resolutionFor,
      bodyInspectionIsCertified,
    )
  );
  return admittedFamily(
    family.component,
    selections,
    candidates,
    family,
  );
}

export function sameInterfaceFamilyResolutions(
  left: readonly InterfaceFamilyResolution[],
  right: readonly InterfaceFamilyResolution[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const byContract = indexFamiliesByContract(right);
  return left.every((family) => {
    const selected = matchingFamily(family, byContract);
    return selected !== undefined &&
      sameNodes(family.contractDeclarations, selected.contractDeclarations) &&
      sameNodes(family.calls, selected.calls) &&
      sameImplementationSelections(
        family.implementationSelections,
        selected.implementationSelections,
      ) &&
      sameNodes(family.implementations, selected.implementations) &&
      sameNodes(
        family.valueImplementationBindings,
        selected.valueImplementationBindings,
      ) &&
      sameNodes(
        family.returnContractBlockers,
        selected.returnContractBlockers,
      ) &&
      sameNodes(
        family.candidateDeclarations,
        selected.candidateDeclarations,
      ) && sameReturnRewrites(family.returnRewrites, selected.returnRewrites);
  });
}

export function interfaceFamilyResolutionsRefine(
  current: readonly InterfaceFamilyResolution[],
  previous: readonly InterfaceFamilyResolution[],
): boolean {
  if (current.length > previous.length) {
    return false;
  }
  const admitted = indexFamiliesByContract(previous);
  return current.every((family) => {
    const prior = matchingFamily(family, admitted);
    return prior !== undefined &&
      sameNodes(family.contractDeclarations, prior.contractDeclarations) &&
      sameNodes(family.calls, prior.calls) &&
      implementationSelectionsRefine(
        family.implementationSelections,
        prior.implementationSelections,
      ) &&
      nodesAreSubset(
        family.valueImplementationBindings,
        prior.valueImplementationBindings,
      ) &&
      nodesAreSubset(prior.implementations, family.implementations) &&
      nodesAreSubset(
        prior.candidateDeclarations,
        family.candidateDeclarations,
      ) &&
      sameNodes(family.returnContractBlockers, prior.returnContractBlockers) &&
      sameReturnRewrites(family.returnRewrites, prior.returnRewrites);
  });
}

function indexFamiliesByContract(
  families: readonly InterfaceFamilyResolution[],
): ReadonlyMap<Node, InterfaceFamilyResolution> {
  const result = new Map<Node, InterfaceFamilyResolution>();
  for (const family of families) {
    for (const contract of family.contractDeclarations) {
      const existing = result.get(contract);
      if (existing !== undefined && existing !== family) {
        throw new Error(
          "interface contract belongs to multiple dispatch families",
        );
      }
      result.set(contract, family);
    }
  }
  return result;
}

function matchingFamily(
  family: InterfaceFamilyResolution,
  byContract: ReadonlyMap<Node, InterfaceFamilyResolution>,
): InterfaceFamilyResolution | undefined {
  const first = family.contractDeclarations[0];
  if (first === undefined) {
    throw new Error("interface dispatch family has no contract declaration");
  }
  return byContract.get(first);
}

function admittedFamily(
  component: InterfaceContractComponent,
  implementationSelections: readonly DeclaredInterfaceImplementationSelection[],
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  inherited?: DeclaredInterfaceDispatchFamily,
): InterfaceDispatchFamilyResolution {
  const implementations = new Set(
    implementationSelections.flatMap((selection) => selection.implementations),
  );
  const valueImplementationBindings = new Set(
    implementationSelections.flatMap((selection) =>
      selection.valueImplementationBindings
    ),
  );
  const candidateList = Object.freeze([...new Set(
    [...implementations].flatMap((implementation) => {
      const candidate = candidates.get(implementation);
      return candidate === undefined ? [] : [candidate];
    }),
  )]);
  return Object.freeze({
    kind: "admitted",
    family: Object.freeze({
      component,
      implementationSelections: Object.freeze(implementationSelections),
      contractDeclarations: inherited?.contractDeclarations ?? Object.freeze(
        component.entries.map((entry) => entry.declaration),
      ),
      calls: inherited?.calls ?? Object.freeze(
        component.entries.flatMap((entry) => entry.calls),
      ),
      implementations: Object.freeze([...implementations]),
      valueImplementationBindings: Object.freeze([
        ...valueImplementationBindings,
      ]),
      candidateDeclarations: Object.freeze(candidateList.map((candidate) =>
        candidate.declaration
      )),
      candidates: candidateList,
      ...(candidateList[0] === undefined
        ? {}
        : { coordinator: candidateList[0] }),
      returnRewrites: inherited?.returnRewrites ?? collectReturnRewrites(component),
      returnContractBlockers: inherited?.returnContractBlockers ?? Object.freeze([
        ...new Set(component.entries.flatMap((entry) =>
          entry.implementationReturnContractBlockers
        )),
      ]),
    }),
  });
}

function collectReturnRewrites(
  component: InterfaceContractComponent,
): readonly CallableReturnRewrite[] {
  const rewrites = new Map<Node, CallableReturnRewrite>();
  for (const rewrite of component.entries.flatMap((entry) => [
    entry.returnRewrite,
    ...entry.implementationReturnRewrites,
  ])) {
    const existing = rewrites.get(rewrite.target);
    if (
      existing !== undefined &&
      (existing.selection.kind !== rewrite.selection.kind ||
        existing.selection.index !== rewrite.selection.index)
    ) {
      throw new Error("interface family has conflicting return rewrites");
    }
    rewrites.set(rewrite.target, rewrite);
  }
  return Object.freeze([...rewrites.values()]);
}

function resolveImplementationSelection(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  selection: DeclaredInterfaceImplementationSelection,
  resolutionFor: (declaration: Node) => CallableValueResolution | undefined,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
): DeclaredInterfaceImplementationSelection {
  const implementations = new Set(selection.implementations);
  const unresolvedBindings = new Set<Node>();
  for (const binding of selection.valueImplementationBindings) {
    const resolution = resolutionFor(binding);
    if (resolution === undefined || !resolution.closed) {
      unresolvedBindings.add(binding);
      continue;
    }
    const origins = new Set([
      ...resolution.dependencyNodes(),
      ...resolution.synchronousDeclarationNodes(),
    ]);
    if (origins.size === 0) {
      continue;
    }
    if (
      [...origins].some((origin) =>
        !candidates.has(origin) &&
        !interfaceImplementationUsesSynchronousTransport(
          source,
          origin,
          bodyInspectionIsCertified,
        )
      )
    ) {
      unresolvedBindings.add(binding);
      continue;
    }
    for (const origin of origins) {
      implementations.add(origin);
    }
  }
  return Object.freeze({
    declaration: selection.declaration,
    implementations: Object.freeze([...implementations]),
    valueImplementationBindings: Object.freeze([...unresolvedBindings]),
  });
}

function sameImplementationSelections(
  left: readonly DeclaredInterfaceImplementationSelection[],
  right: readonly DeclaredInterfaceImplementationSelection[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const selected = new Map(right.map((entry) => [entry.declaration, entry]));
  return left.every((entry) => {
    const other = selected.get(entry.declaration);
    return other !== undefined &&
      sameNodes(entry.implementations, other.implementations) &&
      sameNodes(
        entry.valueImplementationBindings,
        other.valueImplementationBindings,
      );
  });
}

function implementationSelectionsRefine(
  current: readonly DeclaredInterfaceImplementationSelection[],
  previous: readonly DeclaredInterfaceImplementationSelection[],
): boolean {
  const selected = new Map(previous.map((entry) => [entry.declaration, entry]));
  return current.length === previous.length && current.every((entry) => {
    const prior = selected.get(entry.declaration);
    return prior !== undefined &&
      nodesAreSubset(
        entry.valueImplementationBindings,
        prior.valueImplementationBindings,
      ) &&
      nodesAreSubset(prior.implementations, entry.implementations);
  });
}

function implementationIsValueBinding(
  source: TargetSourceProgram,
  implementation: Node,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
): boolean {
  return sourceBodyInspectionIsExact(
    source,
    implementation,
    bodyInspectionIsCertified,
  ) &&
    (source.ast.is.IsPropertyDeclaration(implementation) ||
      source.ast.is.IsParameterDeclaration(implementation) ||
      source.ast.is.IsPropertyAssignment(implementation) ||
      source.ast.is.IsShorthandPropertyAssignment(implementation));
}

function sameNodes(left: readonly Node[], right: readonly Node[]): boolean {
  return left.length === right.length && nodesAreSubset(left, right);
}

function sameReturnRewrites(
  left: readonly CallableReturnRewrite[],
  right: readonly CallableReturnRewrite[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const selected = new Map(right.map((rewrite) => [rewrite.target, rewrite]));
  return left.every((rewrite) => {
    const other = selected.get(rewrite.target);
    return other !== undefined &&
      other.selection.kind === rewrite.selection.kind &&
      other.selection.index === rewrite.selection.index;
  });
}

function nodesAreSubset(left: readonly Node[], right: readonly Node[]): boolean {
  const selected = new Set(right);
  return left.every((node) => selected.has(node));
}
