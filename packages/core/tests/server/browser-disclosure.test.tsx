import { describe, expect, it, vi } from "vitest";
import {
  createRequestHandler,
  json,
  mutation,
  MUTATION_REQUEST_HEADER,
  MUTATION_REQUEST_VALUE,
  page,
  type RouteModule,
  type RouteProps,
} from "@demiurgejs/core";
import { unstable_verifyRoutePolicySource } from "@demiurgejs/core/vite";

const NAVIGATION_HEADER = "x-demiurge-navigation";
const SECRET = "refresh-secret-9f2c41d0";
const PASSWORD_HASH = "argon2id$v=19$m=65536,t=3,p=4$0RcTvyGuqRXk1lJm";

type AccountRecord = {
  displayName: string;
  email: string;
  id: string;
  passwordHash: string;
  session: {
    internal: {
      audit: { previousToken: string };
      refreshToken: string;
    };
  };
};

type PublicAccount = { displayName: string; id: string };

function readAccountRecord(): AccountRecord {
  return {
    displayName: "Ada Lovelace",
    email: "ada@example.test",
    id: "acct-1",
    passwordHash: PASSWORD_HASH,
    session: {
      internal: {
        audit: { previousToken: SECRET },
        refreshToken: SECRET,
      },
    },
  };
}

function AccountView({ data }: RouteProps<string, PublicAccount>) {
  return <main>{data.displayName}</main>;
}

function routeModule(module: RouteModule) {
  return vi.fn(async () => module);
}

function createAccountHandler(onError = vi.fn()) {
  return createRequestHandler({
    onError,
    routes: {
      "./routes/account.tsx": routeModule({
        GET: page<"/account", AccountRecord, PublicAccount>({
          data: readAccountRecord,
          project: (record) => ({
            displayName: record.displayName,
            id: record.id,
          }),
          view: AccountView,
        }),
      }),
    },
  });
}

