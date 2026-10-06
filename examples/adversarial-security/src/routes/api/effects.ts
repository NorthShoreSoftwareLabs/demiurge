import { json } from "@demiurgejs/core";
import { readAcceptedBodyCount } from "../../effects";

export const GET = json(() => ({ acceptedBodies: readAcceptedBodyCount() }));
