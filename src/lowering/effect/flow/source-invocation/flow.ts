import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  KindCallExpression,
  KindNewExpression,
} from "@tsonic/tsts/target-ast";

import type {
  InvocationTransport,
  InvocationTransportContract,
} from "../../../invocation-transport.js";
import type { TargetProgramIndex } from "../../../program-index.js";
import type { ExactCallImplementations } from "../callable/result-inputs.js";
import type {
  SourceInvocationContract,
} from "../../../../config/source-invocation-manifest.js";
import { resolveExactSourceInvocation } from "../../model/exact-source-invocation.js";
import {
  sourceBodyCertificationFactKey,
  sourceInvocationFactKey,
} from "./fact.js";
import { callHasExactBindings } from "../invocation/call-binding.js";

export interface SourceInvocationFlow {
  readonly transport?: InvocationTransportContract;
  readonly implementationsFor: ExactCallImplementations;
  invocationHasCertifiedImplementation(call: Node): boolean;
  bodyInspectionIsCertified(declaration: Node): boolean;
}

export function createSourceInvocationFlow(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): SourceInvocationFlow {
  const transports = new Map<Node, InvocationTransport>();
  const implementations = new Map<Node, readonly Node[]>();
  const bodyInspectionIsCertified = (declaration: Node): boolean => {
    const direct = source.sourceFacts.getFact(
      declaration,
      sourceBodyCertificationFactKey,
    );
    if (direct !== undefined) {
      return true;
    }
    const sourceFile = source.ast.getSourceFile(declaration);
    return sourceFile !== undefined && source.sourceFacts.getFact(
      sourceFile,
      sourceBodyCertificationFactKey,
    ) !== undefined;
  };
  for (const call of program.nodesOfKinds([
    KindCallExpression,
    KindNewExpression,
  ])) {
    const fact = source.sourceFacts.getFact(call, sourceInvocationFactKey);
    const semantics = source.semantics.forNode(call);
    const selected = semantics.operations.call(call);
    const declaration = selected === undefined
      ? undefined
      : semantics.declarations.signatureDeclaration(selected.selectedSignature);
    if (
      selected === undefined ||
      selected.call !== call ||
      !callHasExactBindings(source, call, selected, declaration)
    ) {
      if (fact === undefined) {
        continue;
      }
      throw new Error(
        `Source invocation '${fact.semanticKey}' has no exact checked call bindings`,
      );
    }
    if (fact !== undefined) {
      const implementation = resolveExactSourceInvocation(
        source,
        call,
        bodyInspectionIsCertified,
      )?.implementation;
      if (implementation !== undefined) {
        const implementationFile = source.ast.getSourceFile(implementation);
        if (
          implementationFile === undefined ||
          source.ast.getFileName(implementationFile) !== fact.file.sourceFileName
        ) {
          throw new Error(
            `Source invocation '${fact.semanticKey}' selected an implementation from another source file`,
          );
        }
        implementations.set(call, Object.freeze([implementation]));
      } else if (fact.exactImplementation) {
        throw new Error(
          `Source invocation '${fact.semanticKey}' has no certified implementation`,
        );
      }
    }
    if (fact === undefined) {
      continue;
    }
    const expressionsByParameter = new Map<number, Node[]>();
    for (const binding of selected.sourceArgumentBindings) {
      const argument = selected.sourceArguments[binding.sourceArgumentIndex]
        ?.expression;
      if (argument === undefined) {
        throw new Error(
          `Source invocation '${fact.semanticKey}' lost source argument ${binding.sourceArgumentIndex}`,
        );
      }
      const expressions = expressionsByParameter.get(
        binding.sourceParameterIndex,
      );
      if (expressions === undefined) {
        expressionsByParameter.set(binding.sourceParameterIndex, [argument]);
      } else if (!expressions.includes(argument)) {
        expressions.push(argument);
      }
    }
    const inputExpressions = inputExpressionsFor(
      fact.inputParameters,
      expressionsByParameter,
      fact,
    );
    const resultOrigins = resultOriginExpressionsFor(
      fact.resultOriginParameters,
      expressionsByParameter,
      fact,
    );
    if (inputExpressions.length === 0 && resultOrigins === undefined) {
      continue;
    }
    transports.set(call, Object.freeze({
      inputExpressions,
      ...(resultOrigins === undefined
        ? {}
        : { resultOriginExpressions: resultOrigins }),
    }));
  }
  const transport = transports.size === 0
    ? undefined
    : Object.freeze({
        transportFor(call: Node): InvocationTransport | undefined {
          return transports.get(call);
        },
      });
  return Object.freeze({
    ...(transport === undefined ? {} : { transport }),
    implementationsFor(call: Node): readonly Node[] | undefined {
      return implementations.get(call);
    },
    invocationHasCertifiedImplementation(call: Node): boolean {
      return implementations.has(call);
    },
    bodyInspectionIsCertified,
  });
}

function inputExpressionsFor(
  parameters: readonly number[],
  expressionsByParameter: ReadonlyMap<number, readonly Node[]>,
  contract: SourceInvocationContract,
): readonly Node[] {
  if (parameters.length === 0) {
    return Object.freeze([]);
  }
  const expressions: Node[] = [];
  for (const parameter of parameters) {
    const selected = expressionsByParameter.get(parameter);
    if (selected === undefined || selected.length === 0) {
      throw new Error(
        `Source invocation '${contract.semanticKey}' has no argument for input parameter ${parameter}`,
      );
    }
    expressions.push(...selected);
  }
  return Object.freeze([...new Set(expressions)]);
}

function resultOriginExpressionsFor(
  parameters: readonly number[],
  expressionsByParameter: ReadonlyMap<number, readonly Node[]>,
  contract: SourceInvocationContract,
): readonly Node[] | undefined {
  if (parameters.length === 0) {
    return undefined;
  }
  const expressions: Node[] = [];
  for (const parameter of parameters) {
    const selected = expressionsByParameter.get(parameter);
    if (selected === undefined || selected.length === 0) {
      throw new Error(
        `Source invocation '${contract.semanticKey}' has no argument for result-origin parameter ${parameter}`,
      );
    }
    expressions.push(...selected);
  }
  return Object.freeze([...new Set(expressions)]);
}
