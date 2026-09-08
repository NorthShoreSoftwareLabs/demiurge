// This module reads a full account record. The record contains fields that
// must never reach the browser, so the module carries the server-only
// marker. The Vite build fails if a browser bundle ever reaches this file.
import "@demiurgejs/core/server-only";

export type AccountRecord = {
  displayName: string;
  email: string;
  id: string;
  passwordHash: string;
};

export type PublicAccount = {
  displayName: string;
  id: string;
};

// A real application reads this record from a database. This example
// returns a fixed value to keep the route free of a database dependency.
export function readAccountRecord(id: string): AccountRecord {
  return {
    displayName: "Ada Lovelace",
    email: "ada@example.test",
    id,
    passwordHash: "argon2id$v=19$m=65536,t=3,p=4$0RcTvyGuqRXk1lJm",
  };
}
