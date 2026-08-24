export type Principal = {
  id: string;
  name: string;
  roles: readonly string[];
};

export type Authenticate = (request: Request) => Promise<Principal | undefined>;

// The application owns this identity-provider boundary. Replace this function
// with an adapter for the authentication library that the application uses.
export const authenticate: Authenticate = async (request) => {
  const form = await request.formData();
  const username = String(form.get("username") ?? "");
  const password = String(form.get("password") ?? "");

  if (username !== "operator" || password !== "demiurge-demo") {
    return undefined;
  }

  return {
    id: "user-1",
    name: "Demo operator",
    roles: ["admin"],
  };
};

export function canManageSettings(principal: Principal) {
  return principal.roles.includes("admin");
}
