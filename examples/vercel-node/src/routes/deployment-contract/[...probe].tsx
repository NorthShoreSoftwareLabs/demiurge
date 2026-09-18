import { getRequestClientAddress, response } from "@demiurgejs/core";

const cancellationStates = new Map<string, string>();

export const GET = response(({ request, url }) => {
  if (url.pathname.endsWith("/request-url-probe")) {
    return Response.json({ pathname: url.pathname, search: url.search });
  }

  if (url.pathname.endsWith("/client-address")) {
    return Response.json({
      address: getRequestClientAddress(request) ?? "unknown",
    });
  }

  if (url.pathname.endsWith("/repeated-headers")) {
    const headers = new Headers();
    headers.append("set-cookie", "vercel-contract-a=one; Path=/; HttpOnly");
    headers.append("set-cookie", "vercel-contract-b=two; Path=/; HttpOnly");
    return new Response(null, { headers });
  }

  if (url.pathname.endsWith("/streaming")) {
    return new Response(createTimedStream(request.signal));
  }

  if (url.pathname.endsWith("/cancellation-state")) {
    const id = url.searchParams.get("id") ?? "missing";
    return Response.json({ state: cancellationStates.get(id) ?? "missing" });
  }

  if (url.pathname.endsWith("/cancellation")) {
    const id = url.searchParams.get("id") ?? "missing";
    return new Response(createCancellationStream(request.signal, id));
  }

  return new Response("Unknown deployment contract probe.", { status: 404 });
});

function createTimedStream(signal: AbortSignal) {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of ["chunk one ", "chunk two ", "chunk three"]) {
        if (signal.aborted) {
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode(chunk));
        await new Promise((resolve) => setTimeout(resolve, 15));
      }

      controller.close();
    },
  });
}

function createCancellationStream(signal: AbortSignal, id: string) {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | undefined;

  return new ReadableStream<Uint8Array>({
    cancel() {
      if (timer) clearTimeout(timer);
      if (cancellationStates.get(id) === "active") {
        cancellationStates.set(id, "body-cancelled");
      }
    },
    start(controller) {
      cancellationStates.set(id, "active");
      controller.enqueue(encoder.encode("started"));

      const enqueue = () => {
        if (signal.aborted) return;
        controller.enqueue(encoder.encode(" waiting"));
        timer = setTimeout(enqueue, 25);
      };

      signal.addEventListener("abort", () => {
        if (timer) clearTimeout(timer);
        cancellationStates.set(id, "aborted");
      }, { once: true });
      timer = setTimeout(enqueue, 25);
    },
  });
}
