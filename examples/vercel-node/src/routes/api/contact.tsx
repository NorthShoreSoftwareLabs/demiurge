import { response } from "@demiurgejs/core";
import {
  reportContactConversion,
  sendContactEmail,
  type ContactSubmission,
} from "../../contact.server";

export const POST = response(async ({ request }) => {
  const submission = await readSubmission(request);

  if (submission instanceof Response) {
    return submission;
  }

  try {
    const delivery = await sendContactEmail(submission);
    reportContactConversion(submission.gclid);
    return Response.json({ deliveryId: delivery.id, success: true });
  } catch {
    return Response.json(
      { error: "The contact request could not be delivered." },
      { status: 502 },
    );
  }
}, {
  security: {
    request: {
      allowedMethods: ["POST"],
      maxBodySize: "8kb",
    },
  },
});

async function readSubmission(request: Request): Promise<ContactSubmission | Response> {
  let value: unknown;

  try {
    value = await request.json();
  } catch {
    return Response.json({ error: "Send a JSON request body." }, { status: 400 });
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Response.json({ error: "Send a contact request object." }, { status: 422 });
  }

  // TYPE-EVIDENCE: The guard above rejects null, arrays, and non-object values. The value can now be read by field name.
  const input = value as Record<string, unknown>;
  const name = cleanString(input.name);
  const email = cleanString(input.email);
  const message = cleanString(input.message);
  const gclid = cleanString(input.gclid);

  if (name.length < 2 || !email.includes("@") || message.length < 10) {
    return Response.json(
      { error: "Name, email, and message are required." },
      { status: 422 },
    );
  }

  return {
    email,
    ...(gclid ? { gclid } : {}),
    message,
    name,
  };
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
