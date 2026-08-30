import { security } from "@demiurgejs/core";

export const policy = {
  document: security.static({}),
};
