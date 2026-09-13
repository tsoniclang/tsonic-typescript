import type { Node } from "@tsonic/tsts";
import {
  AsCallExpression, AsTypeReferenceNode, NewNumericLiteral, NewStringLiteral, NewBigIntLiteral, NewLiteralTypeNode,
  NewVoidExpression,
  NewKeywordTypeNode, KindUndefinedKeyword,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";
import type { GeneratedBindingName } from "../../generated-names.js";
import { runtimeCall, runtimeType, requiredRuntimeNode } from "../runtime-ast.js";
import { PointerLoweringError } from "../diagnostic.js";
import type { MemoryRewrite } from "./plan.js";
import type { ScalarMemoryLayout } from "./layout.js";
import { rewriteRecordField, rewriteRecordLayout } from "./record-ast.js";
import { rewriteRecordSchema } from "./record-schema-ast.js";
import { referenceMemoryCall } from "./references/ast.js";
import { rewriteBoundField, rewriteBoundRecord } from "./bindings/ast.js";

export function runtimeMemoryLayout(factory: NodeFactory, layout: ScalarMemoryLayout, runtimeAlias: GeneratedBindingName): Node {
  return runtimeCall(factory, runtimeAlias, layout.runtimeFactory, [], [
    requiredRuntimeNode(NewStringLiteral(factory, layout.fact.dataLayout.byteOrder, 0), "selected byte order"),
    requiredRuntimeNode(NewNumericLiteral(factory, String(layout.fact.byteAlignment), 0), "selected byte alignment"),
    requiredRuntimeNode(NewNumericLiteral(factory, String(layout.fact.stride), 0), "selected byte stride"),
  ]);
}

export function rewriteMemoryNode(factory: NodeFactory, selected: MemoryRewrite, updated: Node, runtimeAlias: GeneratedBindingName): Node {
  if (selected.kind === "fixed-array-type") {
    const reference = AsTypeReferenceNode(updated);
    const typeArguments = reference?.TypeArguments?.Nodes;
    if (typeArguments?.length !== 2) throw new PointerLoweringError("fixed-array storage lost its exact type arguments");
    const extent = selected.lengthRuntimeBase === "number"
      ? NewNumericLiteral(factory, String(selected.length), 0)
      : NewBigIntLiteral(factory, `${selected.length}n`, 0);
    return runtimeType(factory, runtimeAlias, "FixedArray", [typeArguments[0]!,
      requiredRuntimeNode(NewLiteralTypeNode(factory, extent), "exact fixed-array extent")]);
  }
  if (selected.kind === "metadata-type") return requiredRuntimeNode(NewKeywordTypeNode(factory, KindUndefinedKeyword), "compile-time descriptor type");
  if (selected.kind === "metadata-value") return requiredRuntimeNode(NewVoidExpression(factory, NewNumericLiteral(factory, "0", 0)), "compile-time descriptor");
  if (selected.kind === "record-schema" || selected.kind === "record-schema-reference" || selected.kind === "record-schema-imported-query") return rewriteRecordSchema(factory, selected, updated);
  if (selected.kind === "abi-type") return requiredRuntimeNode(NewKeywordTypeNode(factory, KindUndefinedKeyword), "erased closed ABI alias type");
  if (selected.kind === "layout-type" || selected.kind === "field-binding-type") {
    const reference = AsTypeReferenceNode(updated);
    const argument = reference?.TypeArguments?.Nodes[0];
    if (reference?.TypeArguments?.Nodes.length !== 1 || argument === undefined) throw new PointerLoweringError("memory layout type lost its exact pointee argument");
    return runtimeType(factory, runtimeAlias, selected.kind === "field-binding-type" ? "MemoryFieldBinding" : "MemoryLayout", [argument]);
  }
  if (selected.kind === "abi-token") return requiredRuntimeNode(NewVoidExpression(factory, NewNumericLiteral(factory, "0", 0)), "erased certified ABI operand");
  const call = AsCallExpression(updated);
  if (call === undefined) throw new PointerLoweringError("memory operation lost its call node");
  const args = call.Arguments?.Nodes ?? [];
  if (selected.kind === "pointer-view") {
    if (args.length !== 3 || args.some(argument => argument === undefined)) throw new PointerLoweringError("pointer view lost its three exact arguments");
    return runtimeCall(factory, runtimeAlias, "viewLocation", (call.TypeArguments?.Nodes ?? []).map(type => requiredRuntimeNode(type, "view type")),
      args.map(argument => requiredRuntimeNode(argument, "view argument")));
  }
  if (selected.kind === "field-binding") return rewriteBoundField(factory, selected.key, updated);
  if (selected.kind === "record-binding") return rewriteBoundRecord(factory, selected.record, updated, runtimeAlias);
  if (selected.kind === "layout") {
    if (selected.layout.kind === "array-address") {
      const element = args[4];
      const extent = args[5];
      const types = call.TypeArguments?.Nodes ?? [];
      if (args.length !== 6 || element === undefined || extent === undefined || types.length !== 0 && types.length !== 2) {
        throw new PointerLoweringError("array address layout lost its exact element descriptor or extent");
      }
      return runtimeCall(factory, runtimeAlias, "arrayAddressLayout", types.map(type => requiredRuntimeNode(type, "array address type")), [
        requiredRuntimeNode(NewStringLiteral(factory, selected.layout.fact.dataLayout.byteOrder, 0), "array byte order"),
        ...[selected.layout.fact.byteSize, selected.layout.fact.byteAlignment, selected.layout.fact.stride].map(value =>
          requiredRuntimeNode(NewNumericLiteral(factory, String(value), 0), "array dimension")),
        element, extent,
      ]);
    }
    if (selected.layout.kind === "reference") return referenceMemoryCall(factory, selected.layout);
    if (selected.layout.kind === "identity") {
      const type = call.TypeArguments?.Nodes[0];
      if (type === undefined || call.TypeArguments?.Nodes.length !== 1) {
        throw new PointerLoweringError("identity layout lost its exact transformed value type");
      }
      return runtimeCall(factory, runtimeAlias, "identityLayout", [type], [
        requiredRuntimeNode(NewStringLiteral(factory, selected.layout.domain, 0), "identity domain"),
        requiredRuntimeNode(NewStringLiteral(factory, selected.layout.fact.dataLayout.byteOrder, 0), "identity byte order"),
        ...[selected.layout.fact.byteSize, selected.layout.fact.byteAlignment, selected.layout.fact.stride].map(value =>
          requiredRuntimeNode(NewNumericLiteral(factory, String(value), 0), "identity dimension")),
      ]);
    }
    return selected.layout.kind === "record" ? rewriteRecordLayout(factory, selected.layout, updated, runtimeAlias) :
      runtimeMemoryLayout(factory, selected.layout, runtimeAlias);
  }
  if (selected.kind === "field") return rewriteRecordField(factory, selected.field, updated, runtimeAlias);
  if (selected.kind === "query") return requiredRuntimeNode(NewNumericLiteral(factory, String(selected.value), 0), "exact layout query");
  const first = args[0];
  if (first === undefined) throw new PointerLoweringError("memory operation lost its first operand");
  if (selected.kind === "keep-alive") return runtimeCall(factory, runtimeAlias, "keepAlive", [], [first]);
  const second = args[1];
  if (second === undefined) throw new PointerLoweringError("memory operation lost its second operand");
  switch (selected.fact.operation) {
    case "to-raw": return runtimeCall(factory, runtimeAlias, "toRawPointer", [], [first, second]);
    case "reinterpret": return runtimeCall(factory, runtimeAlias, "reinterpretRawPointer", [], [first, second]);
    case "byte-offset": return runtimeCall(factory, runtimeAlias, "offsetRawPointer", [], [first, second]);
    default: throw new PointerLoweringError("unrepresentable raw address operation reached emission");
  }
}
