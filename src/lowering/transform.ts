import type { Node, SourceFile } from "@tsonic/tsts";
import { transformTargetSourceFile } from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import {
  createTypeScriptOptimizationEvidence,
  type TypeScriptOptimizationEvidence,
} from "./evidence.js";
import {
  createFinalNodeJournal,
  type FinalNodeJournal,
} from "./final-nodes.js";
import { createProgramGeneratedNames } from "./generated-names.js";
import {
  createClosedPointerFlowPlan,
} from "./pointer/flow-plan.js";
import { createPointerProjectionCallablePlan } from "./pointer/projection-callable-plan.js";
import {
  createPointerRewriteSession,
  type PointerLoweringResult,
  type PointerRewriteSession,
} from "./pointer/transform.js";
import { createDominatingNilCheckPlan } from "./pointer/nil-check/plan.js";
import {
  createDominatingNilCheckRewriteSession,
  type DominatingNilCheckRewriteResult,
  type DominatingNilCheckRewriteSession,
} from "./pointer/nil-check/rewrite.js";
import {
  createTypeScriptOptimizationProfile,
  type TypeScriptOptimizationProfileInput,
} from "./profile.js";
import { createTargetProgramIndex } from "./program-index.js";
import {
  sourceExecutionViolations,
  type TypeScriptSourceExecutionProfile,
} from "../source-contract/execution.js";
import { createRepresentationProjectionPlan } from "./representation/plan.js";
import {
  canonicalRepresentationTransportContract,
  type RepresentationTransportContract,
} from "./representation/transport-contract.js";
import {
  createRepresentationProjectionRewriter,
  type RepresentationProjectionRewriter,
  type RepresentationProjectionRewriteResult,
} from "./representation/transform.js";
import { createScalarRepresentationPlan } from "./scalar/plan.js";
import {
  createScalarRepresentationRewriter,
  type ScalarRepresentationRewriter,
  type ScalarRepresentationRewriteResult,
} from "./scalar/transform.js";

export interface TypeScriptSourceLoweringResult {
  readonly sourceFile: SourceFile;
  readonly pointer: PointerLoweringResult;
  readonly scalar: ScalarRepresentationRewriteResult;
  readonly representation: RepresentationProjectionRewriteResult;
  readonly nilChecks: DominatingNilCheckRewriteResult;
}

export interface TypeScriptSourcePlanningFailure {
  readonly sourceFile: SourceFile;
  readonly message: string;
}

export type TypeScriptLoweringPreparation =
  | {
      readonly kind: "ready";
      readonly transaction: TypeScriptLoweringTransaction;
    }
  | {
      readonly kind: "rejected";
      readonly failures: readonly TypeScriptSourcePlanningFailure[];
    };

export interface TypeScriptLoweringTransaction {
  readonly evidence: TypeScriptOptimizationEvidence;
  lower(sourceFile: SourceFile): TypeScriptSourceLoweringResult;
  finish(): void;
}

interface SourceRewritePlan {
  readonly finalNodes: FinalNodeJournal;
  readonly pointer: PointerRewriteSession;
  readonly scalar: ScalarRepresentationRewriter;
  readonly representation: RepresentationProjectionRewriter;
  readonly nilChecks: DominatingNilCheckRewriteSession;
}

interface SourceIdentityIndex {
  readonly membership: readonly string[];
  forFile(sourceFile: SourceFile): string;
}

export function prepareTypeScriptLowering(
  source: TargetSourceProgram,
  sourceFiles: readonly SourceFile[],
  profileInput: TypeScriptOptimizationProfileInput,
  sourceIdentityFor: (sourceFile: SourceFile) => string,
  execution: TypeScriptSourceExecutionProfile = "unrestricted",
  representationTransports: RepresentationTransportContract =
    canonicalRepresentationTransportContract(),
): TypeScriptLoweringPreparation {
  assertExactSourceMembership(source, sourceFiles);
  const profile = createTypeScriptOptimizationProfile(profileInput);
  const identities = collectSourceIdentities(sourceFiles, sourceIdentityFor);
  const program = createTargetProgramIndex(source, {
    bindingWrites: profile.pointerFlows === "closed-direct" ||
      profile.scalarProjections === "closed-direct" ||
      profile.representationProjections === "closed-direct",
  });
  const executionFailures = sourceExecutionViolations(
    source,
    program,
    execution,
  );
  if (executionFailures.length !== 0) {
    return Object.freeze({
      kind: "rejected",
      failures: Object.freeze(executionFailures.map((failure) =>
        Object.freeze({
          sourceFile: failure.sourceFile,
          message: failure.message,
        })
      )),
    });
  }
  const generatedNames = createProgramGeneratedNames(source, program);
  const pointerFlowPlan = profile.pointerFlows === "closed-direct"
    ? createClosedPointerFlowPlan(
        source,
        program,
        generatedNames,
        identities.forFile,
        representationTransports,
      )
    : undefined;
  const pointerProjectionCallables = createPointerProjectionCallablePlan(
    source,
    program,
    profile.pointerFlows,
    identities.forFile,
  );
  const scalarPlan = createScalarRepresentationPlan(
    source,
    program,
    profile.scalarProjections,
    identities.forFile,
  );
  const representationPlan = createRepresentationProjectionPlan(
    source,
    program,
    profile.representationProjections,
    identities.forFile,
  );
  const nilCheckPlan = createDominatingNilCheckPlan(
    source,
    program,
    generatedNames,
    pointerFlowPlan,
    profile.pointerFlows,
    identities.forFile,
  );
  const evidence = createTypeScriptOptimizationEvidence(
    execution,
    profile,
    identities.membership,
    program.operations,
    pointerFlowPlan,
    pointerProjectionCallables,
    nilCheckPlan,
    scalarPlan,
    representationPlan,
    representationTransports,
  );
  const plans = new Map<SourceFile, SourceRewritePlan>();
  const failures: TypeScriptSourcePlanningFailure[] = [];
  for (const sourceFile of sourceFiles) {
    try {
      const finalNodes = createFinalNodeJournal();
      plans.set(sourceFile, Object.freeze({
        finalNodes,
        pointer: createPointerRewriteSession(
          source,
          sourceFile,
          program,
          generatedNames.forFile(sourceFile),
          pointerFlowPlan,
          pointerProjectionCallables,
          finalNodes,
        ),
        scalar: createScalarRepresentationRewriter(scalarPlan, sourceFile),
        representation: createRepresentationProjectionRewriter(
          representationPlan,
          sourceFile,
        ),
        nilChecks: createDominatingNilCheckRewriteSession(
          nilCheckPlan.forFile(sourceFile),
          finalNodes,
        ),
      }));
    } catch (error) {
      failures.push(Object.freeze({
        sourceFile,
        message: errorMessage(error),
      }));
    }
  }
  if (failures.length !== 0) {
    return Object.freeze({
      kind: "rejected",
      failures: Object.freeze(failures),
    });
  }
  return Object.freeze({
    kind: "ready",
    transaction: createTransaction(plans, evidence),
  });
}

