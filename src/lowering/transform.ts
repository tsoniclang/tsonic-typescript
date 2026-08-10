import type {
  Node,
  SourceFile,
} from "@tsonic/tsts";
import {
  transformTargetSourceFile,
} from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api";

import {
  createClosedCooperativeEffectPlan,
  type CooperativeEffectPlan,
} from "./effect/plan.js";
import {
  createCooperativeEffectRewriteSession,
  type CooperativeEffectRewriteResult,
  type CooperativeEffectRewriteSession,
} from "./effect/transform.js";
import {
  createTypeScriptOptimizationEvidence,
  type TypeScriptOptimizationEvidence,
} from "./evidence.js";

import {
  createClosedPointerFlowPlan,
} from "./pointer/flow-plan.js";
import {
  createPointerRewriteSession,
  type PointerLoweringResult,
  type PointerRewriteSession,
} from "./pointer/transform.js";
import type { TypeScriptOptimizationProfile } from "./profile.js";
import {
  createScalarRepresentationPlan,
} from "./scalar/plan.js";
import {
  createScalarRepresentationRewriter,
  type ScalarRepresentationRewriter,
  type ScalarRepresentationRewriteResult,
} from "./scalar/transform.js";

export interface TypeScriptSourceLoweringResult {
  readonly sourceFile: SourceFile;
  readonly pointer: PointerLoweringResult;
  readonly scalar: ScalarRepresentationRewriteResult;
  readonly effect?: CooperativeEffectRewriteResult;
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
  readonly pointer: PointerRewriteSession;
  readonly scalar: ScalarRepresentationRewriter;
  readonly effect?: CooperativeEffectRewriteSession;
}

export function prepareTypeScriptLowering(
  source: TargetSourceProgram,
  sourceFiles: readonly SourceFile[],
  profile: TypeScriptOptimizationProfile,
): TypeScriptLoweringPreparation {
  assertExactSourceMembership(source, sourceFiles);
  const pointerFlowPlan = profile.pointerFlows === "closed-direct"
    ? createClosedPointerFlowPlan(source)
    : undefined;
  const scalarPlan = createScalarRepresentationPlan(
    source,
    profile.scalarProjections,
  );
  const effectPlan = profile.cooperativeEffects === "closed-direct"
    ? createClosedCooperativeEffectPlan(source)
    : undefined;
  const evidence = createTypeScriptOptimizationEvidence(
    profile,
    pointerFlowPlan,
    scalarPlan,
    effectPlan?.summary,
  );
  const plans = new Map<SourceFile, SourceRewritePlan>();
  const failures: TypeScriptSourcePlanningFailure[] = [];
  for (const sourceFile of sourceFiles) {
    try {
      plans.set(sourceFile, Object.freeze({
        pointer: createPointerRewriteSession(
          source,
          sourceFile,
          pointerFlowPlan,
        ),
        scalar: createScalarRepresentationRewriter(scalarPlan, sourceFile),
        ...(effectPlan === undefined
          ? {}
          : {
              effect: createCooperativeEffectRewriteSession(
                effectPlan,
                sourceFile,
              ),
            }),
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
    transaction: createTransaction(plans, effectPlan, evidence),
  });
}

function createTransaction(
  plans: ReadonlyMap<SourceFile, SourceRewritePlan>,
  effectPlan: CooperativeEffectPlan | undefined,
  evidence: TypeScriptOptimizationEvidence,
): TypeScriptLoweringTransaction {
  const consumed = new Set<SourceFile>();
  let finished = false;
  return Object.freeze({
    evidence,
    lower(sourceFile: SourceFile): TypeScriptSourceLoweringResult {
      if (finished) {
        throw new Error("TypeScript lowering transaction is already sealed");
      }
      const plan = plans.get(sourceFile);
      if (plan === undefined) {
        throw new Error("TypeScript lowering received an unplanned source file");
      }
      if (consumed.has(sourceFile)) {
        throw new Error("TypeScript lowering visited a source file twice");
      }
      consumed.add(sourceFile);
      const transformed = transformTargetSourceFile(
        sourceFile,
        (original: Node, updated, factory) => {
          const pointerResult = plan.pointer.rewrite(
            original,
            updated,
            factory,
          );
          if (pointerResult === undefined) {
            return undefined;
          }
          const scalarResult = plan.scalar.rewrite(
            original,
            pointerResult,
            factory,
          );
          if (scalarResult === undefined || plan.effect === undefined) {
            return scalarResult;
          }
          return plan.effect.rewrite(original, scalarResult, factory);
        },
      );
      const pointer = plan.pointer.finish(transformed);
      const scalar = plan.scalar.finish(pointer.sourceFile);
      const effect = plan.effect?.finish(scalar.sourceFile);
      return Object.freeze({
        sourceFile: effect?.sourceFile ?? scalar.sourceFile,
        pointer,
        scalar,
        ...(effect === undefined ? {} : { effect }),
      });
    },
    finish(): void {
      if (finished) {
        throw new Error("TypeScript lowering transaction was sealed twice");
      }
      finished = true;
      if (consumed.size !== plans.size) {
        throw new Error(
          `TypeScript lowering consumed ${consumed.size} source files, expected ${plans.size}`,
        );
      }
      effectPlan?.finish();
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
