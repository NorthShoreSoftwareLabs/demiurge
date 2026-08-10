import { httpError, page } from "demiurge";
import type { ReactNode } from "react";

export const GET = page({ view: BrokenProjectPage });

function BrokenProjectPage(): ReactNode {
  throw httpError(503, "Deliberate project render failure.");
}
