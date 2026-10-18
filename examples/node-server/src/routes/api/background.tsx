import { response } from "@demiurgejs/core";

export const POST = response(({ background }) => {
  if (!background) {
    return Response.json({ accepted: false }, { status: 503 });
  }

  background.run(() => {
    console.info("Application background task completed.");
  });

  return Response.json({ accepted: true }, { status: 202 });
});
