import { describe, expect, it, vi } from "vitest";
import {
  createRequestHandler,
  json,
  mutation,
  MUTATION_REQUEST_HEADER,
  MUTATION_REQUEST_VALUE,
  page,
  RouteSerializationError,
  type RouteModule,
  type RouteProps,
} from "@demiurgejs/core";

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

function AccountView({ data }: RouteProps<string, AccountRecord>) {
  return <main>{data.displayName}</main>;
}

function PublicAccountView({ data }: RouteProps<string, PublicAccount>) {
  return <main>{data.displayName}</main>;
}

function routeModule(module: RouteModule) {
  return vi.fn(async () => module);
}

describe("page data is the browser payload", () => {
  it("sends every field of a returned record to the initial document", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/account.tsx": routeModule({
          GET: page({ data: readAccountRecord, view: AccountView }),
        }),
      },
    });

    const response = await handler(new Request("https://example.test/account"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Ada Lovelace");
    // A page data function that returns a full record sends every field of
    // that record. This case documents the contract. It does not test a
    // defect.
    expect(html).toContain(SECRET);
    expect(html).toContain(PASSWORD_HASH);
    expect(html).toContain("ada@example.test");
  });

  it("sends only a narrowed result when the data function returns one", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/account.tsx": routeModule({
          GET: page({
            data: () => {
              const record = readAccountRecord();
              return { displayName: record.displayName, id: record.id };
            },
            view: PublicAccountView,
          }),
        }),
      },
    });

    const response = await handler(new Request("https://example.test/account"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Ada Lovelace");
    expect(html).not.toContain(SECRET);
    expect(html).not.toContain(PASSWORD_HASH);
    expect(html).not.toContain("ada@example.test");
  });

  it("sends the same value to the initial document and to a navigation response", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/account.tsx": routeModule({
          GET: page({
            data: () => {
              const record = readAccountRecord();
              return { displayName: record.displayName, id: record.id };
            },
            view: PublicAccountView,
          }),
        }),
      },
    });

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

  it("sends every field of a mutation result that returns a full record", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/account.ts": routeModule({
          POST: mutation({ handler: () => json(readAccountRecord()) }),
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
    expect(body).toContain(SECRET);
    expect(body).toContain(PASSWORD_HASH);
  });

  it("sends only a narrowed mutation result when the handler returns one", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/account.ts": routeModule({
          POST: mutation({
            handler: () => {
              const record = readAccountRecord();
              return json({ displayName: record.displayName, id: record.id });
            },
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
  });

  it("names the route and the field of a page value that it cannot serialize", async () => {
    const onError = vi.fn();
    const handler = createRequestHandler({
      onError,
      routes: {
        "./routes/account.tsx": routeModule({
          GET: page({
            data: () => ({ profile: { size: 1n } }),
            view: () => <main>account</main>,
          }),
        }),
      },
    });

    const response = await handler(new Request("https://example.test/account"));
    await response.text();

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "profile.size",
        route: "/account",
      }),
      { pathname: "/account", site: "page" },
    );
    const [reported] = onError.mock.calls[0];
    expect(reported).toBeInstanceOf(RouteSerializationError);
    expect(String(reported.message)).not.toContain("1n");
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
});
