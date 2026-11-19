// Lee los emails que la API envía a Mailpit (docker compose) para obtener los tokens de invitación y reseteo.
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:8025";

type MailpitList = { messages: { ID: string; To: { Address: string }[] }[] };
type MailpitMessage = { Text: string };

export async function waitForTokenSentTo(email: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = (await (
      await fetch(`${MAILPIT_URL}/api/v1/messages?limit=100`)
    ).json()) as MailpitList;
    const message = list.messages.find((m) => m.To.some((t) => t.Address === email));
    if (message) {
      const detail = (await (
        await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`)
      ).json()) as MailpitMessage;
      const token = /token=([\w-]+)/.exec(detail.Text)?.[1];
      if (token) return token;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`No llegó ningún email con token a ${email}`);
}
