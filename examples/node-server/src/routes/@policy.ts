import { security } from "demiurge";

export const policy = {
  document: security.strict(),
};
