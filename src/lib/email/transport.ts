// The only code in the repo that talks to Gmail. It sends and drafts through
// the Gmail API as Anthony's own mailbox, from the OAuth token in the
// environment (GMAIL_OAUTH_TOKEN_JSON, GMAIL_OAUTH_CLIENT_ID,
// GMAIL_OAUTH_CLIENT_SECRET), and refuses to do anything until the mailbox
// it is connected to is ADMIN_EMAIL. Nothing here prints a token.

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailEnv {
  tokenJson: string | undefined;
  clientId: string | undefined;
  clientSecret: string | undefined;
  adminEmail: string;
}

export function gmailEnvFromProcess(adminEmail: string): GmailEnv {
  return {
    tokenJson: process.env.GMAIL_OAUTH_TOKEN_JSON,
    clientId: process.env.GMAIL_OAUTH_CLIENT_ID,
    clientSecret: process.env.GMAIL_OAUTH_CLIENT_SECRET,
    adminEmail,
  };
}

function b64url(raw: Buffer): string {
  return raw.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function failure(what: string, r: Response): Promise<Error> {
  let detail = "";
  try {
    const j = (await r.json()) as { error?: { message?: string } | string; error_description?: string };
    detail = typeof j.error === "string" ? `${j.error} ${j.error_description ?? ""}` : (j.error?.message ?? "");
  } catch {
    /* no body */
  }
  return new Error(`gmail ${what}: HTTP ${r.status} ${detail}`.trim());
}

async function accessToken(env: GmailEnv): Promise<string> {
  if (!env.tokenJson) throw new Error("gmail: GMAIL_OAUTH_TOKEN_JSON is not set; nothing can be sent from here");
  const tok = JSON.parse(env.tokenJson) as { access_token?: string; refresh_token?: string; expiry_date?: number };
  if (tok.access_token && tok.expiry_date && tok.expiry_date - 120_000 > Date.now()) return tok.access_token;
  if (!tok.refresh_token || !env.clientId || !env.clientSecret) {
    throw new Error("gmail: the token has expired and no refresh credentials are set");
  }
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: env.clientId,
      client_secret: env.clientSecret,
      refresh_token: tok.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw await failure("token refresh", r);
  const j = (await r.json()) as { access_token?: string };
  if (!j.access_token) throw new Error("gmail: token refresh returned no access token");
  return j.access_token;
}

export class Gmail {
  private readonly token: string;
  readonly mailbox: string;

  private constructor(token: string, mailbox: string) {
    this.token = token;
    this.mailbox = mailbox;
  }

  /** Connect, and refuse unless the mailbox is ADMIN_EMAIL. */
  static async connect(env: GmailEnv): Promise<Gmail> {
    const token = await accessToken(env);
    const r = await fetch(`${API}/profile`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw await failure("profile", r);
    const p = (await r.json()) as { emailAddress?: string };
    const mailbox = (p.emailAddress ?? "").toLowerCase();
    if (mailbox !== env.adminEmail.toLowerCase()) {
      throw new Error("gmail: the token is not for ADMIN_EMAIL's mailbox; refusing to send as anyone else");
    }
    return new Gmail(token, mailbox);
  }

  private async post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const r = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw await failure(path, r);
    return (await r.json()) as Record<string, unknown>;
  }

  async send(raw: Buffer, threadId?: string): Promise<{ id: string; threadId: string }> {
    const j = await this.post("/messages/send", { raw: b64url(raw), ...(threadId ? { threadId } : {}) });
    if (typeof j.id !== "string") throw new Error("gmail send: no message id in the response");
    return { id: j.id, threadId: String(j.threadId ?? "") };
  }

  async createDraft(raw: Buffer, threadId?: string): Promise<{ draftId: string; messageId: string }> {
    const j = await this.post("/drafts", { message: { raw: b64url(raw), ...(threadId ? { threadId } : {}) } });
    const msg = (j.message ?? {}) as { id?: string };
    if (typeof j.id !== "string" || !msg.id) throw new Error("gmail draft: no draft id in the response");
    return { draftId: j.id, messageId: msg.id };
  }

  /**
   * The id of a message already in Sent to this address carrying this event
   * key in its X-TNF-Event header, or null. The last guard against a second
   * copy: it holds even when a claim id is reused or the ledger write after
   * an accepted send was lost.
   */
  async sentWithEvent(to: string, eventKey: string): Promise<string | null> {
    const q = encodeURIComponent(`in:sent to:${to}`);
    const r = await fetch(`${API}/messages?q=${q}&maxResults=100`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!r.ok) throw await failure("search sent", r);
    const j = (await r.json()) as { messages?: { id: string }[] };
    for (const m of j.messages ?? []) {
      const h = await fetch(
        `${API}/messages/${encodeURIComponent(m.id)}?format=metadata&metadataHeaders=X-TNF-Event`,
        { headers: { Authorization: `Bearer ${this.token}` } },
      );
      if (!h.ok) throw await failure("sent headers", h);
      const mj = (await h.json()) as { payload?: { headers?: { name: string; value: string }[] } };
      const ev = mj.payload?.headers?.find((x) => x.name.toLowerCase() === "x-tnf-event")?.value;
      if (ev === eventKey) return m.id;
    }
    return null;
  }

  /** The message as sent, for reading back. */
  async getRaw(id: string): Promise<Buffer> {
    const r = await fetch(`${API}/messages/${encodeURIComponent(id)}?format=raw`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!r.ok) throw await failure("get", r);
    const j = (await r.json()) as { raw?: string };
    if (!j.raw) throw new Error("gmail get: no raw body");
    return Buffer.from(j.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  }
}
