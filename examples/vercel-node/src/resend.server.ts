import "@demiurgejs/core/server-only";
import { Resend } from "resend";
import type { ContactEmail, ContactEmailSender } from "./contact.server";

export const sendWithResend: ContactEmailSender = async (email: ContactEmail) => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.CONTACT_EMAIL_FROM;
  const to = process.env.CONTACT_EMAIL_TO;

  if (!apiKey || !from || !to) {
    throw new Error("RESEND_API_KEY, CONTACT_EMAIL_FROM, and CONTACT_EMAIL_TO are required.");
  }

  const result = await new Resend(apiKey).emails.send({
    from,
    html: email.html,
    replyTo: email.replyTo,
    subject: email.subject,
    to,
  });

  if (result.error || !result.data?.id) {
    throw new Error("Resend could not accept the contact email.");
  }

  return { id: result.data.id };
};
