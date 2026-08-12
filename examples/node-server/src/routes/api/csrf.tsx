import { issueCsrfToken, response } from "@demiurgejs/core";

export const GET = response(() => {
  const issued = issueCsrfToken();

  return new Response(JSON.stringify({ token: issued.token }), {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "set-cookie": issued.cookie,
    },
  });
});
