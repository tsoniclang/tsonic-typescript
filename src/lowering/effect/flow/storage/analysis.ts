import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { TypeScriptPlanningObserver } from "../../../planning-observer.js";
import type { ExactCallImplementations } from "../callable/result-inputs.js";
import {
  type ExactSourceBodyInspection,
  sourceBodyInspectionIsExact,
} from "../../model/source-membership.js";
import {
  createStorageOwnerTopology,
  type StorageOwnerTopology,
} from "./owner-topology.js";
import { collectClosedStorageOwners } from "./owners.js";

export interface ClosedStorageOwnerAnalysis {
  readonly owners: ReadonlySet<Node>;
  readonly bodyInspectionIsExact: ExactSourceBodyInspection;
  topology(
    planningObserver?: TypeScriptPlanningObserver,
  ): StorageOwnerTopology;
}

export function createClosedStorageOwnerAnalysis(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
  exactCallImplementations?: ExactCallImplementations,
): ClosedStorageOwnerAnalysis {
  const owners = collectClosedStorageOwners(
    source,
    program,
    bodyInspectionIsCertified,
    exactCallImplementations,
  );
  const bodyInspectionIsExact = (declaration: Node): boolean =>
    sourceBodyInspectionIsExact(
      source,
      declaration,
      bodyInspectionIsCertified,
    );
  let topology: StorageOwnerTopology | undefined;
  return Object.freeze({
    owners,
    bodyInspectionIsExact,
    topology(
      planningObserver?: TypeScriptPlanningObserver,
    ): StorageOwnerTopology {
      topology ??= createStorageOwnerTopology(
        source,
        program,
        owners,
        planningObserver,
        bodyInspectionIsCertified,
      );
      return topology;
    },
  });
}
