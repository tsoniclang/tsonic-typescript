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

export class FramedPayloadBudget {
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
    requirePositiveSafeInteger(
      limits.maximumFileCount,
      `${subject} maximum file count`,
    );
    requireNonNegativeSafeInteger(
      limits.maximumFrameBytes,
      `${subject} maximum frame size`,
    );
    requireNonNegativeSafeInteger(
      limits.maximumPayloadBytes,
      `${subject} maximum payload size`,
    );
    this.#limits = limits;
    this.#subject = subject;
    this.#payloadLength = checkedAdd(
      fixedHeaderBytes,
      4,
      `${subject} payload size`,
    );
    if (this.#payloadLength > limits.maximumPayloadBytes) {
      throw new Error(
        `${subject} base payload size ${this.#payloadLength} exceeds limit ${limits.maximumPayloadBytes}`,
      );
    }
  }

  get payloadLength(): number {
    return this.#payloadLength;
  }

  reserveFrame(length: number): void {
    const rejection = this.#reserveFrame(length);
    if (rejection !== undefined) {
      throw new Error(rejection);
    }
  }

  tryReserveFrame(length: number): boolean {
    return this.#reserveFrame(length) === undefined;
  }

  #reserveFrame(length: number): string | undefined {
    const nextCount = this.#frameCount + 1;
    if (nextCount > this.#limits.maximumFileCount) {
      return `${this.#subject} file count ${nextCount} exceeds limit ${this.#limits.maximumFileCount}`;
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
      return `${this.#subject} payload size ${nextPayloadLength} exceeds limit ${this.#limits.maximumPayloadBytes}`;
    }
    this.#frameCount = nextCount;
    this.#payloadLength = nextPayloadLength;
    return undefined;
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

function requirePositiveSafeInteger(value: number, subject: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${subject} must be a positive safe integer`);
  }
}
