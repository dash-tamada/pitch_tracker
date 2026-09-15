/**
 * Email delivery port. Only a "log" transport is included: it records that an email *would* be sent, without the body.
 * Plug a real provider in here (SMTP relay / Amazon SES / Resend) once chosen. Email bodies never contain script,
 * synopsis or creator contact data — only a short notice and a link back into the app, where access is re-checked.
 */
export interface EmailMessage { to: string; subject: string; text: string }
export interface EmailPort { send(msg: EmailMessage): Promise<void> }

export class LogEmail implements EmailPort {
  readonly sent: { to: string; subject: string }[] = [];
  async send(msg: EmailMessage) {
    this.sent.push({ to: msg.to, subject: msg.subject });
    if (process.env.NODE_ENV !== "test") console.info(JSON.stringify({ level: "info", event: "email.logged", subject: msg.subject }));
  }
}

let transport: EmailPort | undefined;
export function getEmail(): EmailPort {
  transport ??= new LogEmail();
  return transport;
}
export function setEmailForTests(e: EmailPort) { transport = e; }
