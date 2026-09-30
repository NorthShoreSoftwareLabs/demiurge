import { json } from "@demiurgejs/core";
import type { AuthenticationContext } from "../@middleware";

export const GET = json<
  { accountId: string | undefined },
  "/account",
  AuthenticationContext
>(({ context }) => ({
  accountId: context.accountId,
}));
