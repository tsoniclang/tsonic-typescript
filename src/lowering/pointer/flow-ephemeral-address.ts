import type {
  Node,
  PointerOperationFact,
  Symbol,
} from "@tsonic/tsts";

import type { PointerCensus } from "./flow-census.js";
import {
  isOptimizableFunctionDeclaration,
  transparentExpression,
  transparentExpressionRoot,
} from "./flow-syntax.js";

type AddressOperation = Extract<
  PointerOperationFact,
  { readonly operation: "address-of" }
>;

type StableReferenceAudit = (
  referenceNode: Node,
  declaration: Node,
) => boolean;

export interface EphemeralAddressAudit {
  accepts(operation: AddressOperation): boolean;
}

export function createEphemeralAddressAudit(
  census: PointerCensus,
  preblockedNodes: ReadonlySet<Node>,
): EphemeralAddressAudit {
  const executionAudits = new Map<Symbol, ClosedExecutionAudit>();
  const stableSymbols = new Map<Symbol, boolean>();
  const stableReference = (referenceNode: Node, declaration: Node): boolean => {
    const { source } = census;
    const reference = source.navigation.sourceReferenceFor(referenceNode);
    if (reference?.project !== true || reference.declaration !== declaration) {
      return false;
    }
    const settled = stableSymbols.get(reference.symbol);
    if (settled !== undefined) {
      return settled;
    }
    const stable = source.navigation.sourceFiles.every((sourceFile) =>
      source.navigation.bindingWritesWithin(reference.symbol, sourceFile).length ===
        0
    );
    stableSymbols.set(reference.symbol, stable);
    return stable;
  };
  return Object.freeze({
    accepts(operation: AddressOperation): boolean {
      const { source } = census;
      const property = source.ast.is.IsPropertyAccessExpression(
          operation.storageExpression,
        )
        ? source.ast.as.AsPropertyAccessExpression(operation.storageExpression)
        : undefined;
      const declaration = operation.storageDeclaration;
      const symbol = operation.storageSymbol;
      if (
        property?.name === undefined ||
        declaration === undefined ||
        symbol === undefined ||
        !isProjectStorageDeclaration(census, declaration, property.name) ||
        preblockedNodes.has(operation.call)
      ) {
        return false;
      }
      const argumentRoot = transparentExpressionRoot(source, operation.call);
      const parent = source.ast.parent(argumentRoot);
      if (parent === undefined || !source.ast.is.IsCallExpression(parent)) {
        return false;
      }
      const arguments_ = source.ast.arguments(parent);
      const argumentIndex = arguments_.findIndex((argument) =>
        transparentExpression(source, argument) === operation.call
      );
      if (argumentIndex < 0) {
        return false;
      }
      const callable = exactSynchronousCallTarget(
        census,
        parent,
        argumentIndex,
        stableReference,
      );
      if (callable === undefined || pointerResultEscapes(census, operation)) {
        return false;
      }
      const execution = executionAudits.get(symbol) ?? new ClosedExecutionAudit(
        census,
        symbol,
        stableReference,
      );
      executionAudits.set(symbol, execution);
      if (!execution.acceptsCallable(callable)) {
        return false;
      }
      for (let index = argumentIndex + 1; index < arguments_.length; index += 1) {
        const argument = arguments_[index];
        if (argument === undefined || !execution.acceptsExpression(argument)) {
          return false;
        }
      }
      return true;
    },
  });
}

function pointerResultEscapes(
  census: PointerCensus,
  operation: AddressOperation,
): boolean {
  const producer = census.graph.get(operation.call);
  return [...census.functionResults.values()].some((result) =>
    census.graph.connected(producer, result.vertex)
  );
}

function isProjectStorageDeclaration(
  census: PointerCensus,
  declaration: Node,
  propertyName: Node,
): boolean {
  const { source } = census;
  const field = source.ast.is.IsPropertyDeclaration(declaration);
  const parameterProperty = source.ast.is.IsParameterDeclaration(declaration) &&
    source.ast.is.IsConstructorDeclaration(source.ast.parent(declaration));
  if (!field && !parameterProperty) {
    return false;
  }
  const sourceFile = source.ast.getSourceFile(declaration);
  const reference = source.navigation.sourceReferenceFor(propertyName);
  return sourceFile !== undefined &&
    !source.ast.isDeclarationFile(sourceFile) &&
    reference?.project === true &&
    reference.declaration === declaration;
}

function exactSynchronousCallTarget(
  census: PointerCensus,
  call: Node,
  argumentIndex: number,
  stableReference: StableReferenceAudit,
): Node | undefined {
  const { source } = census;
  const info = source.semantics.forNode(call).getResolvedCallInfo(call);
  if (
    info === undefined ||
    info.sourceSelectedSignatureKind !== "resolved" ||
    info.optionalChain
  ) {
    return undefined;
  }
  const matchingBindings = info.sourceArgumentBindings.filter((binding) =>
    binding.sourceArgumentIndex === argumentIndex &&
    binding.sourceParameterForm === "parameter"
  );
  if (matchingBindings.length !== 1) {
    return undefined;
  }
  const binding = matchingBindings[0];
  const parameter = binding === undefined
    ? undefined
    : info.sourceSelectedSignatureParameters[binding.sourceParameterIndex];
  const declaration = source.semantics.forNode(call)
    .getSignatureDeclaration(info.selectedSignature);
  if (
    declaration === undefined ||
    parameter?.parameterDeclaration === undefined ||
    source.ast.parent(parameter.parameterDeclaration) !== declaration ||
    census.graph.get(parameter.parameterDeclaration) === undefined ||
    !isExactStableCallable(census, call, declaration, stableReference)
  ) {
    return undefined;
  }
  return declaration;
}

