import type { TargetSourceFile } from "@tsonic/target-api";

import {
  TypeScriptPrinterBatchBuilder,
  type TypeScriptAstPrinter,
  type TypeScriptPrinterBatch,
} from "../print/ast-printer.js";
import {
  printerProtocolLimits,
  type PrinterProtocolLimits,
} from "../print/protocol-budget.js";

export interface EncodedTypeScriptSource {
  readonly path: string;
  readonly encoded: Uint8Array;
}

export function printEncodedTypeScriptSources(
  sources: Iterable<EncodedTypeScriptSource>,
  printer: TypeScriptAstPrinter,
  limits: PrinterProtocolLimits = printerProtocolLimits,
): readonly TargetSourceFile[] {
  const batches = partitionEncodedTypeScriptSources(sources, limits);
  const artifacts: TargetSourceFile[] = [];

  for (const { batch, paths } of batches) {
    artifacts.push(...printBatch(printer, batch, paths));
  }
  return Object.freeze(artifacts);
}

interface EncodedTypeScriptSourceBatch {
  readonly batch: TypeScriptPrinterBatch;
  readonly paths: readonly string[];
}

function partitionEncodedTypeScriptSources(
  sources: Iterable<EncodedTypeScriptSource>,
  limits: PrinterProtocolLimits,
): readonly EncodedTypeScriptSourceBatch[] {
  const batches: EncodedTypeScriptSourceBatch[] = [];
  let builder = new TypeScriptPrinterBatchBuilder(limits);
  let paths: string[] = [];

  for (const source of sources) {
    if (!builder.tryAppend(source.encoded)) {
      batches.push(sealSourceBatch(builder, paths));
      builder = new TypeScriptPrinterBatchBuilder(limits);
      paths = [];
      builder.append(source.encoded);
    }
    paths.push(source.path);
  }

  const batch = builder.seal();
  if (batch.encodedSourceFiles.length !== 0) {
    batches.push(Object.freeze({
      batch,
      paths: Object.freeze([...paths]),
    }));
  }
  return Object.freeze(batches);
}

function sealSourceBatch(
  builder: TypeScriptPrinterBatchBuilder,
  paths: readonly string[],
): EncodedTypeScriptSourceBatch {
  const batch = builder.seal();
  if (batch.encodedSourceFiles.length === 0) {
    throw new Error("TypeScript AST printer batch cannot be empty");
  }
  return Object.freeze({
    batch,
    paths: Object.freeze([...paths]),
  });
}

function printBatch(
  printer: TypeScriptAstPrinter,
  batch: TypeScriptPrinterBatch,
  paths: readonly string[],
): readonly TargetSourceFile[] {
  if (batch.encodedSourceFiles.length === 0) {
    return [];
  }
  const printed = printer.print(batch);
  if (printed.length !== paths.length) {
    throw new Error(
      `TypeScript AST printer returned ${printed.length} files, expected ${paths.length}`,
    );
  }
  return Object.freeze(paths.map((path, index): TargetSourceFile =>
    Object.freeze({
      kind: "source",
      language: "typescript",
      path,
      text: requiredPrintedSource(printed, index),
    })));
}

function requiredPrintedSource(
  printed: readonly string[],
  index: number,
): string {
  const source = printed[index];
  if (source === undefined) {
    throw new Error(`TypeScript AST printer omitted file ${index}`);
  }
  return source;
}
