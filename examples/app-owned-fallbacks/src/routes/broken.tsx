import { page } from "@demiurge/core";
import type { ReactNode } from "react";

export const GET = page({ view: BrokenPage });

function BrokenPage(): ReactNode {
  throw new Error("Deliberate root render secret.");
}
