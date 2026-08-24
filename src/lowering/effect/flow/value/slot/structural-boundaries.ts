import type { Node, Symbol, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  KindCallExpression,
  KindNewExpression,
  KindPropertySignature,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../../program-index.js";
import type { ExactCallImplementations } from "../../callable/result-inputs.js";
import { exactSourceCallBindings } from "../../invocation/call-binding.js";
import {
  storageInvocationHasExactImplementation,
  type StorageOwnerBoundaryDependencies,
} from "../../storage/owner-boundaries.js";
import {
  type ExactSourceBodyInspection,
  sourceBodyInspectionIsExact,
} from "../../../model/source-membership.js";
import { transparentExpression } from "../../../model/syntax.js";
import type { ExactOpaqueValueSlotTransport } from "./opaque-transport.js";

export function opaqueCallDoesNotObserveValueSlots(
  source: TargetSourceProgram,
  expression: Node,
  exactCallImplementations: ExactCallImplementations | undefined,
  opaqueTransport: ExactOpaqueValueSlotTransport | undefined,
  bodyInspectionIsCertified: ExactSourceBodyInspection | undefined,
): boolean {
  const argument = containingDirectCallArgument(source, expression);
  if (
    argument === undefined ||
    opaqueTransport === undefined ||
    storageInvocationHasExactImplementation(
      source,
      argument.call,
      exactCallImplementations,
      undefined,
      bodyInspectionIsCertified,
    )
  ) {
    return false;
  }
  const selected = exactSourceCallBindings(source, argument.call);
  const bindings = selected?.bindings.filter((binding) =>
    binding.argument === argument.argument
  );
  if (selected === undefined || bindings === undefined || bindings.length === 0) {
    return false;
  }
  const semantics = source.semantics.forNode(argument.call);
  return bindings.every((binding) => {
    const sourceArgument = selected.call.sourceArguments[
      binding.evidence.sourceArgumentIndex
    ];
    if (sourceArgument === undefined) {
      return false;
    }
    return opaqueTransport.allows(
      semantics,
      argument.argument,
      binding.evidence.sourceForm === "value"
        ? sourceArgument.type
        : binding.evidence.selectedArgumentType,
      binding.evidence.selectedParameterType,
    );
  });
}

function containingDirectCallArgument(
  source: TargetSourceProgram,
  expression: Node,
): { readonly call: Node; readonly argument: Node } | undefined {
  let current = expression;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return undefined;
    }
    if (
      source.ast.is.IsCallExpression(parent) ||
      source.ast.is.IsNewExpression(parent)
    ) {
      return source.ast.arguments(parent).includes(current)
        ? Object.freeze({ call: parent, argument: current })
        : undefined;
    }
    if (transparentExpression(source, parent) !== current) {
      return undefined;
    }
    current = parent;
  }
}

export function collectOpaqueStructuralCallEscapes(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  exactCallImplementations: ExactCallImplementations | undefined,
  boundaryDependencies: StorageOwnerBoundaryDependencies | undefined,
  bodyInspectionIsCertified: ExactSourceBodyInspection | undefined,
): Set<Node> {
  const escaped = new Set<Node>();
  const allPropertySignatures = Object.freeze([
    ...program.nodesOfKind(KindPropertySignature),
  ]);
  const expandedTypes = new Set<Type>();
  const expandedTypePairs = new Map<Type, Set<Type>>();
  for (const call of program.nodesOfKinds([
    KindCallExpression,
    KindNewExpression,
  ])) {
    if (storageInvocationHasExactImplementation(
      source,
      call,
      exactCallImplementations,
      boundaryDependencies,
      bodyInspectionIsCertified,
    )) {
      continue;
    }
    const semantics = source.semantics.forNode(call);
    const selectedCall = semantics.operations.call(call);
    const receiver = selectedCall?.sourceReceiver;
    if (receiver !== undefined) {
      if (!collectPropertySignatures(
        source,
        semantics,
        receiver.type,
        escaped,
        expandedTypes,
        bodyInspectionIsCertified,
      )) {
        addAll(escaped, allPropertySignatures);
      }
    }
    for (const [sourceArgumentIndex, argument] of (
      selectedCall?.sourceArguments ?? []
    ).entries()) {
      const targets = new Set(
        selectedCall?.sourceArgumentBindings.filter((binding) =>
          binding.sourceArgumentIndex === sourceArgumentIndex
        ).map((binding) => binding.selectedParameterType) ?? [],
      );
      if (targets.size === 0) {
        if (!collectPropertySignatures(
          source,
          semantics,
          argument.type,
          escaped,
          expandedTypes,
          bodyInspectionIsCertified,
        )) {
          addAll(escaped, allPropertySignatures);
        }
        continue;
      }
      for (const target of targets) {
        collectWritablePropertySignatures(
          source,
          semantics,
          argument.type,
          target,
          escaped,
          expandedTypePairs,
          expandedTypes,
          bodyInspectionIsCertified,
        );
      }
    }
  }
  return escaped;
}

