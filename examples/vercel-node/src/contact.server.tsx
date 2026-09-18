import "@demiurgejs/core/server-only";
import { renderToStaticMarkup } from "react-dom/server";
import { sendWithResend } from "./resend.server";

export type ContactSubmission = {
  email: string;
  gclid?: string;
  message: string;
  name: string;
};

export type ContactEmail = {
  html: string;
  replyTo: string;
  subject: string;
};

export type ContactEmailSender = (email: ContactEmail) => Promise<{ id: string }>;

let backgroundTaskScheduler: ((promise: Promise<void>) => void) | undefined;
let emailSender: ContactEmailSender = sendWithResend;

export function setBackgroundTaskScheduler(
  schedule: ((promise: Promise<void>) => void) | undefined,
) {
  backgroundTaskScheduler = schedule;
}

export function setContactEmailSender(sender: ContactEmailSender) {
  emailSender = sender;
}

export async function sendContactEmail(submission: ContactSubmission) {
  return emailSender({
    html: renderToStaticMarkup(<ContactEmailMessage submission={submission} />),
    replyTo: submission.email,
    subject: `Contact request from ${submission.name}`,
  });
}

export function reportContactConversion(gclid: string | undefined) {
  if (!gclid || !backgroundTaskScheduler) {
    return;
  }

  backgroundTaskScheduler(reportConversion(gclid));
}

function ContactEmailMessage({ submission }: { submission: ContactSubmission }) {
  return (
    <main>
      <h1>Contact request</h1>
      <p>Name: {submission.name}</p>
      <p>Email: {submission.email}</p>
      <p>Message: {submission.message}</p>
    </main>
  );
}

async function reportConversion(gclid: string) {
  await Promise.resolve(gclid);
}
