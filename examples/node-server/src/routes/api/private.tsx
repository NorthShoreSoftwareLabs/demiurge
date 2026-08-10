import { httpError, json } from "demiurge";

export const GET = json(() => {
  throw httpError(401, "Sign in to access this endpoint.", {
    headers: { "www-authenticate": 'Bearer realm="demiurge-example"' },
  });
});
