import type {
  CompilerExtension,
  Node,
  SourceAnalysisContext,
  SourceFile,
} from "@tsonic/tsts";

import type {
  ProviderInvocationContract,
  ProviderInvocationManifest,
} from "../../../../config/provider-invocation-manifest.js";
import { indexProviderInvocationDeclarations } from "./declaration-selection.js";
import {
  providerInvocationExtensionId,
  providerInvocationFactKey,
} from "./fact.js";

export function createProviderInvocationExtension(
  manifests: readonly ProviderInvocationManifest[],
): CompilerExtension {
  const contracts = Object.freeze(manifests.flatMap((manifest) =>
    manifest.contracts
  ));
  return Object.freeze({
    identity: Object.freeze({
      id: providerInvocationExtensionId,
      version: "2.0.0",
    }),
    analyzeSource(context: SourceAnalysisContext): void {
      const declarations = indexProviderInvocationDeclarations(
        context,
        contracts,
      );
      for (const sourceFile of context.source.getSourceFiles()) {
        if (sourceFile !== undefined) {
          attachProviderInvocationFacts(context, sourceFile, declarations);
        }
      }
    },
  });
}

function attachProviderInvocationFacts(
  context: SourceAnalysisContext,
  sourceFile: SourceFile,
  declarations: ReadonlyMap<Node, ProviderInvocationContract>,
): void {
  const checker = context.source.getSourceFileQueries(sourceFile).checker;
  visit(context, sourceFile, (node) => {
    if (!context.source.ast.is.IsCallExpression(node)) {
      return;
    }
    const call = checker.getResolvedCallInfo(node);
    if (call === undefined) {
      return;
    }
    const selected = [
      checker.getSignatureDeclaration(call.selectedSignature),
      call.sourceCalleeAccess?.selectedDeclaration,
      call.sourceCallee.selectedDeclaration,
    ].flatMap((declaration) => {
      if (declaration === undefined) {
        return [];
      }
      const contract = declarations.get(declaration);
      return contract === undefined ? [] : [contract];
    });
    const unique = [...new Set(selected)];
    if (unique.length === 0) {
      return;
    }
    if (unique.length !== 1) {
      throw new Error("Provider invocation selected conflicting contracts");
    }
    const contract = unique[0];
    if (contract === undefined) {
      return;
    }
    validateSelectedParameters(
      call.sourceSelectedSignatureParameters.length,
      contract,
    );
    const write = context.facts.set(
      node,
      providerInvocationFactKey,
      contract,
      Object.freeze([Object.freeze({
        message: "Exact provider invocation declaration selected",
        details: Object.freeze({
          manifestContract: contract.identity,
          declarationFileName: contract.target.declarationFileName,
          targetFingerprint: contract.target.targetFingerprint,
          ...(contract.conditional === undefined
            ? {}
            : {
                replacementFingerprint:
                  contract.conditional.replacement.targetFingerprint,
              }),
        }),
      })]),
    );
    if (write !== "inserted" && write !== "idempotent") {
      throw new Error(
        `Provider invocation fact '${contract.semanticKey}' was not attached: ${write}`,
      );
    }
  });
}

function validateSelectedParameters(
  parameterCount: number,
  contract: ProviderInvocationContract,
): void {
  const indexes = [
    ...contract.inputParameters,
    ...contract.resultOriginParameters,
    ...(contract.state?.writeParameters ?? []),
    ...(contract.state?.carrierParameter === undefined
      ? []
      : [contract.state.carrierParameter]),
    ...(contract.conditional?.callableParameters ?? []),
  ];
  const invalid = indexes.find((index) => index >= parameterCount);
  if (invalid !== undefined) {
    throw new Error(
      `Provider invocation contract '${contract.semanticKey}' parameter ${invalid} exceeds selected arity ${parameterCount}`,
    );
  }
}

function visit(
  context: SourceAnalysisContext,
  root: Node,
  callback: (node: Node) => void,
): void {
  const pending = [root];
  while (pending.length !== 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    callback(node);
    const children = context.source.ast.children(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
}
