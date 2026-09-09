import type { ResolvedDemiurgeConfig } from "../config/types";
import { toPluginOptions } from "../config/vite";
import {
  countErrorFindings,
  createStaticPolicyReport,
  findSecretEnvKeys,
  formatStaticPolicyReportSummary,
} from "./report";
import { serializeInspectionReport } from "./redact";
import {
  INSPECTION_PROBLEM_VERSION,
  type InspectionProblem,
  type InspectionProblemCode,
} from "./types";

/** The exit codes of the `demiurge inspect` command. */
export const INSPECT_EXIT_OK = 0;
export const INSPECT_EXIT_FINDINGS = 1;
export const INSPECT_EXIT_INVALID = 2;

export type InspectCommandInput = {
  /** The arguments that follow the command name. */
  arguments: readonly string[];
  /** Reads the configuration of the application. */
  loadConfig: () => Promise<ResolvedDemiurgeConfig>;
};

export type InspectCommandResult = {
  /** The exit code of the command. */
  exitCode: number;
  /** The human summary that the command writes to standard error. */
  stderr: string;
  /** The JSON document that the command writes to standard output. */
  stdout: string;
};

/**
 * Runs the `demiurge inspect` command.
 *
 * The command reads the route tree, resolves the policy cascade, and returns
 * one JSON document. The command loads no route module, so it runs no data
 * loader and no mutation handler.
 */
export async function runInspectCommand(
  input: InspectCommandInput,
): Promise<InspectCommandResult> {
  if (input.arguments.length > 0) {
    return toProblemResult(
      "invalid-argument",
      "The inspect command accepts no argument.",
      `The command received ${input.arguments.join(" ")}.`,
    );
  }

  let config: ResolvedDemiurgeConfig;

  try {
    config = await input.loadConfig();
  } catch (error) {
    return toProblemResult(
      "configuration-unreadable",
      "Demiurge could not read the configuration.",
      error instanceof Error ? error.message : String(error),
    );
  }

  const report = await createStaticPolicyReport({
    options: toPluginOptions(config),
    root: config.root,
  });

  return {
    exitCode: countErrorFindings(report) > 0
      ? INSPECT_EXIT_FINDINGS
      : INSPECT_EXIT_OK,
    stderr: formatStaticPolicyReportSummary(report),
    stdout: serializeInspectionReport(report, {
      secretEnvKeys: findSecretEnvKeys(config.env),
    }),
  };
}

function toProblemResult(
  code: InspectionProblemCode,
  title: string,
  detail: string,
): InspectCommandResult {
  const problem: InspectionProblem = {
    code,
    detail,
    title,
    version: INSPECTION_PROBLEM_VERSION,
  };

  return {
    exitCode: INSPECT_EXIT_INVALID,
    stderr: `${title}\n${detail}`,
    stdout: serializeInspectionReport(problem),
  };
}
