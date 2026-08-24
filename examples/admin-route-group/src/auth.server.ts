export type Principal = {
  id: string;
  name: string;
  roles: readonly string[];
};

export type Authenticate = (
  username: string,
  password: string,
) => Promise<Principal | undefined>;

// The application owns this identity-provider boundary. Replace this function
// with an adapter for the authentication library that the application uses.
export const authenticate: Authenticate = async (username, password) => {
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
