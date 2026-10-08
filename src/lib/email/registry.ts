// Event key -> renderer. The key's family decides the words; the database
// context decides every value. A dated key must match the database's own date,
// so a batch pulled on one day cannot be sent on another.

import type { EmailContext, EmailSpec, EventArgs, RenderedEmail } from "./types.ts";
import { render } from "./layout.ts";
import { lintEmail } from "./lint.ts";
import { renderedSha } from "./sha.ts";
import { holderCheckin } from "./events/holder-checkin.ts";
import { recruit } from "./events/recruit.ts";
import { reply, REPLY_KEY } from "./events/replies.ts";
import { digest } from "./events/digest.ts";
import { status, STATUS_SUBJECT } from "./events/status.ts";
import { gameDay, GAME_DAY_KEY } from "./events/game-day.ts";
import { gameList, GAME_LIST_KEY } from "./events/game-list.ts";
import { answer, ANSWER_KEY } from "./events/answer.ts";
import { POOL_SUBJECT } from "./copy.ts";
import { broadcastEnvelope, perRecipientEnvelope, type Envelope, type OwnerAddress } from "./envelope.ts";

type Renderer = (ctx: EmailContext, args: EventArgs) => EmailSpec;

interface Family {
  name: string;
  match: RegExp;
  /** Group 1 of match is a YYYY-MM-DD that must equal common.as_of_et. */
  dated: boolean;
  /** One body to many in Bcc, with every owner on To. Everything else is per-recipient. */
  broadcast: boolean;
  render: Renderer;
}

export const FAMILIES: Family[] = [
  { name: "holder_checkin", match: /^holder_checkin_(\d{4}-\d{2}-\d{2})$/, dated: true, broadcast: false, render: holderCheckin },
  { name: "recruit", match: /^recruit_(\d{4}-\d{2}-\d{2})$/, dated: true, broadcast: false, render: recruit },
  { name: "reply", match: REPLY_KEY, dated: false, broadcast: false, render: reply },
  { name: "digest", match: /^digest_(\d{4}-\d{2}-\d{2})$/, dated: true, broadcast: false, render: digest },
  { name: "status", match: /^status_[a-z0-9_-]+$/, dated: false, broadcast: false, render: status },
  { name: "game_day", match: GAME_DAY_KEY, dated: false, broadcast: true, render: gameDay },
  { name: "game_list", match: GAME_LIST_KEY, dated: false, broadcast: false, render: gameList },
  { name: "answer", match: ANSWER_KEY, dated: false, broadcast: false, render: answer },
];

/** Families that answer one inbound message; the key ends in that message's Gmail id. */
export const REPLY_TO_MESSAGE = /^(?:game_list|answer)_([0-9a-f]+)$/;

/** The fixed start of every subject this module writes. The sweep skips mail whose subject begins with one. */
export const SUBJECT_STEMS = [POOL_SUBJECT, "TNF DIGEST", STATUS_SUBJECT] as const;

export function familyOf(eventKey: string): Family {
  const f = FAMILIES.find((x) => x.match.test(eventKey));
  if (!f) throw new Error(`no email event "${eventKey}"; known: ${FAMILIES.map((x) => x.name).join(", ")}`);
  return f;
}

export interface Rendered {
  spec: EmailSpec;
  email: RenderedEmail;
  sha: string;
  problems: string[];
}

export function renderEvent(ctx: EmailContext, args: EventArgs = {}): Rendered {
  const f = familyOf(ctx.event_key);
  if (f.dated) {
    const day = f.match.exec(ctx.event_key)?.[1];
    if (day !== ctx.common.as_of_et) {
      throw new Error(`${ctx.event_key}: the database date is ${ctx.common.as_of_et}; a dated event renders only on its own day`);
    }
  }
  const spec = f.render(ctx, args);
  const email = render(spec);
  return { spec, email, sha: renderedSha(email), problems: lintEmail(email) };
}

/**
 * The envelope for an event: a broadcast gets every owner on To and the
 * derived list, minus To, in Bcc; a per-recipient event gets its one
 * recipient and nothing else, whatever owners are passed.
 */
export function envelopeFor(
  eventKey: string,
  opts: { adminEmail: string; recipient?: string; owners?: OwnerAddress[]; derived?: string[] },
): Envelope {
  const f = familyOf(eventKey);
  if (f.broadcast) {
    if (!opts.owners) throw new Error(`${eventKey} is a broadcast: it needs the owners table export (--owners)`);
    return broadcastEnvelope(opts.owners, opts.adminEmail, opts.derived ?? []);
  }
  return perRecipientEnvelope(opts.recipient ?? "");
}
