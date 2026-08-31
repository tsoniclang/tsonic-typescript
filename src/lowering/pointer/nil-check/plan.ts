import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { ProgramGeneratedNames } from "../../generated-names.js";
import type { SourceIdentityResolver } from "../../occurrence.js";
import type { TargetProgramIndex } from "../../program-index.js";
import { createOptimizationRetentionLedger } from "../../retention-evidence.js";

import type {
  DominatingNilCheckBindingPlan,
  DominatingNilCheckPlan,
  DominatingNilCheckRetentionReason,
  DominatingNilCheckSourcePlan,
} from "./model.js";

interface GuardCandidate {
  readonly guard: Node;
  readonly declaration: Node;
  readonly block: Node;
  readonly statement: Node;
  readonly statementIndex: number;
  readonly sourceFile: SourceFile;
  readonly sourceName: string;
  readonly canAnchor: boolean;
}

interface DirectBlockOwner {
  readonly block: Node;
  readonly statement: Node;
  readonly statementIndex: number;
}

interface MutableSourcePlan {
  readonly byGuard: Map<Node, DominatingNilCheckBindingPlan>;
  readonly byBlock: Map<Node, DominatingNilCheckBindingPlan[]>;
  bindingCount: number;
  optimizedGuardCount: number;
  eliminatedGuardCount: number;
}

const retentionReasons = Object.freeze([
  "external-binding",
  "mutable-binding",
  "no-direct-block-owner",
  "no-unconditional-anchor",
  "before-dominating-anchor",
  "single-guard-suffix",
] satisfies readonly DominatingNilCheckRetentionReason[]);

const emptyBindings = Object.freeze([]) as readonly DominatingNilCheckBindingPlan[];

export function createDominatingNilCheckPlan(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  generatedNames: ProgramGeneratedNames,
  profile: "location" | "closed-direct",
  sourceIdentityFor: SourceIdentityResolver,
): DominatingNilCheckPlan {
  if (profile === "location") {
    return emptyPlan(profile);
  }
  const retention = createOptimizationRetentionLedger(
    source,
    sourceIdentityFor,
    retentionReasons,
  );
  const grouped = new Map<Node, Map<Node, GuardCandidate[]>>();
  let candidateGuardCount = 0;
  for (const node of program.nodes) {
    const guard = canonicalIdentifierNilGuard(source, node);
    if (guard === undefined) {
      continue;
    }
    candidateGuardCount += 1;
    const reference = source.navigation.sourceReferenceFor(guard.left);
    if (reference?.project !== true) {
      retention.record("external-binding", node);
      continue;
    }
    if (program.hasBindingWrite(reference.declaration)) {
      retention.record("mutable-binding", node);
      continue;
    }
    const owner = directBlockOwner(source, node);
    const sourceFile = source.ast.getSourceFile(node);
    if (owner === undefined || sourceFile === undefined) {
      retention.record("no-direct-block-owner", node);
      continue;
    }
    const byDeclaration = grouped.get(owner.block) ?? new Map();
    const selected = byDeclaration.get(reference.declaration) ?? [];
    selected.push(Object.freeze({
      guard: node,
      declaration: reference.declaration,
      block: owner.block,
      statement: owner.statement,
      statementIndex: owner.statementIndex,
      sourceFile,
      sourceName: source.ast.text(guard.left),
      canAnchor: isFirstEvaluatedExpression(source, node, owner.statement),
    }));
    byDeclaration.set(reference.declaration, selected);
    grouped.set(owner.block, byDeclaration);
  }

  const mutableByFile = new Map<SourceFile, MutableSourcePlan>();
  for (const byDeclaration of grouped.values()) {
    for (const candidates of byDeclaration.values()) {
      selectGroup(candidates, mutableByFile, generatedNames, retention);
    }
  }
  const byFile = sealSourcePlans(program.sourceFiles, mutableByFile);
  const optimizedBindingCount = [...byFile.values()].reduce(
    (total, selected) => total + selected.bindingCount,
    0,
  );
  const optimizedGuardCount = [...byFile.values()].reduce(
    (total, selected) => total + selected.optimizedGuardCount,
    0,
  );
  const eliminatedGuardCount = [...byFile.values()].reduce(
    (total, selected) => total + selected.eliminatedGuardCount,
    0,
  );
  const fallbackReasons = retention.seal();
  if (
    candidateGuardCount !== optimizedGuardCount + retention.count ||
    eliminatedGuardCount !== optimizedGuardCount - optimizedBindingCount
  ) {
    throw new Error("dominating nil-check planning lost a decision row");
  }
  return Object.freeze({
    profile,
    analyzed: true,
    candidateGuardCount,
    optimizedBindingCount,
    optimizedGuardCount,
    eliminatedGuardCount,
    retainedGuardCount: retention.count,
    fallbackReasons,
    forFile(sourceFile: SourceFile): DominatingNilCheckSourcePlan {
      return byFile.get(sourceFile) ?? emptySourcePlan();
    },
  });
}

