export interface InterfaceOriginWorkQueue<Value> {
  readonly length: number;
  readonly highWaterMark: number;
  enqueue(value: Value): void;
  dequeue(): Value | undefined;
}

export function createInterfaceOriginWorkQueue<Value>(
  initialCapacity = 64,
): InterfaceOriginWorkQueue<Value> {
  if (!Number.isSafeInteger(initialCapacity) || initialCapacity <= 0) {
    throw new Error("interface origin work-queue capacity must be positive");
  }
  let entries: (Value | undefined)[] = new Array(initialCapacity);
  let head = 0;
  let length = 0;
  let highWaterMark = 0;
  return Object.freeze({
    get length(): number {
      return length;
    },
    get highWaterMark(): number {
      return highWaterMark;
    },
    enqueue(value: Value): void {
      if (length === entries.length) {
        const expanded: (Value | undefined)[] = new Array(entries.length * 2);
        for (let index = 0; index < length; index += 1) {
          expanded[index] = entries[(head + index) % entries.length];
        }
        entries = expanded;
        head = 0;
      }
      entries[(head + length) % entries.length] = value;
      length += 1;
      highWaterMark = Math.max(highWaterMark, length);
    },
    dequeue(): Value | undefined {
      if (length === 0) {
        return undefined;
      }
      const value = entries[head];
      if (value === undefined) {
        throw new Error("interface origin work queue lost an entry");
      }
      entries[head] = undefined;
      head = (head + 1) % entries.length;
      length -= 1;
      if (length === 0) {
        head = 0;
      }
      return value;
    },
  });
}
