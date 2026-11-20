// Lee los emails que la API envía a Mailpit (docker compose) para obtener los tokens de invitación y reseteo.
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:8025";

type MailpitList = { messages: { ID: string; Subject: string; To: { Address: string }[] }[] };

function matchesSubject(message: { Subject: string }, subject?: string): boolean {
  return subject === undefined || message.Subject.includes(subject);
}
type MailpitMessage = { Text: string };

export async function waitForTokenSentTo(
  email: string,
  options: { subject?: string; timeoutMs?: number } = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = (await (
      await fetch(`${MAILPIT_URL}/api/v1/messages?limit=100`)
    ).json()) as MailpitList;
    const message = list.messages.find(
      (m) => m.To.some((t) => t.Address === email) && matchesSubject(m, options.subject),
    );
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

// Todos los tokens enviados a un email, del más nuevo al más viejo (sirve para probar que un enlace anterior ya no vale).
export async function tokensSentTo(email: string): Promise<string[]> {
  const list = (await (
    await fetch(`${MAILPIT_URL}/api/v1/messages?limit=100`)
  ).json()) as MailpitList;
  const tokens: string[] = [];
  for (const message of list.messages.filter((m) => m.To.some((t) => t.Address === email))) {
    const detail = (await (
      await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`)
    ).json()) as MailpitMessage;
    const token = /token=([\w-]+)/.exec(detail.Text)?.[1];
    if (token) tokens.push(token);
  }
  return tokens;
}
