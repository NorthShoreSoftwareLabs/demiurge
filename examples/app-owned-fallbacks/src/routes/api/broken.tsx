import { httpError, json } from "@demiurgejs/core";

export const GET = json(() => {
  throw httpError(409, {
    code: "PROJECT_REVISION_CONFLICT",
    detail: "The project revision changed before this request completed.",
    title: "Project Revision Conflict",
    type: "https://demiurge.dev/problems/project-revision-conflict",
  });
});
