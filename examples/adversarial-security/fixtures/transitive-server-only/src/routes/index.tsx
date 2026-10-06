import { page } from "@demiurgejs/core";
import { readLeakedSecret } from "../shared";

export const GET = page({ view: () => <main>{readLeakedSecret()}</main> });