function canonicalIdentifierNilGuard(
  source: TargetSourceProgram,
  node: Node,
): { readonly left: Node } | undefined {
  if (
    !source.ast.is.IsBinaryExpression(node) ||
    source.ast.operatorKindName(node) !== "KindQuestionQuestionToken"
  ) {
    return undefined;
  }
  const binary = source.ast.as.AsBinaryExpression(node);
  const left = binary?.Left;
  const fallback = binary?.Right;
  const fallbackType = fallback === undefined
    ? undefined
    : source.semantics.forNode(fallback).types.expressionType(fallback);
  return left !== undefined &&
      source.ast.is.IsIdentifier(left) &&
      fallback !== undefined &&
      fallbackType !== undefined &&
      source.semantics.forNode(fallback).types.isNever(fallbackType)
    ? Object.freeze({ left })
    : undefined;
}

function directBlockOwner(
  source: TargetSourceProgram,
  node: Node,
): DirectBlockOwner | undefined {
  let current = node;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined || isFunctionLike(source, parent)) {
      return undefined;
    }
    if (source.ast.is.IsBlock(parent)) {
      const statements = source.ast.statements(parent);
      const statementIndex = statements.findIndex((statement) => statement === current);
      return statementIndex < 0
        ? undefined
        : Object.freeze({ block: parent, statement: current, statementIndex });
    }
    current = parent;
  }
}

function isFirstEvaluatedExpression(
  source: TargetSourceProgram,
  guard: Node,
  statement: Node,
): boolean {
  let current = guard;
  while (current !== statement) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return false;
    }
    if (source.ast.is.IsParenthesizedExpression(parent)) {
      if (source.ast.as.AsParenthesizedExpression(parent)?.Expression !== current) {
        return false;
      }
    } else if (source.ast.is.IsPropertyAccessExpression(parent)) {
      if (source.ast.as.AsPropertyAccessExpression(parent)?.Expression !== current) {
        return false;
      }
    } else if (source.ast.is.IsElementAccessExpression(parent)) {
      if (source.ast.as.AsElementAccessExpression(parent)?.Expression !== current) {
        return false;
      }
    } else if (source.ast.is.IsBinaryExpression(parent)) {
      if (source.ast.as.AsBinaryExpression(parent)?.Left !== current) {
        return false;
      }
    } else if (source.ast.is.IsPrefixUnaryExpression(parent)) {
      if (source.ast.as.AsPrefixUnaryExpression(parent)?.Operand !== current) {
        return false;
      }
    } else if (source.ast.is.IsPostfixUnaryExpression(parent)) {
      if (source.ast.as.AsPostfixUnaryExpression(parent)?.Operand !== current) {
        return false;
      }
    } else if (source.ast.is.IsNonNullExpression(parent)) {
      if (source.ast.as.AsNonNullExpression(parent)?.Expression !== current) {
        return false;
      }
    } else if (source.ast.is.IsAsExpression(parent)) {
      if (source.ast.as.AsAsExpression(parent)?.Expression !== current) {
        return false;
      }
    } else if (source.ast.is.IsTypeAssertion(parent)) {
      if (source.ast.as.AsTypeAssertion(parent)?.Expression !== current) {
        return false;
      }
    } else if (source.ast.is.IsSatisfiesExpression(parent)) {
      if (source.ast.as.AsSatisfiesExpression(parent)?.Expression !== current) {
        return false;
      }
    } else if (source.ast.is.IsCallExpression(parent)) {
      if (source.ast.as.AsCallExpression(parent)?.Expression !== current) {
        return false;
      }
    } else if (source.ast.is.IsExpressionStatement(parent)) {
      return parent === statement &&
        source.ast.as.AsExpressionStatement(parent)?.Expression === current;
    } else {
      return false;
    }
    current = parent;
  }
  return false;
}

