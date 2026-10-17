export default function guard(request: Request): Response {
  const url = new URL(request.url);
  const headers = new Headers({ "x-proof-guard": crypto.randomUUID() });
  if (/^\/public\/(one|two)$/.test(url.pathname)) {
    const navigation = request.headers.get("x-demiurge-navigation");
    const invalid = !["GET", "HEAD"].includes(request.method) ||
      request.headers.has("cookie") || request.headers.has("authorization") ||
      (navigation !== null && navigation !== "data") ||
      [...url.searchParams.keys()].some((key) => key !== "edition") ||
      url.searchParams.getAll("edition").length > 1;
    if (invalid) {
      headers.set("cache-control", "no-store");
      return new Response("The request is ineligible for the live proof.", { status: 400, headers });
    }
  }
  headers.set("x-middleware-next", "1");
  return new Response(null, { headers });
}
