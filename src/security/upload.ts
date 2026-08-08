import { parseBodySize } from "./request";
import type { RequestSecurityPolicy } from "./types";

export type UploadFilePolicy = {
  maxSize?: RequestSecurityPolicy["maxBodySize"];
  required?: boolean;
  types?: readonly string[];
};

export type UploadPolicy = {
  files: Record<string, UploadFilePolicy>;
  maxTotalSize?: RequestSecurityPolicy["maxBodySize"];
};

export type UploadValidationIssue = {
  code:
    | "file-missing"
    | "file-too-large"
    | "file-type-not-allowed"
    | "total-upload-too-large";
  field: string;
  message: string;
};

export type UploadValidationResult = {
  files: Record<string, File[]>;
  issues: UploadValidationIssue[];
  ok: boolean;
  totalSize: number;
};

export function validateUploads(
  formData: FormData,
  policy: UploadPolicy,
): UploadValidationResult {
  const files: Record<string, File[]> = {};
  const issues: UploadValidationIssue[] = [];
  let totalSize = 0;

  for (const [field, filePolicy] of Object.entries(policy.files)) {
    const fieldFiles = formData.getAll(field).filter(isFile);
    files[field] = fieldFiles;

    if (filePolicy.required && fieldFiles.length === 0) {
      issues.push({
        code: "file-missing",
        field,
        message: `Upload field ${field} requires at least one file.`,
      });
    }

    for (const file of fieldFiles) {
      totalSize += file.size;
      validateFile(field, file, filePolicy, issues);
    }
  }

  if (
    policy.maxTotalSize !== undefined &&
    totalSize > parseBodySize(policy.maxTotalSize)
  ) {
    issues.push({
      code: "total-upload-too-large",
      field: "*",
      message: `Uploaded files exceed the maximum total size of ${policy.maxTotalSize}.`,
    });
  }

  return {
    files,
    issues,
    ok: issues.length === 0,
    totalSize,
  };
}

function validateFile(
  field: string,
  file: File,
  policy: UploadFilePolicy,
  issues: UploadValidationIssue[],
) {
  if (policy.maxSize !== undefined && file.size > parseBodySize(policy.maxSize)) {
    issues.push({
      code: "file-too-large",
      field,
      message: `Upload field ${field} contains ${file.name || "a file"} larger than ${policy.maxSize}.`,
    });
  }

  if (policy.types?.length && !isAllowedFileType(file.type, policy.types)) {
    issues.push({
      code: "file-type-not-allowed",
      field,
      message: `Upload field ${field} contains ${file.name || "a file"} with disallowed type ${file.type || "unknown"}.`,
    });
  }
}

function isAllowedFileType(type: string, allowedTypes: readonly string[]) {
  return allowedTypes.some((allowedType) => {
    if (allowedType.endsWith("/*")) {
      return type.startsWith(allowedType.slice(0, -1));
    }

    return type === allowedType;
  });
}

function isFile(value: FormDataEntryValue): value is File {
  return value instanceof File;
}
