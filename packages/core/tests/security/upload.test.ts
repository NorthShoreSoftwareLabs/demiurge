import { describe, expect, it } from "vitest";
import { validateUploads } from "@demiurge-js/core";

describe("upload validation", () => {
  it("accepts required uploads within size and MIME limits", () => {
    const formData = new FormData();
    formData.set(
      "avatar",
      new File(["image"], "avatar.png", {
        type: "image/png",
      }),
    );

    expect(
      validateUploads(formData, {
        files: {
          avatar: {
            maxSize: "16kb",
            required: true,
            types: ["image/*"],
          },
        },
        maxTotalSize: "20kb",
      }),
    ).toMatchObject({
      issues: [],
      ok: true,
      totalSize: 5,
    });
  });

  it("reports missing required upload fields", () => {
    const result = validateUploads(new FormData(), {
      files: {
        avatar: {
          required: true,
        },
      },
    });

    expect(result).toEqual({
      files: {
        avatar: [],
      },
      issues: [
        {
          code: "file-missing",
          field: "avatar",
          message: "Upload field avatar requires at least one file.",
        },
      ],
      ok: false,
      totalSize: 0,
    });
  });

  it("reports per-file size and MIME type violations", () => {
    const formData = new FormData();
    formData.append(
      "documents",
      new File(["abcdef"], "report.txt", {
        type: "text/plain",
      }),
    );

    expect(
      validateUploads(formData, {
        files: {
          documents: {
            maxSize: "4b",
            types: ["application/pdf"],
          },
        },
      }).issues,
    ).toEqual([
      {
        code: "file-too-large",
        field: "documents",
        message: "Upload field documents contains report.txt larger than 4b.",
      },
      {
        code: "file-type-not-allowed",
        field: "documents",
        message:
          "Upload field documents contains report.txt with disallowed type text/plain.",
      },
    ]);
  });

  it("reports total upload size violations across fields", () => {
    const formData = new FormData();
    formData.append("front", new File(["1234"], "front.png"));
    formData.append("back", new File(["5678"], "back.png"));

    expect(
      validateUploads(formData, {
        files: {
          back: {},
          front: {},
        },
        maxTotalSize: "7b",
      }),
    ).toMatchObject({
      issues: [
        {
          code: "total-upload-too-large",
          field: "*",
          message: "Uploaded files exceed the maximum total size of 7b.",
        },
      ],
      ok: false,
      totalSize: 8,
    });
  });
});
