import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { InvocationTransportContract } from "../../../invocation-transport.js";
import { composeInvocationTransportContracts } from "../../../invocation-transport.js";
import type { SourceIdentityResolver } from "../../../occurrence.js";
import type { TypeScriptPlanningObserver } from "../../../planning-observer.js";
import type { TargetProgramIndex } from "../../../program-index.js";
import type {
  TypeScriptActiveCooperativeEffectProfile,
  TypeScriptInterfaceDispatchProfile,
} from "../../../profile.js";
import type { CooperativeEffectCandidate } from "../../inventory/candidates.js";
import type { ExactAggregateProjectionIndex } from "../aggregate/projection.js";
import type { CallableFields } from "../storage/fields.js";
import type { ExactInvocationInputIndex } from "../invocation/inputs.js";
import {
  createExactIndirectInvocationAnalysis,
  type ExactIndirectInvocationAnalysis,
  type ExactIndirectInvocationFacts,
} from "../invocation/indirect.js";
import {
  createDeclaredInterfaceDispatch,
  type DeclaredInterfaceDispatch,
} from "../interface/dispatch.js";
import type { ExactObjectPropertyProjectionIndex } from "../object/projection.js";
import type { ClosedStorageOwnerAnalysis } from "../storage/analysis.js";
import type { StorageOwnerBoundaryDependencies } from "../storage/owner-boundaries.js";
import {
  collectCallableValueCensus,
  createCallableInterfaceEvidence,
  createCallableValueFlow,
  type CallableValueCensus,
  type CallableValueFlow,
  type CallableValueFlowRequest,
} from "../callable/value-flow.js";
import type {
  ExactCallImplementations,
} from "../callable/result-inputs.js";
import type { CallableInterfaceEvidence } from "../callable/provenance/interface-evidence.js";
import type { SourceInvocationFlow } from "../source-invocation/flow.js";

export interface CooperativeEffectFlowSettlementRequest {
  readonly source: TargetSourceProgram;
  readonly program: TargetProgramIndex;
  readonly candidates: ReadonlyMap<Node, CooperativeEffectCandidate>;
  readonly callableExpressionQueries: readonly Node[];
  readonly sourceIdentityFor: SourceIdentityResolver;
  readonly interfaceDispatch: TypeScriptInterfaceDispatchProfile;
  readonly cooperativeEffects: TypeScriptActiveCooperativeEffectProfile;
  readonly sourceInvocations: SourceInvocationFlow;
  readonly factOwnedTransports?: InvocationTransportContract;
  readonly directInvocationInputs: ExactInvocationInputIndex;
  readonly aggregateProjections: ExactAggregateProjectionIndex;
  readonly objectProjections: ExactObjectPropertyProjectionIndex;
  readonly storageOwners: ClosedStorageOwnerAnalysis;
  readonly callableFields: CallableFields;
  readonly exactStorageDependencies?: StorageOwnerBoundaryDependencies;
  readonly callableStorageDependencies?: StorageOwnerBoundaryDependencies;
  readonly interfaceStorageDependencies?: StorageOwnerBoundaryDependencies;
  readonly planningObserver?: TypeScriptPlanningObserver;
}

export interface CooperativeEffectFlowSettlement {
  readonly interfaces: DeclaredInterfaceDispatch;
  readonly indirectInvocations: ExactIndirectInvocationFacts;
  readonly valueFlow: CallableValueFlow;
  readonly completeTransports?: InvocationTransportContract;
  readonly exactCallImplementations: ExactCallImplementations;
}

