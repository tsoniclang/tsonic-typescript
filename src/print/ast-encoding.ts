import {
  defaultTargetAstEncodingLimits,
  encodeTargetSourceFileForPrinting,
  TargetAstEncodingError,
  type SourceFile,
  type TargetAstEncodingLimits,
} from "@tsonic/tsts/target-ast";

import { printerProtocolLimits } from "./protocol-budget.js";

export const targetAstEncodingLimits: TargetAstEncodingLimits = Object.freeze({
  ...defaultTargetAstEncodingLimits,
  maximumNodeRows: 4_194_304,
  maximumStringCount: 2_097_152,
  maximumEncodedBytes: printerProtocolLimits.maximumFrameBytes,
});

export function encodeTargetSourceFile(sourceFile: SourceFile): Uint8Array {
  try {
    return encodeTargetSourceFileForPrinting(sourceFile, targetAstEncodingLimits);
  } catch (error) {
    if (!(error instanceof TargetAstEncodingError)) {
      throw error;
    }
    const evidence = [
      error.kind === undefined ? undefined : `kind=${error.kind}`,
      error.field === undefined ? undefined : `field=${error.field}`,
    ].filter((value): value is string => value !== undefined);
    throw new Error(
      `${error.message}${evidence.length === 0 ? "" : ` (${evidence.join(", ")})`}`,
      { cause: error },
    );
  }
}