describe("browser disclosure boundary", () => {
  it("keeps a nested secret out of the initial document", async () => {
    const handler = createAccountHandler();

    const response = await handler(new Request("https://example.test/account"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Ada Lovelace");
    expect(html).not.toContain(SECRET);
    expect(html).not.toContain(PASSWORD_HASH);
    expect(html).not.toContain("ada@example.test");
    expect(html).not.toContain("refreshToken");
  });

  it("keeps a nested secret out of a navigation response", async () => {
    const handler = createAccountHandler();

    const response = await handler(new Request("https://example.test/account", {
      headers: { [NAVIGATION_HEADER]: "data" },
    }));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Ada Lovelace");
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain(PASSWORD_HASH);
    expect(body).not.toContain("ada@example.test");
  });

  it("sends the same projected value to the document and to navigation", async () => {
    const handler = createAccountHandler();

    const document = await (await handler(
      new Request("https://example.test/account"),
    )).text();
    const navigation = await (await handler(
      new Request("https://example.test/account", {
        headers: { [NAVIGATION_HEADER]: "data" },
      }),
    )).json();

    const serialized = document.slice(
      document.indexOf('<template id="__demiurge_data">'),
    );
    const start = serialized.indexOf(">") + 1;
    const documentData = JSON.parse(
      serialized.slice(start, serialized.indexOf("</template>")),
    );

    expect(documentData.data).toEqual({
      displayName: "Ada Lovelace",
      id: "acct-1",
    });
    expect(navigation.data).toEqual(documentData.data);
  });

  it("keeps a nested secret out of a mutation response", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/account.ts": routeModule({
          POST: mutation({
            handler: () => json(readAccountRecord()),
            project: (record: AccountRecord) => ({
              displayName: record.displayName,
              id: record.id,
            }),
          }),
        }),
      },
    });

    const response = await handler(new Request("https://example.test/account", {
      headers: { [MUTATION_REQUEST_HEADER]: MUTATION_REQUEST_VALUE },
      method: "POST",
    }));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Ada Lovelace");
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain(PASSWORD_HASH);
    expect(body).not.toContain("ada@example.test");
  });

  it("reports a page route that declares no disclosure", async () => {
    const onError = vi.fn();
    const handler = createRequestHandler({
      onError,
      routes: {
        "./routes/account.tsx": routeModule({
          // TYPE-EVIDENCE: the page helper rejects a missing declaration at compile time. The cast reproduces the runtime state of an application that ignores that type error.
          GET: {
            data: readAccountRecord,
            kind: "page",
            render: { mode: "ssr" },
            view: AccountView,
          } as never,
        }),
      },
    });

    const response = await handler(new Request("https://example.test/account"));

    expect(response.status).toBe(500);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Route /account returns page data and declares no browser disclosure. Add project to select the fields, or add publicData: true when the whole result is public.",
      }),
      { pathname: "/account", site: "page" },
    );
  });

  it("names the route and the field of a value that it cannot serialize", async () => {
    const onError = vi.fn();
    const handler = createRequestHandler({
      onError,
      routes: {
        "./routes/account.tsx": routeModule({
          GET: page({
            data: () => ({ profile: { updatedAt: new Date(0) } }),
            publicData: true,
            view: () => <main>account</main>,
          }),
        }),
      },
    });

    const response = await handler(new Request("https://example.test/account"));
    await response.text();

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "profile.updatedAt",
        message:
          "Route /account could not serialize the field profile.updatedAt for the browser. Change the projection to send a JSON value.",
        route: "/account",
      }),
      { pathname: "/account", site: "page" },
    );
    const [reported] = onError.mock.calls[0];
    expect(String(reported.message)).not.toContain("1970");
  });

  it("keeps a server error message out of a navigation error response", async () => {
    const handler = createRequestHandler({
      onError: vi.fn(),
      routes: {
        "./routes/account.tsx": routeModule({
          GET: page({
            data: () => {
              throw new Error(`Session lookup failed for ${SECRET}`);
            },
            publicData: true,
            view: AccountView,
          }),
        }),
      },
    });

    const response = await handler(new Request("https://example.test/account", {
      headers: { [NAVIGATION_HEADER]: "data" },
    }));
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain("Session lookup failed");
    expect(JSON.parse(body).error).toEqual({ title: "Internal Server Error" });
  });

  it("keeps a server error message out of a problem response", async () => {
    const handler = createRequestHandler({
      onError: vi.fn(),
      routes: {
        "./routes/account.ts": routeModule({
          GET: json(() => {
            throw new Error(`Session lookup failed for ${SECRET}`);
          }),
        }),
      },
    });

    const response = await handler(new Request("https://example.test/account", {
      headers: { accept: "application/json" },
    }));
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain("Session lookup failed");
  });

  it("reports a page route that returns data and declares nothing", async () => {
    const findings = await unstable_verifyRoutePolicySource(
      `import { page } from "@demiurgejs/core";
export const GET = page({
  data: () => ({ id: "acct-1" }),
  view: () => null,
});
`,
      "/routes/account.tsx",
    );

    expect(findings).toEqual([
      expect.objectContaining({
        code: "page-disclosure-missing",
        exportName: "GET",
        severity: "error",
      }),
    ]);
  });

  it("accepts a page route that declares the whole result as public", async () => {
    const findings = await unstable_verifyRoutePolicySource(
      `import { page } from "@demiurgejs/core";
export const GET = page({
  data: () => ({ id: "acct-1" }),
  publicData: true,
  view: () => null,
});
`,
      "/routes/account.tsx",
    );

    expect(findings).toEqual([]);
  });

  it("accepts a page route that declares a projection", async () => {
    const findings = await unstable_verifyRoutePolicySource(
      `import { page } from "@demiurgejs/core";
export const GET = page({
  data: () => ({ id: "acct-1", token: "secret" }),
  project: (record) => ({ id: record.id }),
  view: () => null,
});
`,
      "/routes/account.tsx",
    );

    expect(findings).toEqual([]);
  });
});
