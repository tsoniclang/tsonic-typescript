import assert from "node:assert/strict";
import { test } from "node:test";

import {
  pointerFactKey,
  pointerOperationFactKey,
  sourceMarkerFactKey,
} from "@tsonic/tsts";
import type {
  Node,
  PointerOperationFact,
  SourceFile,
  Type,
} from "@tsonic/tsts";
import {
  AsQualifiedName,
  AsTypeReferenceNode,
  IsCallExpression,
  IsQualifiedName,
  IsTypeLiteralNode,
  IsTypeReferenceNode,
} from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api";

import {
  checkedPointerFixture,
  createFixturePointerFlowPlan,
  visit,
} from "./pointer.test-support.js";
import { lowerPointers } from "./transform.js";

test("keeps generated concretization capability callbacks canonical", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { loadPointer } from "./markers.js";
import { adaptCallback, assertCallback, callbackLength } from "./capabilities.js";
import { concretePointer } from "./family.js";
import { GenericKernel } from "./kernel.js";
import { Coder } from "./model.js";

export function lookupConcrete(
  callback: ((value: Pointer<Coder> | undefined) => void) | undefined,
): [((value: Pointer<Coder> | undefined) => void) | undefined, boolean] {
  return GenericKernel.lookup<Coder>(
    adaptCallback,
    assertCallback,
    callbackLength,
    callback,
  );
}

export const result = loadPointer(concretePointer).value;
`, {
    "/src/capabilities.ts": `import type { Pointer } from "./markers.js";
import { Coder } from "./model.js";

export function adaptCallback(
  callback: ((value: Pointer<Coder> | undefined) => void) | undefined,
): object | undefined {
  return callback;
}

export function assertCallback(
  value: object | undefined,
): ((value: Pointer<Coder> | undefined) => void) | undefined {
  void value;
  return undefined;
}

export function callbackLength(
  callbacks: readonly (((value: Pointer<Coder> | undefined) => void) | undefined)[],
): number {
  return callbacks.length;
}
`,
    "/src/family.ts": `import type { Pointer } from "./markers.js";
import { allocatePointer, storePointer } from "./markers.js";
import { Coder } from "./model.js";

export const concretePointer: Pointer<Coder> = allocatePointer(new Coder());
storePointer(concretePointer, new Coder());
`,
    "/src/kernel.ts": `import type { Pointer } from "./markers.js";

export class GenericKernel {
  static lookup<T>(
    adapt: (
      callback: ((value: Pointer<T> | undefined) => void) | undefined,
    ) => object | undefined,
    assert: (
      value: object | undefined,
    ) => ((value: Pointer<T> | undefined) => void) | undefined,
    length: (
      callbacks: readonly (((value: Pointer<T> | undefined) => void) | undefined)[],
    ) => number,
    callback: ((value: Pointer<T> | undefined) => void) | undefined,
  ): [((value: Pointer<T> | undefined) => void) | undefined, boolean] {
    void adapt;
    void assert;
    void length;
    return [callback, false];
  }
}
`,
    "/src/model.ts": `export class Coder { value = 1; }
`,
  });
  const { source } = fixture;
  const kernelCall = uniqueExplicitGenericCall(source);
  assert.equal(
    source.sourceFacts.getFact(kernelCall, pointerOperationFactKey),
    undefined,
  );
  const semantics = source.semantics.forNode(kernelCall);
  const call = semantics.getResolvedCallInfo(kernelCall);
  assert.ok(call !== undefined);
  assert.equal(call.call, kernelCall);
  assert.equal(call.outcome, "applicable");
  assert.equal(call.sourceSelectedSignatureKind, "resolved");
  const methodTypeArguments = call.sourceSelectedMethodTypeArguments;
  assert.equal(methodTypeArguments?.length, 1);
  const methodTypeArgument = methodTypeArguments?.[0];
  assert.ok(methodTypeArgument?.explicitTypeNode !== undefined);
  assert.equal(call.sourceSelectedSignatureParameters.length, 4);
  assert.equal(call.sourceArgumentBindings.length, 4);
  const concreteDeclaration = directReferenceDeclaration(
    source,
    kernelCall,
    methodTypeArgument.selectedType,
  );
  assert.ok(concreteDeclaration !== undefined);
  const concretePointers = collectConcretePointerTypes(
    source,
    concreteDeclaration,
  );
  assert.equal(concretePointers.length, 6);

  for (const parameter of call.sourceSelectedSignatureParameters) {
    assert.ok(parameter.authoredTypeNode !== undefined);
    assert.equal(
      authoredTypeContainsVaryingPointer(
        source,
        kernelCall,
        parameter.authoredTypeNode,
      ),
      true,
    );
  }
  for (const [index, binding] of call.sourceArgumentBindings.entries()) {
    assert.equal(binding.sourceArgumentIndex, index);
    assert.equal(binding.sourceParameterIndex, index);
    assert.equal(
      selectedPointerFamilyDeclarations(
        source,
        kernelCall,
        binding.selectedParameterType,
      ).has(concreteDeclaration),
      true,
    );
    assert.equal(
      selectedPointerFamilyDeclarations(
        source,
        kernelCall,
        binding.selectedArgumentType,
      ).has(concreteDeclaration),
      true,
    );
  }
  const signatureDeclaration = semantics.getSignatureDeclaration(
    call.selectedSignature,
  );
  const authoredReturnType = signatureDeclaration === undefined
    ? undefined
    : source.ast.typeNode(signatureDeclaration);
  assert.ok(authoredReturnType !== undefined);
  assert.equal(
    authoredTypeContainsVaryingPointer(
      source,
      kernelCall,
      authoredReturnType,
    ),
    true,
  );
  assert.equal(
    selectedPointerFamilyDeclarations(
      source,
      kernelCall,
      call.sourceResultType,
    ).has(concreteDeclaration),
    true,
  );

  const operations = collectOperationsForDeclaration(
    source,
    concreteDeclaration,
  );
  assert.equal(operations.length, 3);
  const plan = createFixturePointerFlowPlan(source);
  assert.deepEqual(
    plan.familyFallbackReasons
      .filter((entry) => entry.reason === "generic-call")
      .map((entry) => entry.count),
    [1],
  );
  for (const pointer of concretePointers) {
    assert.equal(plan.representationFor(pointer), "location");
  }
  for (const operation of operations) {
    assert.equal(plan.representationFor(operation.call), "location");
  }

  for (const [sourceFile, pointers] of groupPointersBySourceFile(
    source,
    concretePointers,
  )) {
    const lowered = lowerPointers(source, sourceFile, plan);
    assert.equal(lowered.pointerTypeCount, pointers.length);
    assert.equal(countTypeLiterals(source, lowered.sourceFile), 0);
    assert.equal(
      countQualifiedLocationTypes(source, lowered.sourceFile),
      pointers.length,
    );
  }

  const kernelSourceFile = source.ast.getSourceFile(signatureDeclaration);
  assert.ok(kernelSourceFile !== undefined);
  const loweredKernel = lowerPointers(source, kernelSourceFile, plan);
  assert.equal(loweredKernel.pointerTypeCount, 5);
  assert.equal(countTypeLiterals(source, loweredKernel.sourceFile), 0);
  assert.equal(countQualifiedLocationTypes(source, loweredKernel.sourceFile), 5);
});

test("keeps parameter, argument, and result families independently canonical", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";

class ParameterFamily { value = 1; }
class ArgumentFamily { value = 2; }
class ResultFamily { value = 3; }
interface ParameterView { value: ParameterFamily; }

declare function directional<Parameter, Result>(
  callback: (pointer: Pointer<Parameter>) => void,
): Pointer<Result>;

const capability = (
  value: ParameterView,
  extra?: Pointer<ArgumentFamily>,
): void => {
  void value;
  void extra;
};

const parameter: Pointer<ParameterFamily> = allocatePointer(new ParameterFamily());
const argument: Pointer<ArgumentFamily> = allocatePointer(new ArgumentFamily());
const result: Pointer<ResultFamily> = allocatePointer(new ResultFamily());
void directional<ParameterFamily, ResultFamily>(capability);
export const values = [
  loadPointer(parameter).value,
  loadPointer(argument).value,
  loadPointer(result).value,
];
`);
  const { source } = fixture;
  const genericCall = uniqueExplicitGenericCall(source);
  const semantics = source.semantics.forNode(genericCall);
  const call = semantics.getResolvedCallInfo(genericCall);
  assert.ok(call !== undefined);
  assert.equal(call.outcome, "applicable");
  assert.equal(call.sourceSelectedSignatureKind, "resolved");
  assert.equal(call.sourceSelectedMethodTypeArguments?.length, 2);
  assert.equal(call.sourceSelectedSignatureParameters.length, 1);
  assert.equal(call.sourceArgumentBindings.length, 1);
  const binding = call.sourceArgumentBindings[0];
  assert.ok(binding !== undefined);
  const parameterFamilies = selectedPointerFamilyDeclarations(
    source,
    genericCall,
    binding.selectedParameterType,
  );
  const argumentFamilies = selectedPointerFamilyDeclarations(
    source,
    genericCall,
    binding.selectedArgumentType,
  );
  const resultFamilies = selectedPointerFamilyDeclarations(
    source,
    genericCall,
    call.sourceResultType,
  );
  assert.equal(parameterFamilies.size, 1);
  assert.equal(argumentFamilies.size, 1);
  assert.equal(resultFamilies.size, 1);
  const parameterFamily = [...parameterFamilies][0]!;
  const argumentFamily = [...argumentFamilies][0]!;
  const resultFamily = [...resultFamilies][0]!;
  assert.equal(parameterFamily === argumentFamily, false);
  assert.equal(parameterFamily === resultFamily, false);
  assert.equal(argumentFamily === resultFamily, false);

  const authoredParameter = call.sourceSelectedSignatureParameters[0]
    ?.authoredTypeNode;
  assert.ok(authoredParameter !== undefined);
  assert.equal(
    authoredTypeContainsVaryingPointer(source, genericCall, authoredParameter),
    true,
  );
  const signatureDeclaration = semantics.getSignatureDeclaration(
    call.selectedSignature,
  );
  const authoredResult = signatureDeclaration === undefined
    ? undefined
    : source.ast.typeNode(signatureDeclaration);
  assert.ok(authoredResult !== undefined);
  assert.equal(
    authoredTypeContainsVaryingPointer(source, genericCall, authoredResult),
    true,
  );

  const plan = createFixturePointerFlowPlan(source);
  for (const declaration of [
    parameterFamily,
    argumentFamily,
    resultFamily,
  ]) {
    const pointers = collectConcretePointerTypes(source, declaration);
    const operations = collectOperationsForDeclaration(source, declaration);
    assert.ok(pointers.length > 0);
    assert.ok(operations.length > 0);
    for (const pointer of pointers) {
      assert.equal(plan.representationFor(pointer), "location");
    }
    for (const operation of operations) {
      assert.equal(plan.representationFor(operation.call), "location");
    }
  }
});

