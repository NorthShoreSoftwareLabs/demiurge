import { httpError, page } from "@demiurgejs/core";
import type { ReactNode } from "react";

export const GET = page({ view: Broken });

function Broken(): ReactNode {
  throw httpError(503, "Deliberate Vercel example failure.");
}
