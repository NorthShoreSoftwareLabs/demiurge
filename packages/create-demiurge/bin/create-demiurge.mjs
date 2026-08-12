#!/usr/bin/env node

/* global console, process */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const options = parseArguments(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (options.version) {
    const metadata = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    );
    console.log(metadata.version);
    return;
  }

  const answers = await getAnswers(options);
  const target = resolve(process.cwd(), answers.directory);
  await assertEmptyTarget(target);
  await mkdir(target, { recursive: true });
  await cp(join(packageRoot, "templates", "shared"), target, { recursive: true });
  await cp(join(packageRoot, "templates", answers.template), target, {
    recursive: true,
  });

  const packageFile = join(target, "package.json");
  const packageSource = await readFile(packageFile, "utf8");
  await writeFile(
    packageFile,
    packageSource.replace("__PACKAGE_NAME__", packageName(target)),
  );

  console.log(`\nCreated ${answers.template} application in ${target}.`);
  console.log("\nRun these commands:");
  if (target !== process.cwd()) {
    console.log(`  cd ${JSON.stringify(answers.directory)}`);
  }
  console.log("  npm install");
  console.log("  npm run dev");
}

function parseArguments(arguments_) {
  const options = { directory: undefined, help: false, template: undefined, version: false, yes: false };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];

    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--version" || argument === "-v") {
      options.version = true;
    } else if (argument === "--yes" || argument === "-y") {
      options.yes = true;
    } else if (argument === "--template" || argument === "-t") {
      options.template = arguments_[index + 1];
      index += 1;
    } else if (argument.startsWith("--template=")) {
      options.template = argument.slice("--template=".length);
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (options.directory) {
      throw new Error("Specify only one application directory.");
    } else {
      options.directory = argument;
    }
  }

  if (options.template && !["api", "page"].includes(options.template)) {
    throw new Error('Template must be "page" or "api".');
  }

  return options;
}

async function getAnswers(options) {
  if (options.yes) {
    return {
      directory: options.directory ?? "demiurge-app",
      template: options.template ?? "page",
    };
  }

  if (!stdin.isTTY || !stdout.isTTY) {
    if (!options.directory || !options.template) {
      throw new Error(
        "Non-interactive use requires a directory and --template page|api, or --yes.",
      );
    }
    return options;
  }

  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const directory = options.directory ?? (
      (await prompt.question("Application directory (demiurge-app): ")) ||
      "demiurge-app"
    );
    let template = options.template;

    while (!template) {
      const answer = (await prompt.question("Template, page or api (page): "))
        .trim()
        .toLowerCase() || "page";
      if (["api", "page"].includes(answer)) {
        template = answer;
      } else {
        console.error('Enter "page" or "api".');
      }
    }

    return { directory, template };
  } finally {
    prompt.close();
  }
}

async function assertEmptyTarget(target) {
  try {
    const entries = await readdir(target);
    if (entries.length > 0) {
      throw new Error(`Target directory is not empty: ${target}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function packageName(target) {
  const normalized = basename(target)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  return normalized || "demiurge-app";
}

function printHelp() {
  console.log(`Usage: npm create demiurge [directory] [options]

Options:
  -t, --template <page|api>  Select the application template
  -y, --yes                  Use the page template and default directory
  -h, --help                 Show this help
  -v, --version              Show the package version`);
}

main().catch((error) => {
  console.error(`create-demiurge: ${error.message}`);
  process.exitCode = 1;
});
