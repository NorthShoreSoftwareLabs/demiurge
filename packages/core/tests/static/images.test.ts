import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { defineImages } from "@demiurgejs/core";
import {
  assertNoOptimizerImages,
  emitImageVariants,
} from "../../src/static/images";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

async function createOutputDirectory() {
  const outDir = await mkdtemp(join(tmpdir(), "demiurge-images-"));
  temporaryRoots.push(outDir);
  await mkdir(join(outDir, "images"), { recursive: true });
  await writeFile(
    join(outDir, "images", "hero.png"),
    await sharp({
      create: { background: "#204080", channels: 3, height: 200, width: 400 },
    }).png().toBuffer(),
  );

  return outDir;
}

function document(...paths: string[]) {
  return `<main>${
    paths.map((path) => `<img src="${path}"/>`).join("")
  }</main>`;
}

describe("static image variant emission", () => {
  it("emits one encoded file for each variant a document references", async () => {
    const outDir = await createOutputDirectory();
    const emitted = await emitImageVariants({
      documents: [
        document(
          "/_demiurge/image/images/hero.png.w200.webp",
          "/_demiurge/image/images/hero.png.w400.webp",
        ),
      ],
      outDir,
    });

    expect(emitted.map((image) => image.file)).toEqual([
      "_demiurge/image/images/hero.png.w200.webp",
      "_demiurge/image/images/hero.png.w400.webp",
    ]);
    await expect(sharp(emitted[0]!.body).metadata()).resolves.toMatchObject({
      format: "webp",
      width: 200,
    });
    await expect(sharp(emitted[1]!.body).metadata()).resolves.toMatchObject({
      width: 400,
    });
  });

  it("emits one file when two documents reference the same variant", async () => {
    const outDir = await createOutputDirectory();
    const path = "/_demiurge/image/images/hero.png.w100.png";

    await expect(
      emitImageVariants({ documents: [document(path), document(path)], outDir }),
    ).resolves.toHaveLength(1);
  });

  it("reads the quality from the variant path", async () => {
    const outDir = await createOutputDirectory();
    const emitted = await emitImageVariants({
      documents: [
        document(
          "/_demiurge/image/images/hero.png.w200.q20.webp",
          "/_demiurge/image/images/hero.png.w200.q90.webp",
        ),
      ],
      outDir,
    });

    expect(emitted).toHaveLength(2);
    expect(emitted[0]!.body).not.toEqual(emitted[1]!.body);
  });

  it("finds a variant inside a srcset attribute", async () => {
    const outDir = await createOutputDirectory();
    const emitted = await emitImageVariants({
      documents: [
        '<img srcSet="/_demiurge/image/images/hero.png.w200.webp 200w,' +
        ' /_demiurge/image/images/hero.png.w400.webp 400w"/>',
      ],
      outDir,
    });

    expect(emitted).toHaveLength(2);
  });

  it("emits nothing when no document references an image variant", async () => {
    const outDir = await createOutputDirectory();

    await expect(
      emitImageVariants({ documents: ["<main>No image here</main>"], outDir }),
    ).resolves.toEqual([]);
  });

  it("reads the optimizer path that the image policy declares", async () => {
    const outDir = await createOutputDirectory();

    await expect(
      emitImageVariants({
        documents: [document("/img/images/hero.png.w120.png")],
        outDir,
        policy: defineImages({ optimizerPath: "/img" }),
      }),
    ).resolves.toHaveLength(1);
  });

  it("stops the build when a variant path does not describe a transform", async () => {
    const outDir = await createOutputDirectory();

    await expect(
      emitImageVariants({
        documents: [document("/_demiurge/image/images/hero.png")],
        outDir,
      }),
    ).rejects.toThrow(
      'Static output references image variant "/_demiurge/image/images/hero.png", which does not describe a transform the build can emit.',
    );
  });

  it("stops the build when the image policy does not allow the source", async () => {
    const outDir = await createOutputDirectory();

    await expect(
      emitImageVariants({
        documents: [document("/_demiurge/image/images/hero.png.w100.png")],
        outDir,
        policy: defineImages({ local: false }),
      }),
    ).rejects.toThrow(
      'Image source "/images/hero.png" is not allowed by the image policy.',
    );
  });

  it("stops the build when the source image is not in the build output", async () => {
    const outDir = await createOutputDirectory();

    await expect(
      emitImageVariants({
        documents: [document("/_demiurge/image/images/missing.png.w100.png")],
        outDir,
      }),
    ).rejects.toThrow(
      'Demiurge could not read the source image "/images/missing.png" from the build output.',
    );
  });

  it("refuses a source path that leaves the build output directory", async () => {
    const outDir = await createOutputDirectory();

    await expect(
      emitImageVariants({
        documents: [document("/_demiurge/image/../secrets/hero.png.w100.png")],
        outDir,
      }),
    ).rejects.toThrow("Image source escaped the build output directory");
  });

  it("refuses a source path that is not valid UTF-8", async () => {
    const outDir = await createOutputDirectory();

    await expect(
      emitImageVariants({
        documents: [document("/_demiurge/image/images/%E0%A4%A.png.w100.png")],
        outDir,
      }),
    ).rejects.toThrow("Image source is not valid UTF-8");
  });
});

describe("the static optimizer image gate", () => {
  it("accepts a document that references no optimizer URL", () => {
    expect(() =>
      assertNoOptimizerImages([
        document("/_demiurge/image/images/hero.png.w100.png"),
      ])
    ).not.toThrow();
  });

  it("stops the build when a document points at the runtime optimizer", () => {
    expect(() =>
      assertNoOptimizerImages([
        document("/_demiurge/image?src=%2Fimages%2Fhero.png&amp;w=100"),
      ])
    ).toThrow(
      'Static output references the request-time image optimizer, which a static build cannot serve. Set loader: "static" in the image policy, or deploy a runtime adapter.',
    );
  });

  it("reads the optimizer path that the image policy declares", () => {
    expect(() =>
      assertNoOptimizerImages(
        [document("/img?src=%2Fimages%2Fhero.png&amp;w=100")],
        defineImages({ optimizerPath: "/img" }),
      )
    ).toThrow("references the request-time image optimizer");
  });
});