function selectGroup(
  candidates: readonly GuardCandidate[],
  mutableByFile: Map<SourceFile, MutableSourcePlan>,
  generatedNames: ProgramGeneratedNames,
  retention: ReturnType<typeof createOptimizationRetentionLedger<
    DominatingNilCheckRetentionReason
  >>,
): void {
  const ordered = [...candidates].sort((left, right) =>
    left.statementIndex - right.statementIndex
  );
  const anchor = ordered.find((candidate) => candidate.canAnchor);
  if (anchor === undefined) {
    recordAll(retention, "no-unconditional-anchor", ordered);
    return;
  }
  const before = ordered.filter((candidate) =>
    candidate.statementIndex < anchor.statementIndex
  );
  recordAll(retention, "before-dominating-anchor", before);
  const suffix = ordered.filter((candidate) =>
    candidate.statementIndex >= anchor.statementIndex
  );
  if (suffix.length < 2) {
    recordAll(retention, "single-guard-suffix", suffix);
    return;
  }
  const checkedName = generatedNames.forFile(anchor.sourceFile).reserve(
    preferredCheckedName(anchor.sourceName),
  );
  const binding: DominatingNilCheckBindingPlan = Object.freeze({
    block: anchor.block,
    anchorStatement: anchor.statement,
    anchorStatementIndex: anchor.statementIndex,
    anchorGuard: anchor.guard,
    checkedName,
    guards: new Set(suffix.map((candidate) => candidate.guard)),
  });
  const sourcePlan = mutableByFile.get(anchor.sourceFile) ?? mutableSourcePlan();
  for (const candidate of suffix) {
    if (sourcePlan.byGuard.has(candidate.guard)) {
      throw new Error("dominating nil check selected one guard twice");
    }
    sourcePlan.byGuard.set(candidate.guard, binding);
  }
  const blockBindings = sourcePlan.byBlock.get(anchor.block) ?? [];
  blockBindings.push(binding);
  sourcePlan.byBlock.set(anchor.block, blockBindings);
  sourcePlan.bindingCount += 1;
  sourcePlan.optimizedGuardCount += suffix.length;
  sourcePlan.eliminatedGuardCount += suffix.length - 1;
  mutableByFile.set(anchor.sourceFile, sourcePlan);
}

function recordAll(
  retention: ReturnType<typeof createOptimizationRetentionLedger<
    DominatingNilCheckRetentionReason
  >>,
  reason: DominatingNilCheckRetentionReason,
  candidates: readonly GuardCandidate[],
): void {
  for (const candidate of candidates) {
    retention.record(reason, candidate.guard);
  }
}

function preferredCheckedName(sourceName: string): string {
  const [first = "", ...rest] = sourceName;
  return `checked${first.toLocaleUpperCase("en-US")}${rest.join("")}`;
}

function sealSourcePlans(
  sourceFiles: readonly SourceFile[],
  mutableByFile: ReadonlyMap<SourceFile, MutableSourcePlan>,
): ReadonlyMap<SourceFile, DominatingNilCheckSourcePlan> {
  const byFile = new Map<SourceFile, DominatingNilCheckSourcePlan>();
  for (const sourceFile of sourceFiles) {
    const selected = mutableByFile.get(sourceFile);
    if (selected === undefined) {
      continue;
    }
    for (const bindings of selected.byBlock.values()) {
      bindings.sort((left, right) =>
        left.anchorStatementIndex - right.anchorStatementIndex ||
        (left.checkedName.text < right.checkedName.text
          ? -1
          : left.checkedName.text > right.checkedName.text
          ? 1
          : 0)
      );
    }
    byFile.set(sourceFile, Object.freeze({
      bindingCount: selected.bindingCount,
      blockCount: selected.byBlock.size,
      optimizedGuardCount: selected.optimizedGuardCount,
      eliminatedGuardCount: selected.eliminatedGuardCount,
      bindingForGuard(guard: Node): DominatingNilCheckBindingPlan | undefined {
        return selected.byGuard.get(guard);
      },
      bindingsForBlock(block: Node): readonly DominatingNilCheckBindingPlan[] {
        return selected.byBlock.get(block) ?? emptyBindings;
      },
    }));
  }
  return byFile;
}

function mutableSourcePlan(): MutableSourcePlan {
  return {
    byGuard: new Map(),
    byBlock: new Map(),
    bindingCount: 0,
    optimizedGuardCount: 0,
    eliminatedGuardCount: 0,
  };
}

function emptyPlan(profile: "location"): DominatingNilCheckPlan {
  const sourcePlan = emptySourcePlan();
  return Object.freeze({
    profile,
    analyzed: false,
    candidateGuardCount: 0,
    optimizedBindingCount: 0,
    optimizedGuardCount: 0,
    eliminatedGuardCount: 0,
    retainedGuardCount: 0,
    fallbackReasons: Object.freeze([]),
    forFile(): DominatingNilCheckSourcePlan {
      return sourcePlan;
    },
  });
}

function emptySourcePlan(): DominatingNilCheckSourcePlan {
  return Object.freeze({
    bindingCount: 0,
    blockCount: 0,
    optimizedGuardCount: 0,
    eliminatedGuardCount: 0,
    bindingForGuard(): undefined {
      return undefined;
    },
    bindingsForBlock(): readonly DominatingNilCheckBindingPlan[] {
      return emptyBindings;
    },
  });
}

function isFunctionLike(source: TargetSourceProgram, node: Node): boolean {
  return source.ast.is.IsFunctionDeclaration(node) ||
    source.ast.is.IsFunctionExpression(node) ||
    source.ast.is.IsArrowFunction(node) ||
    source.ast.is.IsMethodDeclaration(node) ||
    source.ast.is.IsConstructorDeclaration(node) ||
    source.ast.is.IsGetAccessorDeclaration(node) ||
    source.ast.is.IsSetAccessorDeclaration(node);
}
