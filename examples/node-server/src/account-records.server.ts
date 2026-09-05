// Stands in for a database table. Each record holds public columns and
// columns that must stay on the server.
export type AccountRecord = {
  displayName: string;
  email: string;
  id: string;
  passwordHash: string;
  plan: string;
  session: {
    internal: {
      refreshToken: string;
    };
    lastSeenAt: string;
  };
};

const accounts: Record<string, AccountRecord> = {
  "acct-1": {
    displayName: "Ada Lovelace",
    email: "ada@example.test",
    id: "acct-1",
    passwordHash: "argon2id$v=19$m=65536,t=3,p=4$0RcTvyGuqRXk1lJm",
    plan: "team",
    session: {
      internal: {
        refreshToken: "refresh-secret-9f2c41d0",
      },
      lastSeenAt: "2026-01-04T09:15:00.000Z",
    },
  },
};

export async function readAccountRecord(id: string) {
  const record = accounts[id];

  if (!record) {
    throw new Error(`No account ${id}.`);
  }

  return record;
}
