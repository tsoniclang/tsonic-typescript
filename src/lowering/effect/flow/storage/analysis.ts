import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { TypeScriptPlanningObserver } from "../../../planning-observer.js";
import {
  createStorageOwnerTopology,
  type StorageOwnerTopology,
} from "./owner-topology.js";
import { collectClosedStorageOwners } from "./owners.js";

export interface ClosedStorageOwnerAnalysis {
  readonly owners: ReadonlySet<Node>;
  topology(
    planningObserver?: TypeScriptPlanningObserver,
  ): StorageOwnerTopology;
}

export function createClosedStorageOwnerAnalysis(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ClosedStorageOwnerAnalysis {
  const owners = collectClosedStorageOwners(source, program);
  let topology: StorageOwnerTopology | undefined;
  return Object.freeze({
    owners,
    topology(
      planningObserver?: TypeScriptPlanningObserver,
    ): StorageOwnerTopology {
      topology ??= createStorageOwnerTopology(
        source,
        program,
        owners,
        planningObserver,
      );
      return topology;
    },
  });
}
