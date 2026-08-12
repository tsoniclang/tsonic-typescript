import type {
  Node,
  SourceFile,
} from "@tsonic/tsts";
import {
  transformTargetSourceFile,
} from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api";

import {
  createFinalNodeJournal,
  type FinalNodeJournal,
} from "./final-nodes.js";

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
import { createPointerResultContract } from "./pointer/result-contract.js";
import {
  createPointerRewriteSession,
  type PointerLoweringResult,
  type PointerRewriteSession,
} from "./pointer/transform.js";
import {
  createTypeScriptOptimizationProfile,
  type TypeScriptOptimizationProfileInput,
} from "./profile.js";
import { createTargetProgramIndex } from "./program-index.js";
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
  readonly finalNodes: FinalNodeJournal;
  readonly pointer: PointerRewriteSession;
  readonly scalar: ScalarRepresentationRewriter;
  readonly effect?: CooperativeEffectRewriteSession;
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
): TypeScriptLoweringPreparation {
  assertExactSourceMembership(source, sourceFiles);
  const profile = createTypeScriptOptimizationProfile(profileInput);
  const identities = collectSourceIdentities(sourceFiles, sourceIdentityFor);
  const program = createTargetProgramIndex(source, {
    bindingWrites: profile.pointerFlows === "closed-direct" ||
      profile.scalarProjections === "closed-direct",
    memberDispatch: profile.cooperativeEffects === "closed-direct",
  });
  const pointerFlowPlan = profile.pointerFlows === "closed-direct"
    ? createClosedPointerFlowPlan(source, program, identities.forFile)
    : undefined;
  const scalarPlan = createScalarRepresentationPlan(
    source,
    program,
    profile.scalarProjections,
  );
  const effectPlan = profile.cooperativeEffects === "closed-direct"
    ? createClosedCooperativeEffectPlan(
        source,
        program,
        identities.forFile,
        createPointerResultContract(source, pointerFlowPlan),
      )
    : undefined;
  const evidence = createTypeScriptOptimizationEvidence(
    profile,
    identities.membership,
    program.operations,
    pointerFlowPlan,
    scalarPlan,
    effectPlan?.summary,
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
          pointerFlowPlan,
          finalNodes,
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
          const effectResult = plan.effect === undefined
            ? scalarResult
            : plan.effect.rewrite(original, scalarResult, factory);
          return plan.finalNodes.record(original, effectResult);
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
