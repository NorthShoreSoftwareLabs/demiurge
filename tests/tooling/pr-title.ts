import { checkPullRequestTitle } from "../../tooling/check-pr-title";

// Unit tests for the pull request title check. GitHub squash merges each pull
// request, so an accepted title becomes a commit subject on main.

const accepted = [
  "feat: add a typed navigation response",
  "fix(router): keep a trailing slash out of the manifest",
  "docs: describe the release check",
  "test: cover the packed consumer",
  "refactor(document): extract the head flush",
  "chore(pipeline): pin the checkout action",
  "release: publish 0.2.0",
  "feat!: remove the legacy adapter export",
  "feat(router)!: remove the legacy route type",
  "fix(kv/redis): reconnect after a dropped socket",
];

const rejected: Array<[string, string]> = [
  ["", "title is empty"],
  ["   ", "title is empty"],
  ["add a typed navigation response", "does not follow the form"],
  ["feat add a typed navigation response", "does not follow the form"],
  ["feat:", "description is empty"],
  ["feat:   ", "leading or trailing space"],
  ["feat(router):", "description is empty"],
  ["build: add a bundler flag", "The type build is not allowed"],
  ["Feat: add a typed navigation response", "The type Feat is not allowed"],
  ["feat(): add nothing", "scope is empty"],
  ["feat:add a typed navigation response", "exactly one space after the colon"],
  ["feat:  add a typed navigation response", "exactly one space after the colon"],
  [" feat: add a typed navigation response", "leading or trailing space"],
  ["feat: add a typed navigation response ", "leading or trailing space"],
];

let failureCount = 0;

for (const title of accepted) {
  const failures = checkPullRequestTitle(title);

  if (failures.length === 0) {
    console.log(`ok - accepts ${title}`);
  } else {
    failureCount += 1;
    console.error(`not ok - accepts ${title}: ${failures.join(" | ")}`);
  }
}

for (const [title, fragment] of rejected) {
  const failures = checkPullRequestTitle(title);

  if (failures.some((failure) => failure.includes(fragment))) {
    console.log(`ok - rejects ${JSON.stringify(title)}`);
  } else {
    failureCount += 1;
    console.error(
      `not ok - rejects ${JSON.stringify(title)}: expected "${fragment}", received: ${failures.join(" | ")}`,
    );
  }
}

if (failureCount > 0) {
  console.error(`\n${failureCount} pull request title test failure(s).`);
  process.exitCode = 1;
} else {
  console.log("pull request title tests passed.");
}
