import { spawnSync } from "node:child_process";

import type { TypeScriptAstPrinterOptions } from "../config/options.js";
import {
  framedPayloadLength,
  printerProtocolLimits,
} from "./protocol-budget.js";

const inputMagic = Buffer.from("TSTSPR01", "ascii");
const outputMagic = Buffer.from("TSTSPR02", "ascii");
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface TypeScriptAstPrinter {
  print(encodedSourceFiles: readonly Uint8Array[]): readonly string[];
}

export function createExternalAstPrinter(
  options: TypeScriptAstPrinterOptions,
): TypeScriptAstPrinter {
  return Object.freeze({
    print(encodedSourceFiles: readonly Uint8Array[]) {
      const input = encodeRequest(encodedSourceFiles);
      const result = spawnSync(options.executable, options.arguments, {
        input,
        maxBuffer: printerProtocolLimits.maximumPayloadBytes,
        timeout: 5 * 60 * 1000,
      });
      if (result.error !== undefined) {
        throw new Error(
          `TypeScript AST printer failed to start: ${result.error.message}`,
        );
      }
      if (result.signal !== null) {
        throw new Error(
          `TypeScript AST printer terminated by signal ${result.signal}`,
        );
      }
      if (result.status !== 0) {
        const stderr = result.stderr.toString("utf8").trim();
        throw new Error(
          `TypeScript AST printer exited with status ${String(result.status)}` +
            (stderr.length === 0 ? "" : `: ${stderr}`),
        );
      }
      return decodeResponse(result.stdout, encodedSourceFiles.length);
    },
  });
}

export function encodePrinterRequest(
  encodedSourceFiles: readonly Uint8Array[],
): Uint8Array {
  return encodeRequest(encodedSourceFiles);
}

export function decodePrinterResponse(
  response: Uint8Array,
  expectedFileCount: number,
): readonly string[] {
  return decodeResponse(Buffer.from(response), expectedFileCount);
}

function encodeRequest(encodedSourceFiles: readonly Uint8Array[]): Buffer {
  const payloadLength = framedPayloadLength(
    encodedSourceFiles.map((sourceFile) => sourceFile.byteLength),
    inputMagic.length,
    printerProtocolLimits,
    "TypeScript AST printer request",
  );
  const frames = encodedSourceFiles.map((sourceFile) => {
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32LE(sourceFile.byteLength, 0);
    return [header, Buffer.from(sourceFile)] as const;
  });
  const count = Buffer.allocUnsafe(4);
  count.writeUInt32LE(encodedSourceFiles.length, 0);
  return Buffer.concat([inputMagic, count, ...frames.flat()], payloadLength);
}

function decodeResponse(response: Buffer, expectedFileCount: number): readonly string[] {
  if (
    !Number.isSafeInteger(expectedFileCount) ||
    expectedFileCount < 0 ||
    expectedFileCount > printerProtocolLimits.maximumFileCount
  ) {
    throw new Error(
      `TypeScript AST printer expected file count ${expectedFileCount} exceeds limit ${printerProtocolLimits.maximumFileCount}`,
    );
  }
  if (response.byteLength > printerProtocolLimits.maximumPayloadBytes) {
    throw new Error(
      `TypeScript AST printer response payload size ${response.byteLength} exceeds limit ${printerProtocolLimits.maximumPayloadBytes}`,
    );
  }
  let offset = 0;
  requireAvailable(response, offset, outputMagic.length, "header");
  if (!response.subarray(offset, offset + outputMagic.length).equals(outputMagic)) {
    throw new Error("TypeScript AST printer response has invalid magic");
  }
  offset += outputMagic.length;
  requireAvailable(response, offset, 4, "file count");
  const count = response.readUInt32LE(offset);
  offset += 4;
  if (count !== expectedFileCount) {
    throw new Error(
      `TypeScript AST printer returned ${count} files, expected ${expectedFileCount}`,
    );
  }
  const files: string[] = [];
  for (let index = 0; index < count; index += 1) {
    requireAvailable(response, offset, 4, `frame ${index} length`);
    const length = response.readUInt32LE(offset);
    offset += 4;
    if (length > printerProtocolLimits.maximumFrameBytes) {
      throw new Error(
        `TypeScript AST printer response frame ${index} size ${length} exceeds limit ${printerProtocolLimits.maximumFrameBytes}`,
      );
    }
    requireAvailable(response, offset, length, `frame ${index}`);
    try {
      files.push(decoder.decode(response.subarray(offset, offset + length)));
    } catch {
      throw new Error(
        `TypeScript AST printer response frame ${index} is not valid UTF-8`,
      );
    }
    offset += length;
  }
  if (offset !== response.length) {
    throw new Error(
      `TypeScript AST printer response has ${response.length - offset} trailing bytes`,
    );
  }
  return Object.freeze(files);
}

function requireAvailable(
  buffer: Buffer,
  offset: number,
  length: number,
  subject: string,
): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > buffer.length ||
    length > buffer.length - offset
  ) {
    throw new Error(`TypeScript AST printer response ${subject} is truncated`);
  }
}