function uniqueExplicitGenericCall(source: TargetSourceProgram): Node {
  const calls: Node[] = [];
  for (const sourceFile of source.navigation.sourceFiles) {
    visit(source, sourceFile, (node) => {
      if (
        !IsCallExpression(node) ||
        source.sourceFacts.getFact(node, pointerOperationFactKey) !== undefined
      ) {
        return;
      }
      const call = source.semantics.forNode(node).getResolvedCallInfo(node);
      if (
        call?.sourceSelectedMethodTypeArguments?.some(
          (argument) => argument.explicitTypeNode !== undefined,
        )
      ) {
        calls.push(node);
      }
    });
  }
  assert.equal(calls.length, 1);
  return calls[0]!;
}

function authoredTypeContainsVaryingPointer(
  source: TargetSourceProgram,
  anchor: Node,
  authoredType: Node,
): boolean {
  const semantics = source.semantics.forNode(anchor);
  return semantics.getAuthoredTypeFactSubjects(authoredType).some((subject) => {
    const pointer = source.sourceFacts.getFact(subject, pointerFactKey);
    const pointee = pointer === undefined
      ? undefined
      : semantics.getTypeFromTypeNode(pointer.pointee);
    return pointee !== undefined && semantics.couldContainTypeVariables(pointee);
  });
}