function collectWritablePropertySignatures(
  source: TargetSourceProgram,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forNode"]>,
  sourceType: Type,
  targetType: Type,
  result: Set<Node>,
  seen: Map<Type, Set<Type>>,
  expandedTypes: Set<Type>,
  bodyInspectionIsCertified: ExactSourceBodyInspection | undefined,
): void {
  let targets = seen.get(sourceType);
  if (targets?.has(targetType) === true) {
    return;
  }
  if (targets === undefined) {
    targets = new Set();
    seen.set(sourceType, targets);
  }
  targets.add(targetType);
  if (semantics.types.isAny(targetType) || semantics.types.isUnknown(targetType)) {
    collectPropertySignatures(
      source,
      semantics,
      sourceType,
      result,
      expandedTypes,
      bodyInspectionIsCertified,
    );
    return;
  }
  const sourceProperties = new Map(
    semantics.types.propertyInfos(sourceType).map((property) => [
      property.name,
      property,
    ]),
  );
  for (const targetProperty of semantics.types.propertyInfos(targetType)) {
    const sourceProperty = sourceProperties.get(targetProperty.name);
    if (sourceProperty === undefined) {
      continue;
    }
    const projectSlot = !targetProperty.readonly &&
      addPropertySignatureDeclarations(
        source,
        semantics,
        sourceProperty.symbol,
        result,
        bodyInspectionIsCertified,
      );
    if (projectSlot) {
      continue;
    }
    collectWritablePropertySignatures(
      source,
      semantics,
      sourceProperty.type,
      targetProperty.type,
      result,
      seen,
      expandedTypes,
      bodyInspectionIsCertified,
    );
  }
}

function addPropertySignatureDeclarations(
  source: TargetSourceProgram,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forNode"]>,
  symbol: Symbol,
  result: Set<Node>,
  bodyInspectionIsCertified: ExactSourceBodyInspection | undefined,
): boolean {
  let added = false;
  for (const declaration of semantics.declarations.symbolDeclarations(symbol)) {
    if (
      declaration !== undefined &&
      sourceBodyInspectionIsExact(
        source,
        declaration,
        bodyInspectionIsCertified,
      ) &&
      source.ast.is.IsPropertySignatureDeclaration(declaration)
    ) {
      result.add(declaration);
      added = true;
    }
  }
  return added;
}

function collectPropertySignatures(
  source: TargetSourceProgram,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forNode"]>,
  type: Type,
  result: Set<Node>,
  expanded: Set<Type>,
  bodyInspectionIsCertified: ExactSourceBodyInspection | undefined,
): boolean {
  if (expanded.has(type)) {
    return true;
  }
  expanded.add(type);
  for (const property of semantics.types.propertyInfos(type)) {
    let projectSlot = false;
    for (const declaration of semantics.declarations.symbolDeclarations(
      property.symbol,
    )) {
      if (
        declaration !== undefined &&
        sourceBodyInspectionIsExact(
          source,
          declaration,
          bodyInspectionIsCertified,
        ) &&
        source.ast.is.IsPropertySignatureDeclaration(declaration)
      ) {
        result.add(declaration);
        projectSlot = true;
      }
    }
    if (!projectSlot && !collectPropertySignatures(
      source,
      semantics,
      property.type,
      result,
      expanded,
      bodyInspectionIsCertified,
    )) {
      return false;
    }
  }
  const arguments_ = semantics.types.isTypeReference(type)
    ? semantics.types.effectiveTypeArguments(type)
    : Object.freeze([]);
  if (arguments_ === undefined) {
    return false;
  }
  for (const member of [
    ...(semantics.types.isUnion(type) || semantics.types.isIntersection(type)
      ? semantics.types.unionOrIntersectionTypes(type)
      : []),
    ...arguments_,
    ...semantics.types.indexInfos(type).map((index) => index.valueType),
  ]) {
    if (member !== undefined && !collectPropertySignatures(
      source,
      semantics,
      member,
      result,
      expanded,
      bodyInspectionIsCertified,
    )) {
      return false;
    }
  }
  return true;
}

function addAll(target: Set<Node>, values: readonly Node[]): void {
  for (const value of values) {
    target.add(value);
  }
}