function collectSourceIdentities(
  sourceFiles: readonly SourceFile[],
  sourceIdentityFor: (sourceFile: SourceFile) => string,
): SourceIdentityIndex {
  const byFile = new Map(
    sourceFiles.map((sourceFile) => [
      sourceFile,
      sourceIdentityFor(sourceFile),
    ] as const),
  );
  const membership = [...byFile.values()].sort(compareText);
  if (
    membership.some((identity) => identity.length === 0) ||
    new Set(membership).size !== membership.length
  ) {
    throw new Error(
      "TypeScript lowering requires one non-empty identity per checked source file",
    );
  }
  return Object.freeze({
    membership: Object.freeze(membership),
    forFile(sourceFile: SourceFile): string {
      const identity = byFile.get(sourceFile);
      if (identity === undefined) {
        throw new Error("TypeScript lowering requested a foreign source identity");
      }
      return identity;
    },
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function createTransaction(
  plans: Map<SourceFile, SourceRewritePlan>,
  evidence: TypeScriptOptimizationEvidence,
): TypeScriptLoweringTransaction {
  const expectedSourceCount = plans.size;
  const consumed = new Set<SourceFile>();
  let finished = false;
  return Object.freeze({
    evidence,
    lower(sourceFile: SourceFile): TypeScriptSourceLoweringResult {
      if (finished) {
        throw new Error("TypeScript lowering transaction is already sealed");
      }
      if (consumed.has(sourceFile)) {
        throw new Error("TypeScript lowering visited a source file twice");
      }
      const plan = plans.get(sourceFile);
      if (plan === undefined) {
        throw new Error("TypeScript lowering received an unplanned source file");
      }
      consumed.add(sourceFile);
      plans.delete(sourceFile);
      const transformed = transformTargetSourceFile(
        sourceFile,
        (original: Node, updated, factory) => {
          const pointerResult = plan.pointer.rewrite(
            original,
            updated,
            factory,
          );
          if (pointerResult === undefined) {
            return plan.finalNodes.record(original, undefined);
          }
          const scalarResult = plan.scalar.rewrite(
            original,
            pointerResult,
            factory,
          );
          if (scalarResult === undefined) {
            return plan.finalNodes.record(original, undefined);
          }
          const representationResult = plan.representation.rewrite(
            original,
            scalarResult,
            factory,
          );
          if (representationResult === undefined) {
            return plan.finalNodes.record(original, undefined);
          }
          const nilCheckResult = plan.nilChecks.rewrite(
            original,
            representationResult,
            factory,
          );
          return plan.finalNodes.record(original, nilCheckResult);
        },
      );
      const pointer = plan.pointer.finish(transformed);
      const scalar = plan.scalar.finish(pointer.sourceFile);
      const representation = plan.representation.finish(scalar.sourceFile);
      const nilChecks = plan.nilChecks.finish(representation.sourceFile);
      return Object.freeze({
        sourceFile: nilChecks.sourceFile,
        pointer,
        scalar,
        representation,
        nilChecks,
      });
    },
    finish(): void {
      if (finished) {
        throw new Error("TypeScript lowering transaction was sealed twice");
      }
      finished = true;
      if (consumed.size !== expectedSourceCount || plans.size !== 0) {
        throw new Error(
          `TypeScript lowering consumed ${consumed.size} source files, expected ${expectedSourceCount}`,
        );
      }
    },
  });
}

function assertExactSourceMembership(
  source: TargetSourceProgram,
  sourceFiles: readonly SourceFile[],
): void {
  const expected = new Set(source.navigation.sourceFiles);
  const supplied = new Set(sourceFiles);
  if (
    supplied.size !== sourceFiles.length ||
    supplied.size !== expected.size ||
    [...expected].some((sourceFile) => !supplied.has(sourceFile))
  ) {
    throw new Error(
      "TypeScript lowering requires every exact checked project source file once",
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