function selectedPointerFamilyDeclarations(
  source: TargetSourceProgram,
  anchor: Node,
  type: Type,
): ReadonlySet<Node> {
  const declarations = new Set<Node>();
  const semantics = source.semantics.forNode(anchor);
  const seen = new Set<Type>();
  const pending: (Type | undefined)[] = [type];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || seen.has(current)) {
      continue;
    }
    seen.add(current);
    if (semantics.isUnion(current) || semantics.isIntersection(current)) {
      pending.push(...semantics.getUnionOrIntersectionTypes(current));
      continue;
    }
    const typeArguments = semantics.getEffectiveTypeArguments(current);
    const isPointer = semantics.getTypeFactSubjects(current).some((subject) => {
      const marker = source.sourceFacts.getFact(subject, sourceMarkerFactKey);
      return marker?.kind === "type-marker" && marker.marker === "pointer";
    });
    if (isPointer && typeArguments?.length === 1) {
      const declaration = directReferenceDeclaration(
        source,
        anchor,
        typeArguments[0],
      );
      if (declaration !== undefined) {
        declarations.add(declaration);
      }
    }
    if (typeArguments !== undefined) {
      pending.push(...typeArguments);
    }
    for (const signature of [
      ...semantics.getCallSignatures(current),
      ...semantics.getConstructSignatures(current),
    ]) {
      if (signature === undefined) {
        continue;
      }
      pending.push(semantics.getReturnTypeOfSignature(signature));
      for (const parameter of semantics.getSignatureParameters(signature)) {
        pending.push(semantics.getTypeOfSymbol(parameter));
      }
    }
  }
  return declarations;
}

