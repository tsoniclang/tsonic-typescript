import type {
  TargetToolchain,
  TargetToolchainContext,
  TargetToolchainInput,
  TargetToolchainResult,
} from "@tsonic/target-api";

export function createTypeScriptToolchain(
  _context: TargetToolchainContext,
): TargetToolchain {
  return Object.freeze({
    prepare(input: TargetToolchainInput): TargetToolchainResult {
      return Object.freeze({
        diagnostics: Object.freeze([]),
        producedArtifacts: Object.freeze(
          input.compileOutput.artifacts.map((artifact) => artifact.path),
        ),
      });
    },
  });
}
