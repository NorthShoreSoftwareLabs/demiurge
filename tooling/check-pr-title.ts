import { fileURLToPath } from "node:url";

// Validates a pull request title against the Conventional Commits policy in
// AGENTS.md. GitHub squash merges every pull request, so the title becomes the
// subject of the commit on main.

export const allowedTypes = [
  "chore",
  "docs",
  "feat",
  "fix",
  "refactor",
  "release",
  "test",
] as const;

const titlePattern = /^(?<type>[A-Za-z]+)(?:\((?<scope>[^()]*)\))?(?<breaking>!)?:(?<rest>.*)$/u;

export const titleFormat = "<type>[optional scope][optional !]: <description>";

export function checkPullRequestTitle(title: string): string[] {
  if (title.trim() === "") {
    return ["The pull request title is empty. Use the form " + titleFormat + "."];
  }

  if (title !== title.trim()) {
    return ["The pull request title has a leading or trailing space. Remove it."];
  }

  const match = titlePattern.exec(title);

  if (match?.groups === undefined) {
    return [
      `The pull request title does not follow the form ${titleFormat}. ` +
        `Use one of these types: ${allowedTypes.join(", ")}.`,
    ];
  }

  const failures: string[] = [];
  const { rest, scope, type } = match.groups;

  if (!(allowedTypes as readonly string[]).includes(type)) {
    failures.push(
      `The type ${type} is not allowed. Use one of these types: ${allowedTypes.join(", ")}.`,
    );
  }

  if (scope !== undefined && scope.trim() === "") {
    failures.push("The scope is empty. Remove the parentheses, or name the scope.");
  }

  if (rest.trim() === "") {
    failures.push("The description is empty. Describe the change after the colon.");
  } else if (!rest.startsWith(" ") || rest.startsWith("  ")) {
    failures.push("Put exactly one space after the colon.");
  }

  return failures;
}

function main() {
  const title = process.env.PR_TITLE ?? process.argv[2] ?? "";
  const failures = checkPullRequestTitle(title);

  if (failures.length === 0) {
    console.log(`The pull request title follows Conventional Commits: ${title}`);
    return;
  }

  console.error(`Pull request title check failed for: ${title}\n`);

  for (const failure of failures) {
    console.error(`- ${failure}`);
  }

  console.error(
    `\nRequired form: ${titleFormat}\n` +
      `Allowed types: ${allowedTypes.join(", ")}\n` +
      "Add ! before the colon for a breaking change.\n" +
      "Example: feat(router): add a typed navigation response\n" +
      "GitHub squash merges this pull request, so the title becomes the commit subject.",
  );
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