export function settleCooperativeEffectFlows(
  request: CooperativeEffectFlowSettlementRequest,
): CooperativeEffectFlowSettlement {
  const {
    source,
    program,
    candidates,
    callableExpressionQueries,
    sourceIdentityFor,
    interfaceDispatch,
    cooperativeEffects,
    sourceInvocations,
    factOwnedTransports,
    directInvocationInputs,
    aggregateProjections,
    objectProjections,
    storageOwners,
    callableFields,
    exactStorageDependencies,
    callableStorageDependencies,
    interfaceStorageDependencies,
    planningObserver,
  } = request;
  const candidateDeclarations = new Set(candidates.keys());
  const preliminaryAnalysis = createExactIndirectInvocationAnalysis(
    source,
    program,
    directInvocationInputs,
    aggregateProjections,
    objectProjections,
    factOwnedTransports,
    sourceInvocations.implementationsFor,
    planningObserver,
    callableFields,
    storageOwners,
    exactStorageDependencies,
    interfaceDispatch === "declared-closed"
      ? "declared-interface"
      : "none",
    interfaceStorageDependencies,
    sourceInvocations.bodyInspectionIsCertified,
    cooperativeEffects,
  );
  const preliminaryFacts = preliminaryAnalysis.finalize();
  planningObserver?.("effect-indirect-invocations");
  let interfaces = createDeclaredInterfaceDispatch(
    source,
    program,
    candidates,
    interfaceDispatch,
    factOwnedTransports,
    sourceIdentityFor,
    Object.freeze({
      invocationInputs: preliminaryFacts.invocationInputs,
      exactCallImplementations: composeExactCallImplementations([
        sourceInvocations.implementationsFor,
        preliminaryFacts.implementationsFor,
      ]),
      callableReferenceIsClosed: preliminaryFacts.allowsCallableReference,
      aggregateProjections,
      objectProjections,
      storageOwners,
      bodyInspectionIsCertified: sourceInvocations.bodyInspectionIsCertified,
    }),
    cooperativeEffects,
    planningObserver,
  );
  planningObserver?.("effect-interface-dispatch");
  const callableValueCensus = collectCallableValueCensus(
    source,
    program,
    planningObserver,
    sourceInvocations.bodyInspectionIsCertified,
  );
  let settledInvocations: ExactIndirectInvocationFacts | undefined;
  let settledValueFlow: CallableValueFlow | undefined;
  let settledTransports: InvocationTransportContract | undefined;
  const maximumRounds = program.nodes.length + candidates.size +
    interfaces.consideredFamilyCount + 1;
  for (let round = 0; round <= maximumRounds; round += 1) {
    const transports = composeInvocationTransportContracts([
      factOwnedTransports,
      interfaces.invocationTransports,
    ]);
    const indirectInvocations = refineIndirectInvocations(
      interfaceDispatch,
      preliminaryAnalysis,
      preliminaryFacts,
      interfaces,
      transports,
      sourceInvocations.implementationsFor,
      planningObserver,
    );
    const bootstrapImplementations = composeExactCallImplementations([
      sourceInvocations.implementationsFor,
      indirectInvocations.implementationsFor,
      interfaces.implementationsForCall,
    ]);
    const callableEvidence = createCallableInterfaceEvidence(
      createRoundCallableValueRequest(
        request,
        candidateDeclarations,
        callableValueCensus,
        interfaces,
        indirectInvocations,
        transports,
        bootstrapImplementations,
      ),
    );
    const resolvedInterfaces = interfaces.resolveValueImplementations(
      callableEvidence.resolutionForDeclaration,
    );
    if (!resolvedInterfaces.refines(interfaces)) {
      throw new Error(
        "interface value-implementation settlement is not monotonic",
      );
    }
    if (!resolvedInterfaces.sameResolution(interfaces)) {
      interfaces = resolvedInterfaces;
      continue;
    }
    const validatedInterfaces = postValidateInterfaceDispatch(
      request,
      resolvedInterfaces,
      indirectInvocations,
      callableEvidence,
    );
    if (!validatedInterfaces.refines(resolvedInterfaces)) {
      throw new Error(
        "post-validated interface settlement exceeded its provisional domain",
      );
    }
    if (!validatedInterfaces.sameResolution(resolvedInterfaces)) {
      interfaces = validatedInterfaces;
      continue;
    }
    interfaces = validatedInterfaces;
    const finalTransports = composeInvocationTransportContracts([
      factOwnedTransports,
      interfaces.invocationTransports,
    ]);
    const finalBootstrapImplementations = composeExactCallImplementations([
      sourceInvocations.implementationsFor,
      indirectInvocations.implementationsFor,
      interfaces.implementationsForCall,
    ]);
    const valueFlow = createCallableValueFlow(
      createRoundCallableValueRequest(
        request,
        candidateDeclarations,
        callableValueCensus,
        interfaces,
        indirectInvocations,
        finalTransports,
        finalBootstrapImplementations,
      ),
    );
    const finalInterfaces = interfaces.resolveValueImplementations(
      (declaration) => valueFlow.resolutionForDeclaration(declaration),
    );
    if (!finalInterfaces.sameResolution(interfaces)) {
      throw new Error(
        "final callable flow disagrees with certified interface settlement",
      );
    }
    settledInvocations = indirectInvocations;
    settledValueFlow = valueFlow;
    settledTransports = finalTransports;
    break;
  }
  if (settledInvocations === undefined || settledValueFlow === undefined) {
    throw new Error(
      "interface callable settlement exceeded its finite domain",
    );
  }
  const exactCallImplementations = composeExactCallImplementations([
    sourceInvocations.implementationsFor,
    settledInvocations.implementationsFor,
    callableFlowImplementations(settledValueFlow),
    interfaces.implementationsForCall,
  ]);
  return Object.freeze({
    interfaces,
    indirectInvocations: settledInvocations,
    valueFlow: settledValueFlow,
    ...(settledTransports === undefined
      ? {}
      : { completeTransports: settledTransports }),
    exactCallImplementations,
  });
}

