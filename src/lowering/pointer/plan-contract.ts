import type {
  Node,
  PointerOperationFact,
  RawPointerOperationFact,
  SourceFile,
} from "@tsonic/tsts";

import type { GeneratedBindingName } from "../generated-names.js";
import type { DirectObjectReplacement } from "./direct-object-replacement.js";
import type { ClosedPointerFlowPlan } from "./flow-plan-contract.js";
import type {
  PointerInferenceStabilization,
} from "./inference-stabilization.js";
import type { PointerProjectionCallablePlan } from "./projection-callable-plan.js";
import type { ProjectedPropertyLocationFusion } from "./projected-property.js";
import type {
  RepresentationTransportInlinePlan,
} from "./representation-transport.js";

export interface LocalLocationBinding {
  readonly kind: "variable";
  readonly declaration: Node;
  readonly addressOperands: ReadonlySet<Node>;
  readonly sourceName: string;
  readonly locationName: GeneratedBindingName;
  readonly writeName: GeneratedBindingName;
}

export interface ParameterLocationBinding {
  readonly kind: "parameter";
  readonly declaration: Node;
  readonly addressOperands: ReadonlySet<Node>;
  readonly body: Node;
  readonly sourceName: string;
  readonly locationName: GeneratedBindingName;
  readonly writeName: GeneratedBindingName;
}

export type LocationBinding = LocalLocationBinding | ParameterLocationBinding;

export interface ReferenceHashPlan {
  readonly nullable: boolean;
  readonly parameterName?: GeneratedBindingName;
}

export interface PointerLoweringPlan {
  readonly sourceFile: SourceFile;
  readonly operations: ReadonlyMap<Node, PointerOperationFact>;
  readonly pointerTypes: ReadonlySet<Node>;
  readonly rawPointerOperations: ReadonlyMap<Node, RawPointerOperationFact>;
  readonly rawPointerTypes: ReadonlySet<Node>;
  readonly localBindings: ReadonlyMap<Node, LocalLocationBinding>;
  readonly localBindingsByStatement: ReadonlyMap<
    Node,
    readonly LocalLocationBinding[]
  >;
  readonly prologueBindingsByBody: ReadonlyMap<
    Node,
    readonly LocationBinding[]
  >;
  readonly addressBindings: ReadonlyMap<Node, LocationBinding>;
  readonly removableMarkerDeclarations: ReadonlySet<Node>;
  readonly flowPlan: ClosedPointerFlowPlan | undefined;
  readonly projectionCallables: PointerProjectionCallablePlan;
  readonly runtimeAlias: GeneratedBindingName;
  readonly referenceHashes: ReadonlyMap<Node, ReferenceHashPlan>;
  readonly inferenceStabilizations: ReadonlyMap<
    Node,
    PointerInferenceStabilization
  >;
  readonly directObjectReplacements: ReadonlyMap<Node, DirectObjectReplacement>;
  readonly projectedPropertyLocations: ReadonlyMap<
    Node,
    ProjectedPropertyLocationFusion
  >;
  readonly representationTransportInlines: RepresentationTransportInlinePlan;
  readonly projectedPropertyLocationClassName: GeneratedBindingName | undefined;
  readonly usesRuntimeValue: boolean;
}