function collectConcretePointerTypes(
  source: TargetSourceProgram,
  declaration: Node,
): readonly Node[] {
  const pointers: Node[] = [];
  for (const sourceFile of source.navigation.sourceFiles) {
    visit(source, sourceFile, (node) => {
      if (!IsTypeReferenceNode(node)) {
        return;
      }
      const pointer = source.sourceFacts.getFact(node, pointerFactKey);
      if (pointer === undefined) {
        return;
      }
      const semantics = source.semantics.forNode(node);
      const pointee = semantics.getTypeFromTypeNode(pointer.pointee);
      if (
        directReferenceDeclaration(source, node, pointee) === declaration
      ) {
        pointers.push(node);
      }
    });
  }
  return pointers;
}

function directReferenceDeclaration(
  source: TargetSourceProgram,
  anchor: Node,
  type: Type | undefined,
): Node | undefined {
  if (type === undefined) {
    return undefined;
  }
  const semantics = source.semantics.forNode(anchor);
  const declaration = semantics.getPrimarySymbolDeclaration(
    semantics.getTypeSymbol(type),
  );
  return declaration !== undefined &&
      source.navigation.isProjectDeclaration(declaration) &&
      source.ast.is.IsClassDeclaration(declaration)
    ? declaration
    : undefined;
}

function collectOperationsForDeclaration(
  source: TargetSourceProgram,
  declaration: Node,
): readonly PointerOperationFact[] {
  const operations: PointerOperationFact[] = [];
  for (const sourceFile of source.navigation.sourceFiles) {
    visit(source, sourceFile, (node) => {
      const operation = source.sourceFacts.getFact(
        node,
        pointerOperationFactKey,
      );
      if (
        operation !== undefined &&
        directReferenceDeclaration(
          source,
          operation.call,
          operation.pointeeType,
        ) === declaration
      ) {
        operations.push(operation);
      }
    });
  }
  return operations;
}

function groupPointersBySourceFile(
  source: TargetSourceProgram,
  pointers: readonly Node[],
): ReadonlyMap<SourceFile, readonly Node[]> {
  const grouped = new Map<SourceFile, Node[]>();
  for (const pointer of pointers) {
    const sourceFile = source.ast.getSourceFile(pointer);
    assert.ok(sourceFile !== undefined);
    const existing = grouped.get(sourceFile) ?? [];
    existing.push(pointer);
    grouped.set(sourceFile, existing);
  }
  return grouped;
}

function countTypeLiterals(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
): number {
  let count = 0;
  visit(source, sourceFile, (node) => {
    if (IsTypeLiteralNode(node)) {
      count += 1;
    }
  });
  return count;
}

function countQualifiedLocationTypes(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
): number {
  let count = 0;
  visit(source, sourceFile, (node) => {
    if (!IsTypeReferenceNode(node)) {
      return;
    }
    const typeName = AsTypeReferenceNode(node)?.TypeName;
    const qualified = typeName !== undefined && IsQualifiedName(typeName)
      ? AsQualifiedName(typeName)
      : undefined;
    if (
      qualified?.Right !== undefined &&
      source.ast.text(qualified.Right) === "Location"
    ) {
      count += 1;
    }
  });
  return count;
}
