import nodemailer from "nodemailer";

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
};

export type Mailer = {
  send(message: MailMessage): Promise<void>;
};

export function createSmtpMailer(smtpUrl: string, from: string): Mailer {
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    async send(message) {
      await transport.sendMail({ from, ...message });
    },
  };
}
