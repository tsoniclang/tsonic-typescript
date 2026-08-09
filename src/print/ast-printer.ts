import { spawnSync } from "node:child_process";

import type { TypeScriptAstPrinterOptions } from "../config/options.js";

const inputMagic = Buffer.from("TSTSPR01", "ascii");
const outputMagic = Buffer.from("TSTSPR02", "ascii");
const maximumFileCount = 1_000_000;
const maximumFrameSize = 1 << 30;

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
        maxBuffer: 512 * 1024 * 1024,
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
  if (encodedSourceFiles.length > maximumFileCount) {
    throw new Error(
      `TypeScript AST printer file count ${encodedSourceFiles.length} exceeds limit`,
    );
  }
  const frames = encodedSourceFiles.map((sourceFile, index) => {
    if (sourceFile.byteLength > maximumFrameSize) {
      throw new Error(
        `TypeScript AST printer frame ${index} size ${sourceFile.byteLength} exceeds limit`,
      );
    }
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32LE(sourceFile.byteLength, 0);
    return [header, Buffer.from(sourceFile)] as const;
  });
  const count = Buffer.allocUnsafe(4);
  count.writeUInt32LE(encodedSourceFiles.length, 0);
  return Buffer.concat([inputMagic, count, ...frames.flat()]);
}

function decodeResponse(response: Buffer, expectedFileCount: number): readonly string[] {
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
    if (length > maximumFrameSize) {
      throw new Error(
        `TypeScript AST printer response frame ${index} size ${length} exceeds limit`,
      );
    }
    requireAvailable(response, offset, length, `frame ${index}`);
    files.push(response.subarray(offset, offset + length).toString("utf8"));
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
  if (offset + length > buffer.length) {
    throw new Error(`TypeScript AST printer response ${subject} is truncated`);
  }
}