function postValidateInterfaceDispatch(
  request: CooperativeEffectFlowSettlementRequest,
  provisional: DeclaredInterfaceDispatch,
  indirectInvocations: ExactIndirectInvocationFacts,
  callableEvidence: CallableInterfaceEvidence,
): DeclaredInterfaceDispatch {
  const {
    source,
    program,
    candidates,
    sourceIdentityFor,
    interfaceDispatch,
    cooperativeEffects,
    sourceInvocations,
    factOwnedTransports,
    aggregateProjections,
    objectProjections,
    storageOwners,
    planningObserver,
  } = request;
  const validated = createDeclaredInterfaceDispatch(
    source,
    program,
    candidates,
    interfaceDispatch,
    factOwnedTransports,
    sourceIdentityFor,
    Object.freeze({
      invocationInputs: indirectInvocations.invocationInputs,
      exactCallImplementations: composeExactCallImplementations([
        sourceInvocations.implementationsFor,
        indirectInvocations.implementationsFor,
        provisional.implementationsForCall,
        callableEvidence.implementationsForCall,
      ]),
      callableReferenceIsClosed: (reference: Node) =>
        indirectInvocations.allowsCallableReference(reference) ||
        callableEvidence.allowsCallableReference(reference),
      aggregateProjections,
      objectProjections,
      storageOwners,
      bodyInspectionIsCertified: sourceInvocations.bodyInspectionIsCertified,
    }),
    cooperativeEffects,
    planningObserver,
  );
  return validated.resolveValueImplementations(
    callableEvidence.resolutionForDeclaration,
  );
}

function createRoundCallableValueRequest(
  request: CooperativeEffectFlowSettlementRequest,
  candidateDeclarations: ReadonlySet<Node>,
  census: CallableValueCensus,
  interfaces: DeclaredInterfaceDispatch,
  indirectInvocations: ExactIndirectInvocationFacts,
  transports: InvocationTransportContract | undefined,
  implementations: ExactCallImplementations,
): CallableValueFlowRequest {
  return Object.freeze({
    source: request.source,
    program: request.program,
    candidates: candidateDeclarations,
    census,
    expressionQueries: request.callableExpressionQueries,
    declarationQueries: interfaces.families.flatMap((family) =>
      family.valueImplementationBindings
    ),
    projections: request.aggregateProjections,
    transports,
    exactCallImplementations: implementations,
    invocationInputs: indirectInvocations.invocationInputs,
    exactContractImplementations: interfaces.implementationsForDeclaration,
    objectProjections: request.objectProjections,
    callableReferenceIsClosed: indirectInvocations.allowsCallableReference,
    callableFields: request.callableFields,
    storageOwners: request.storageOwners,
    boundaryDependencies: request.callableStorageDependencies,
    planningObserver: request.planningObserver,
    bodyInspectionIsCertified:
      request.sourceInvocations.bodyInspectionIsCertified,
    cooperativeEffects: request.cooperativeEffects,
  });
}

function callableFlowImplementations(
  valueFlow: CallableValueFlow,
): ExactCallImplementations {
  return (call) => {
    const resolution = valueFlow.resolutionFor(call);
    if (resolution?.closed !== true) {
      return undefined;
    }
    const implementations = new Set([
      ...resolution.dependencyNodes(),
      ...resolution.synchronousDeclarationNodes(),
    ]);
    return Object.freeze([...implementations]);
  };
}

function refineIndirectInvocations(
  interfaceDispatch: TypeScriptInterfaceDispatchProfile,
  preliminaryAnalysis: ExactIndirectInvocationAnalysis,
  preliminaryFacts: ExactIndirectInvocationFacts,
  interfaces: DeclaredInterfaceDispatch,
  transports: InvocationTransportContract | undefined,
  sourceImplementations: ExactCallImplementations,
  planningObserver: TypeScriptPlanningObserver | undefined,
): ExactIndirectInvocationFacts {
  return interfaceDispatch === "open-structural"
    ? preliminaryFacts
    : preliminaryAnalysis.refine(
        interfaces.invocationInputs,
        transports,
        composeExactCallImplementations([
          sourceImplementations,
          interfaces.implementationsForCall,
        ]),
        planningObserver,
      ).finalize();
}

function composeExactCallImplementations(
  contracts: readonly (ExactCallImplementations | undefined)[],
): ExactCallImplementations {
  const selected = contracts.filter(
    (contract): contract is ExactCallImplementations => contract !== undefined,
  );
  return (call) => {
    let selectedCall = false;
    const implementations = new Set<Node>();
    for (const contract of selected) {
      const resolved = contract(call);
      if (resolved === undefined) {
        continue;
      }
      selectedCall = true;
      for (const implementation of resolved) {
        implementations.add(implementation);
      }
    }
    return selectedCall
      ? Object.freeze([...implementations])
      : undefined;
  };
}