class ClosedExecutionAudit {
  readonly #census: PointerCensus;
  readonly #storageSymbol: Symbol;
  readonly #stableReference: StableReferenceAudit;
  readonly #settled = new Map<Node, boolean>();
  readonly #pending = new Set<Node>();

  constructor(
    census: PointerCensus,
    storageSymbol: Symbol,
    stableReference: StableReferenceAudit,
  ) {
    this.#census = census;
    this.#storageSymbol = storageSymbol;
    this.#stableReference = stableReference;
  }

  acceptsCallable(declaration: Node): boolean {
    const settled = this.#settled.get(declaration);
    if (settled !== undefined) {
      return settled;
    }
    if (this.#pending.has(declaration)) {
      return true;
    }
    const { source } = this.#census;
    if (
      source.ast.hasModifierKind(declaration, "async") ||
      source.navigation.bindingWritesWithin(
          this.#storageSymbol,
          declaration,
        ).length !== 0
    ) {
      this.#settled.set(declaration, false);
      return false;
    }
    this.#pending.add(declaration);
    const accepted = this.acceptsExpression(declaration);
    this.#pending.delete(declaration);
    this.#settled.set(declaration, accepted);
    return accepted;
  }

  acceptsExpression(root: Node): boolean {
    const { source } = this.#census;
    if (
      source.navigation.bindingWritesWithin(this.#storageSymbol, root).length !==
        0
    ) {
      return false;
    }
    const pending = [root];
    while (pending.length !== 0) {
      const node = pending.pop();
      if (node === undefined) {
        continue;
      }
      if (
        source.ast.is.IsAwaitExpression(node) ||
        source.ast.is.IsYieldExpression(node) ||
        source.ast.is.IsTaggedTemplateExpression(node)
      ) {
        return false;
      }
      if (source.ast.is.IsCallExpression(node)) {
        const operation = this.#census.operations.get(node);
        if (operation !== undefined) {
          if (
            operation.operation === "store" ||
            operation.operation === "bind-pointer" ||
            operation.operation === "project-pointer"
          ) {
            return false;
          }
        } else {
          const target = exactNestedCallTarget(
            this.#census,
            node,
            this.#stableReference,
          );
          if (target === undefined || !this.acceptsCallable(target)) {
            return false;
          }
        }
      } else if (source.ast.is.IsNewExpression(node)) {
        const target = exactConstructionTarget(
          this.#census,
          node,
          this.#stableReference,
        );
        if (target === undefined || !this.acceptsCallable(target)) {
          return false;
        }
      } else if (source.ast.is.IsPropertyAccessExpression(node)) {
        const name = source.ast.name(node);
        const declaration = source.navigation.sourceReferenceFor(name)?.declaration;
        if (
          declaration !== undefined &&
          (source.ast.is.IsGetAccessorDeclaration(declaration) ||
            source.ast.is.IsSetAccessorDeclaration(declaration))
        ) {
          return false;
        }
      }
      for (const child of source.ast.children(node)) {
        if (child !== undefined) {
          pending.push(child);
        }
      }
    }
    return true;
  }
}

function exactNestedCallTarget(
  census: PointerCensus,
  call: Node,
  stableReference: StableReferenceAudit,
): Node | undefined {
  const { source } = census;
  const info = source.semantics.forNode(call).getResolvedCallInfo(call);
  const declaration = info?.sourceSelectedSignatureKind === "resolved" &&
      !info.optionalChain
    ? source.semantics.forNode(call).getSignatureDeclaration(
        info.selectedSignature,
      )
    : undefined;
  return declaration !== undefined &&
      isExactStableCallable(census, call, declaration, stableReference)
    ? declaration
    : undefined;
}

function exactConstructionTarget(
  census: PointerCensus,
  construction: Node,
  stableReference: StableReferenceAudit,
): Node | undefined {
  const { source } = census;
  const semantics = source.semantics.forNode(construction);
  const declaration = semantics.getSignatureDeclaration(
    semantics.getResolvedSignature(construction),
  );
  if (
    declaration === undefined ||
    !source.ast.is.IsConstructorDeclaration(declaration) ||
    source.ast.body(declaration) === undefined
  ) {
    return undefined;
  }
  const classDeclaration = source.ast.parent(declaration);
  const className = source.ast.name(classDeclaration);
  return classDeclaration !== undefined &&
      source.ast.is.IsClassDeclaration(classDeclaration) &&
      className !== undefined &&
      stableReference(className, classDeclaration)
    ? declaration
    : undefined;
}

function isExactStableCallable(
  census: PointerCensus,
  call: Node,
  declaration: Node,
  stableReference: StableReferenceAudit,
): boolean {
  const { source } = census;
  if (
    !isOptimizableFunctionDeclaration(source, declaration) ||
    source.ast.hasModifierKind(declaration, "async")
  ) {
    return false;
  }
  const parsed = source.ast.as.AsCallExpression(call);
  const target = transparentExpression(source, parsed?.Expression);
  const targetName = source.ast.name(target) ?? target;
  return targetName !== undefined && stableReference(targetName, declaration);
}
