import { json } from "demiurge";

export const GET = json(({ pathname }) => ({
  ok: true,
  pathname,
}), {
  cors: {
    origins: "*",
  },
});
