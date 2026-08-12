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
] as const;

type Paragraph = {
  file: string;
  line: number;
  text: string;
};

type Finding = {
  file: string;
  line: number;
  message: string;
};

const markdownFiles = trackedFiles("*.md");
const sourceFiles = trackedFiles("*.ts", "*.tsx", "*.js", "*.mjs", "*.cjs");

const findings: Finding[] = [];

for (const file of markdownFiles) {
  for (const paragraph of markdownParagraphs(file)) {
    checkParagraph(paragraph);
  }
}

for (const file of sourceFiles) {
  for (const paragraph of sourceCommentParagraphs(file)) {
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
    `ASD-STE100 objective checks passed for ${markdownFiles.length} Markdown files and ${sourceFiles.length} source files.`,
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

function checkParagraph(paragraph: Paragraph) {
  const prose = normalizeMarkdown(paragraph.text);

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
      current = { file, line: lineNumber, text };
    } else {
      current.text += ` ${text}`;
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
      current = { file, line: index + 1, text };
    } else {
      current.text += ` ${text}`;
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
