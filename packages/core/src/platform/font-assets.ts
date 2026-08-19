import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  defaultFontPath,
  fontAssetFileName,
  fontFormat,
  fontMediaType,
  fontStylesheetUrl,
  renderFontFaceCss,
  type FontContribution,
  type FontDefinition,
} from "./fonts";

export type FontAssetFetch = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<Response>;

export type FontAssetOptions = {
  basePath?: string;
  // Where a downloaded font file stays between builds. A build that already
  // downloaded a font reads it back and makes no network request.
  cacheDir?: string;
  fetch?: FontAssetFetch;
  fonts?: FontContribution;
  // The project directory that every local font source resolves against.
  root: string;
};

export type FontAsset = {
  body: Uint8Array;
  contentType: string;
  // The output path, relative to the directory that the build publishes.
  file: string;
  url: string;
};

const maximumFontBytes = 5 * 1024 * 1024;

// One font declaration becomes one published file plus one stylesheet. The
// build writes these files, and the Node handler serves the same set from
// memory. Both derive every URL from the declaration, so they cannot drift.
export async function resolveFontAssets(
  options: FontAssetOptions,
): Promise<FontAsset[]> {
  const fonts = options.fonts ?? [];

  if (fonts.length === 0) {
    return [];
  }

  const basePath = options.basePath ?? defaultFontPath;
  const root = resolve(options.root);
  const cacheDir = resolve(
    options.cacheDir ?? join(root, "node_modules", ".demiurge", "fonts"),
  );
  const load = options.fetch ?? ((input, init) => fetch(input, init));
  const published = new Map<string, string>();
  const assets: FontAsset[] = [];

  for (const definition of fonts) {
    if (!definition.selfHost) {
      continue;
    }

    const name = fontAssetFileName(definition);
    const claimed = published.get(name);

    if (claimed !== undefined) {
      if (claimed !== definition.src) {
        throw new Error(
          `Font family ${JSON.stringify(definition.family)} declares two sources that publish the same file ${JSON.stringify(name)}. Give one of them a different weight or style.`,
        );
      }

      continue;
    }

    published.set(name, definition.src);
    assets.push({
      body: await readFontBody(definition, { cacheDir, load, root }),
      contentType: fontMediaType(definition.src),
      file: outputFile(basePath, name),
      url: `${basePath}/${name}`,
    });
  }

  const stylesheet = `${renderFontFaceCss(fonts, basePath)}\n`;

  assets.push({
    body: new TextEncoder().encode(stylesheet),
    contentType: "text/css; charset=utf-8",
    file: outputFile(basePath, "fonts.css"),
    url: fontStylesheetUrl(basePath),
  });

  return assets;
}

async function readFontBody(
  definition: FontDefinition,
  context: { cacheDir: string; load: FontAssetFetch; root: string },
) {
  const body = definition.source === "google"
    ? await downloadFontFile(definition, context)
    : await readLocalFontFile(definition, context.root);

  if (body.byteLength === 0) {
    throw new Error(
      `Font family ${JSON.stringify(definition.family)} resolved to an empty file.`,
    );
  }

  if (body.byteLength > maximumFontBytes) {
    throw new Error(
      `Font family ${JSON.stringify(definition.family)} is larger than the ${maximumFontBytes} byte limit.`,
    );
  }

  return body;
}

async function readLocalFontFile(definition: FontDefinition, root: string) {
  const file = resolve(root, definition.src.replace(/^\/+/, ""));

  if (relative(root, file).split(sep).includes("..")) {
    throw new Error(
      `Font source escaped the project directory: ${JSON.stringify(definition.src)}.`,
    );
  }

  try {
    return new Uint8Array(await readFile(file));
  } catch (error) {
    throw new Error(
      `Demiurge could not read the font file ${JSON.stringify(definition.src)} for family ${JSON.stringify(definition.family)}.`,
      { cause: error },
    );
  }
}

// A downloaded font stays in the cache directory. The first build reaches the
// font host once, and every later build reads the file from disk. A build that
// runs without network access therefore keeps working.
async function downloadFontFile(
  definition: FontDefinition,
  context: { cacheDir: string; load: FontAssetFetch; root: string },
) {
  const digest = createHash("sha256").update(definition.src).digest("hex");
  const cacheFile = join(
    context.cacheDir,
    `${digest.slice(0, 32)}.${fontFormat(definition.src)}`,
  );

  try {
    return new Uint8Array(await readFile(cacheFile));
  } catch {
    // The cache holds no copy yet, so the font host answers this once.
  }

  let response: Response;

  try {
    response = await context.load(definition.src);
  } catch (error) {
    throw new Error(
      `Demiurge could not download the font for family ${JSON.stringify(definition.family)} from ${JSON.stringify(definition.src)}.`,
      { cause: error },
    );
  }

  if (!response.ok) {
    throw new Error(
      `The font host answered ${response.status} for family ${JSON.stringify(definition.family)} at ${JSON.stringify(definition.src)}.`,
    );
  }

  const body = new Uint8Array(await response.arrayBuffer());

  await mkdir(context.cacheDir, { recursive: true });
  await writeFile(cacheFile, body);

  return body;
}

function outputFile(basePath: string, name: string) {
  return `${basePath.replace(/^\/+/, "")}/${name}`;
}
