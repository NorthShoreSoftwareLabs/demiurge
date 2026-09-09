import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const instructionVerbs = new Set([
  "add",
  "apply",
  "avoid",
  "build",
  "check",
  "choose",
  "close",
  "confirm",
  "configure",
  "continue",
  "create",
  "define",
  "do",
  "document",
  "enable",
  "follow",
  "install",
  "keep",
  "make",
  "move",
  "never",
  "open",
  "pass",
  "prefer",
  "preserve",
  "provide",
  "publish",
  "put",
  "read",
  "remove",
  "report",
  "require",
  "run",
  "select",
  "set",
  "start",
  "stop",
  "treat",
  "update",
  "use",
  "validate",
  "verify",
  "write",
]);

const prohibited = [
  { expression: /\b(?:can|could|did|do|does|had|has|have|is|must|should|was|were|will|would)n['’]t\b/giu, name: "contraction" },
  { expression: /\b(?:he|here|how|it|she|that|there|they|we|what|when|where|who|why|you)['’](?:d|ll|re|s|ve)\b/giu, name: "contraction" },
  { expression: /\b(?:e\.g\.|i\.e\.|etc\.)/giu, name: "Latin abbreviation" },
  { expression: /;/gu, name: "semicolon" },
  {
    expression:
      /\b(?:delve|leverage|robust|seamless|multifaceted|furthermore|moreover|underscore|pivotal|transformative|foster|streamline|facilitate|utilize|holistic|comprehensive|crucial)\b/giu,
    name: "tell-word",
  },

] as const;

const antithesis =
  /\b(?:is|are|was|were)\s+not\s+(?:the\s+same\s+as|about|to)\b|,\s+not\s+(?:a|an|the|one)\b|\b(?:instead\s+of|rather\s+than)\b/giu;

const ANTITHESIS_LIMIT = 1;
const ENUMERATION_LIMIT = 1;
const REPEATED_OPENER_LIMIT = 3;
const DEFINITE_OPENER_SHARE = 0.35;
const MONOTONY_SENTENCE_FLOOR = 12;

type Paragraph = {
  file: string;
  line: number;
  endLine: number;
  list?: boolean;
  text: string;
};

type Finding = {
  file: string;
  line: number;
  message: string;
};

const markdownFiles = trackedFiles("*.md");
const sourceFiles = trackedFiles("*.ts", "*.tsx", "*.js", "*.mjs", "*.cjs");
const changedLines = changedLineNumbers([...markdownFiles, ...sourceFiles]);

const findings: Finding[] = [];

for (const file of markdownFiles) {
  const paragraphs = markdownParagraphs(file);
  const changed = changedParagraphs(paragraphs);
  for (const paragraph of changed) {
    checkParagraph(paragraph);
  }
  checkRegister(
    file,
    changed
      .filter((paragraph) => !paragraph.list)
      .map((paragraph) => normalizeMarkdown(paragraph.text)),
  );
}

for (const file of sourceFiles) {
  for (const paragraph of changedParagraphs(sourceCommentParagraphs(file))) {
    checkParagraph(paragraph);
  }
}

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}: ${finding.message}`);
  }

  console.error(`\n${findings.length} writing violation${findings.length === 1 ? "" : "s"}.`);
  process.exitCode = 1;
} else {
  console.log(
    `Writing checks passed for ${markdownFiles.length} Markdown files and ${sourceFiles.length} source files.`,
  );
}

function trackedFiles(...patterns: string[]) {
  return execFileSync(
  "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...patterns],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
}

function changedLineNumbers(files: string[]) {
  const base = comparisonBase();
  const output = execFileSync("git", ["diff", "--unified=0", "--no-color", base, "--", ...files], {
    encoding: "utf8",
  });
  const lines = new Map<string, Set<number>>();
  let file: string | undefined;
  let nextLine = 0;

  for (const line of output.split("\n")) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/u);
    if (fileMatch) {
      file = fileMatch[1];
      continue;
    }

    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u);
    if (hunkMatch) {
      nextLine = Number(hunkMatch[1]);
      continue;
    }

    if (!file || nextLine === 0) continue;
    if (line.startsWith("+")) {
      const fileLines = lines.get(file) ?? new Set<number>();
      fileLines.add(nextLine);
      lines.set(file, fileLines);
      nextLine += 1;
    } else if (!line.startsWith("-")) {
      nextLine += 1;
    }
  }

  return lines;
}

function comparisonBase() {
  const parents = execFileSync("git", ["rev-list", "--parents", "-n", "1", "HEAD"], {
    encoding: "utf8",
  })
    .trim()
    .split(" ");

  if (parents.length > 2) return parents[1];

  try {
    return execFileSync("git", ["merge-base", "HEAD", "origin/main"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "HEAD";
  }
}

function changedParagraphs(paragraphs: Paragraph[]) {
  return paragraphs.filter((paragraph) => {
    const fileLines = changedLines.get(paragraph.file);
    if (!fileLines) return false;

    for (let line = paragraph.line; line <= paragraph.endLine; line += 1) {
      if (fileLines.has(line)) return true;
    }
    return false;
  });
}

function checkRegister(file: string, prose: string[]) {
  const collected = prose.flatMap((text) => sentences(text));

  let antitheses = 0;
  for (const text of prose) {
    antitheses += [...text.matchAll(antithesis)].length;
  }

  if (antitheses > ANTITHESIS_LIMIT) {
    findings.push({
      file,
      line: 1,
      message: `${antitheses} antithesis constructions such as "X, not Y" or "instead of Y". The limit is ${ANTITHESIS_LIMIT}. State the claim directly.`,
    });
  }

  for (const sentence of collected) {
    const items = sentence.split(",").length;
    const illustrative = /\b(?:such as|for example|like)\b/iu.test(sentence);

    if (items > ENUMERATION_LIMIT && illustrative) {
      findings.push({
        file,
        line: 1,
        message: `a sentence lists ${items} items. Give one example or none: ${sentence.slice(0, 60)}`,
      });
    }
  }

  if (collected.length < MONOTONY_SENTENCE_FLOOR) return;

  const openers = new Map<string, number>();
  let definite = 0;

  for (const sentence of collected) {
    const words = sentence.split(/\s+/u).filter(Boolean);
    if (words[0]?.toLowerCase() === "the") definite += 1;

    const first = words[0]?.toLowerCase() ?? "";
    if (first === "do" || instructionVerbs.has(first)) continue;

    const opener = words.slice(0, 2).join(" ").toLowerCase();
    openers.set(opener, (openers.get(opener) ?? 0) + 1);
  }

  const share = definite / collected.length;
  if (share > DEFINITE_OPENER_SHARE) {
    findings.push({
      file,
      line: 1,
      message: `${Math.round(share * 100)} percent of sentences start with "The". Vary the opener. The limit is ${Math.round(DEFINITE_OPENER_SHARE * 100)} percent.`,
    });
  }

  for (const [opener, count] of openers) {
    if (count > REPEATED_OPENER_LIMIT) {
      findings.push({
        file,
        line: 1,
        message: `the opener "${opener}" starts ${count} sentences. The limit is ${REPEATED_OPENER_LIMIT}.`,
      });
    }
  }
}

function checkParagraph(paragraph: Paragraph) {
  const prose = normalizeMarkdown(paragraph.text);

  if (!paragraph.list) {
    for (const match of prose.matchAll(/—/gu)) {
      findings.push({
        file: paragraph.file,
        line: paragraph.line,
        message: `em-dash: ${match[0]}`,
      });
    }
  }

  for (const rule of prohibited) {
    for (const match of prose.matchAll(rule.expression)) {
      findings.push({
        file: paragraph.file,
        line: paragraph.line,
        message: `${rule.name}: ${match[0]}`,
      });
    }
  }

  for (const sentence of sentences(prose)) {
    const words = wordCount(sentence);
    const firstWord = sentence.match(/[A-Za-z]+/)?.[0].toLowerCase();
    const limit = firstWord && instructionVerbs.has(firstWord) ? 20 : 25;

    if (words > limit) {
      findings.push({
        file: paragraph.file,
        line: paragraph.line,
        message: `${words}-word sentence exceeds the ${limit}-word limit: ${sentence}`,
      });
    }
  }
}

function markdownParagraphs(file: string): Paragraph[] {
  const lines = readFileSync(file, "utf8").split("\n");
  const paragraphs: Paragraph[] = [];
  let fenced = false;
  let current: Paragraph | undefined;

  const flush = () => {
    if (current) {
      paragraphs.push(current);
      current = undefined;
    }
  };

  for (const [index, sourceLine] of lines.entries()) {
    const lineNumber = index + 1;
    const trimmed = sourceLine.trim();

    if (/^```/.test(trimmed)) {
      flush();
      fenced = !fenced;
      continue;
    }

    if (
      fenced ||
      trimmed === "" ||
      /^#{1,6}\s/.test(trimmed) ||
      /^\|/.test(trimmed) ||
      /^[-:| ]{3,}$/.test(trimmed) ||
      /^<[^>]+>/.test(trimmed)
    ) {
      flush();
      continue;
    }

    const listItem = /^(?:[-*+] |\d+\. )/.test(trimmed);
    const text = trimmed
      .replace(/^>\s?/, "")
      .replace(/^(?:[-*+] |\d+\. )/, "");

    if (listItem) {
      flush();
    }

    if (!current) {
      current = { file, line: lineNumber, endLine: lineNumber, list: listItem, text };
    } else {
      current.text += ` ${text}`;
      current.endLine = lineNumber;
    }
  }

  flush();
  return paragraphs;
}

function sourceCommentParagraphs(file: string): Paragraph[] {
  const lines = readFileSync(file, "utf8").split("\n");
  const paragraphs: Paragraph[] = [];
  let current: Paragraph | undefined;

  const flush = () => {
    if (current) {
      paragraphs.push(current);
      current = undefined;
    }
  };

  for (const [index, sourceLine] of lines.entries()) {
    const match = sourceLine.match(/^\s*\/\/\s?(?![/@#])(.+)$/u);

    if (!match) {
      flush();
      continue;
    }

    const text = match[1].trim();
    if (!current) {
      current = { file, line: index + 1, endLine: index + 1, text };
    } else {
      current.text += ` ${text}`;
      current.endLine = index + 1;
    }
  }

  flush();
  return paragraphs;
}

function normalizeMarkdown(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`[^`]+`/g, " TECHNICAL_NAME ")
    .replace(/<https?:\/\/[^>]+>/g, " URL ")
    .replace(/https?:\/\/\S+/g, " URL ")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sentences(value: string) {
  return value
    .split(/(?<=[.!?])\s+(?=[A-Z`])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function wordCount(value: string) {
  return value.match(/[A-Za-z0-9@][A-Za-z0-9@'’./:+_-]*/gu)?.length ?? 0;
}
