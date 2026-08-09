export interface PrinterProtocolLimits {
  readonly maximumFileCount: number;
  readonly maximumFrameBytes: number;
  readonly maximumPayloadBytes: number;
}

export const printerProtocolLimits: PrinterProtocolLimits = Object.freeze({
  maximumFileCount: 100_000,
  maximumFrameBytes: 64 * 1024 * 1024,
  maximumPayloadBytes: 256 * 1024 * 1024,
});

export function framedPayloadLength(
  frameLengths: readonly number[],
  fixedHeaderBytes: number,
  limits: PrinterProtocolLimits,
  subject: string,
): number {
  requireNonNegativeSafeInteger(fixedHeaderBytes, `${subject} header size`);
  if (frameLengths.length > limits.maximumFileCount) {
    throw new Error(
      `${subject} file count ${frameLengths.length} exceeds limit ${limits.maximumFileCount}`,
    );
  }
  let total = checkedAdd(fixedHeaderBytes, 4, `${subject} payload size`);
  for (const [index, length] of frameLengths.entries()) {
    requireNonNegativeSafeInteger(length, `${subject} frame ${index} size`);
    if (length > 0xffff_ffff || length > limits.maximumFrameBytes) {
      throw new Error(
        `${subject} frame ${index} size ${length} exceeds limit ${limits.maximumFrameBytes}`,
      );
    }
    total = checkedAdd(total, 4, `${subject} payload size`);
    total = checkedAdd(total, length, `${subject} payload size`);
    if (total > limits.maximumPayloadBytes) {
      throw new Error(
        `${subject} payload size ${total} exceeds limit ${limits.maximumPayloadBytes}`,
      );
    }
  }
  return total;
}

function checkedAdd(left: number, right: number, subject: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new Error(`${subject} exceeds safe integer range`);
  }
  return result;
}

function requireNonNegativeSafeInteger(value: number, subject: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${subject} must be a non-negative safe integer`);
  }
}
