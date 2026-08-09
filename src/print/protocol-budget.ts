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

export class BoundedFrameCollection {
  readonly #budget: FramedPayloadBudget;
  readonly #frames: Uint8Array[] = [];

  constructor(
    fixedHeaderBytes: number,
    limits: PrinterProtocolLimits,
    subject: string,
  ) {
    this.#budget = new FramedPayloadBudget(
      fixedHeaderBytes,
      limits,
      subject,
    );
  }

  append(frame: Uint8Array): void {
    this.#budget.reserveFrame(frame.byteLength);
    this.#frames.push(frame);
  }

  get size(): number {
    return this.#frames.length;
  }

  get payloadLength(): number {
    return this.#budget.payloadLength;
  }

  frames(): readonly Uint8Array[] {
    return Object.freeze([...this.#frames]);
  }
}

export function framedPayloadLength(
  frameLengths: readonly number[],
  fixedHeaderBytes: number,
  limits: PrinterProtocolLimits,
  subject: string,
): number {
  const budget = new FramedPayloadBudget(
    fixedHeaderBytes,
    limits,
    subject,
  );
  for (const length of frameLengths) {
    budget.reserveFrame(length);
  }
  return budget.payloadLength;
}

class FramedPayloadBudget {
  readonly #limits: PrinterProtocolLimits;
  readonly #subject: string;
  #frameCount = 0;
  #payloadLength: number;

  constructor(
    fixedHeaderBytes: number,
    limits: PrinterProtocolLimits,
    subject: string,
  ) {
    requireNonNegativeSafeInteger(fixedHeaderBytes, `${subject} header size`);
    this.#limits = limits;
    this.#subject = subject;
    this.#payloadLength = checkedAdd(
      fixedHeaderBytes,
      4,
      `${subject} payload size`,
    );
  }

  get payloadLength(): number {
    return this.#payloadLength;
  }

  reserveFrame(length: number): void {
    const nextCount = this.#frameCount + 1;
    if (nextCount > this.#limits.maximumFileCount) {
      throw new Error(
        `${this.#subject} file count ${nextCount} exceeds limit ${this.#limits.maximumFileCount}`,
      );
    }
    requireNonNegativeSafeInteger(
      length,
      `${this.#subject} frame ${this.#frameCount} size`,
    );
    if (length > 0xffff_ffff || length > this.#limits.maximumFrameBytes) {
      throw new Error(
        `${this.#subject} frame ${this.#frameCount} size ${length} exceeds limit ${this.#limits.maximumFrameBytes}`,
      );
    }
    let nextPayloadLength = checkedAdd(
      this.#payloadLength,
      4,
      `${this.#subject} payload size`,
    );
    nextPayloadLength = checkedAdd(
      nextPayloadLength,
      length,
      `${this.#subject} payload size`,
    );
    if (nextPayloadLength > this.#limits.maximumPayloadBytes) {
      throw new Error(
        `${this.#subject} payload size ${nextPayloadLength} exceeds limit ${this.#limits.maximumPayloadBytes}`,
      );
    }
    this.#frameCount = nextCount;
    this.#payloadLength = nextPayloadLength;
  }
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
