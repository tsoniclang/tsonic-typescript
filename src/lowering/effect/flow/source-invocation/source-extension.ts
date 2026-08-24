import type {
  CompilerExtension,
  Node,
  SourceAnalysisContext,
  SourceFile,
} from "@tsonic/tsts";

import type {
  SourceInvocationContract,
  SourceInvocationManifest,
} from "../../../../config/source-invocation-manifest.js";
import { indexSourceInvocationDeclarations } from "./declaration-selection.js";
import {
  sourceBodyCertificationFactKey,
  sourceInvocationExtensionId,
  sourceInvocationFactKey,
} from "./fact.js";

export function createSourceInvocationExtension(
  manifests: readonly SourceInvocationManifest[],
): CompilerExtension {
  const contracts = Object.freeze(manifests.flatMap((manifest) =>
    manifest.contracts
  ));
  const files = Object.freeze(manifests.flatMap((manifest) => manifest.files));
  return Object.freeze({
    identity: Object.freeze({
      id: sourceInvocationExtensionId,
      version: "3.0.0",
    }),
    analyzeSource(context: SourceAnalysisContext): void {
      const declarations = indexSourceInvocationDeclarations(
        context,
        files,
        contracts,
      );
      for (const [declaration, certification] of declarations.certifiedBodies) {
        const write = context.facts.set(
          declaration,
          sourceBodyCertificationFactKey,
          certification,
          Object.freeze([Object.freeze({
            message: "Exact authored-source body certified",
            details: Object.freeze({
              sourceFileName: certification.sourceFileName,
              sourceDigest: certification.sourceDigest,
            }),
          })]),
        );
        if (write !== "inserted" && write !== "idempotent") {
          throw new Error(
            `Source body certification '${certification.identity}' was not attached: ${write}`,
          );
        }
      }
      for (const sourceFile of context.source.getSourceFiles()) {
        if (sourceFile !== undefined) {
          attachSourceInvocationFacts(
            context,
            sourceFile,
            declarations.contracts,
          );
        }
      }
    },
  });
}

function attachSourceInvocationFacts(
  context: SourceAnalysisContext,
  sourceFile: SourceFile,
  declarations: ReadonlyMap<Node, SourceInvocationContract>,
): void {
  const checker = context.source.getSourceFileQueries(sourceFile).checker;
  visit(context, sourceFile, (node) => {
    if (
      !context.source.ast.is.IsCallExpression(node) &&
      !context.source.ast.is.IsNewExpression(node)
    ) {
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
      throw new Error("Source invocation selected conflicting contracts");
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
      sourceInvocationFactKey,
      contract,
      Object.freeze([Object.freeze({
        message: "Exact authored-source invocation declaration selected",
        details: Object.freeze({
          manifestContract: contract.identity,
          sourceFileName: contract.file.sourceFileName,
          sourceDigest: contract.file.sourceDigest,
        }),
      })]),
    );
    if (write !== "inserted" && write !== "idempotent") {
      throw new Error(
        `Source invocation fact '${contract.semanticKey}' was not attached: ${write}`,
      );
    }
  });
}

function validateSelectedParameters(
  parameterCount: number,
  contract: SourceInvocationContract,
): void {
  const invalid = [
    ...contract.inputParameters,
    ...contract.resultOriginParameters,
  ].find((index) => index >= parameterCount);
  if (invalid !== undefined) {
    throw new Error(
      `Source invocation contract '${contract.semanticKey}' parameter ${invalid} exceeds selected arity ${parameterCount}`,
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
