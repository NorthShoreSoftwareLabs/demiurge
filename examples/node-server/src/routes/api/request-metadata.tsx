import { json } from "@demiurge-js/core";

export const GET = json(({ request }) => ({
  destination: request.headers.get("sec-fetch-dest"),
  mode: request.headers.get("sec-fetch-mode"),
  site: request.headers.get("sec-fetch-site"),
  user: request.headers.get("sec-fetch-user"),
}));
