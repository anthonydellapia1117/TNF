#!/usr/bin/env python3
"""
TNF iMessage relay. Runs on Anthony's Mac, nowhere else.

Turns an iMessage he types or dictates into the self-addressed email that the
hourly TNF Sweep reads. He is never at a keyboard for this: he texts

    UPDATE TNF: Colavita claim
    ACTION: claim
    NAME: Mike Colavita
    COUNT: 1

and the change lands in the pool within the hour.

WHAT IT DOES
  1. Reads new messages HE SENT (is_from_me = 1) from ~/Library/Messages/chat.db,
     read-only and immutable, so his Messages database is never locked or written.
  2. Keeps only messages whose first line begins UPDATE TNF:, DECISION TNF: or
     NOTE TNF: (case-insensitive on the prefix, the rest verbatim).
  3. First line becomes the subject, the rest becomes the body, VERBATIM. The
     relay never edits, normalises or completes a body. docs/INTAKE_GRAMMAR.md is
     validated by the sweep and by nothing else, so there is one validator, not two.
  4. Writes each one to the outbox directory as a .txt, and in send mode delivers
     it through Mail.app to Anthony and only Anthony.
  5. Records the message ROWID so nothing is ever relayed twice.

WHAT IT WILL NOT DO
  - Send to any address other than ANTHONY. The address is a constant here and
    the send path refuses anything else, so a bad flag cannot mail a participant.
  - Read a conversation. It only ever selects messages where is_from_me = 1.
  - Write to chat.db. The connection is opened mode=ro&immutable=1.
  - Touch the pool database, move money, or decide anything. It is a courier.
  - Read, mention or relay anything to do with the Survivor pool.

USAGE
  python3 tnf-imessage-relay.py                     # dry run, prints what it found
  python3 tnf-imessage-relay.py --mode draft        # write .txt files to the outbox
  python3 tnf-imessage-relay.py --mode send-self    # Mail.app to Anthony only
  python3 tnf-imessage-relay.py --since-hours 48    # widen the first-run window
  python3 tnf-imessage-relay.py --self-chat-only    # only his note-to-self thread

  A DRAFT DOES NOT CLOSE THE LOOP. The sweep reads unread mail in Pool-TNF, and a
  file on disk is not mail. Draft mode is for watching it work. Once the subjects
  look right, run it with --mode send-self, which mails him and only him.

PERMISSIONS, both granted by hand once, in System Settings
  1. Full Disk Access, REQUIRED, or chat.db cannot be opened at all:
     System Settings > Privacy & Security > Full Disk Access > + > add the program
     that runs this script (Terminal, or iTerm, or /usr/bin/python3 itself if it
     runs from launchd). Toggle it on. Quit and reopen that program.
     Without it this script exits 3 and says so.
  2. Automation, send mode only:
     System Settings > Privacy & Security > Automation > (that same program) >
     tick Mail. macOS asks the first time; if it was ever refused, this is where
     it is turned back on. Without it this script exits 4 and says so.
"""

import argparse
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

# The only address this relay will ever mail. Not a flag, not an argument.
ANTHONY = "anthonydellapia@gmail.com"

CHAT_DB = os.path.expanduser("~/Library/Messages/chat.db")
STATE = os.path.expanduser("~/.tnf-imessage-relay.json")
OUTBOX = os.path.expanduser("~/tnf-relay-outbox")

# The subject prefixes from docs/INTAKE_GRAMMAR.md. The colon is part of it.
PREFIX = re.compile(r"^\s*(UPDATE|DECISION|NOTE)\s+TNF:", re.IGNORECASE)

# Apple stores message.date as nanoseconds since 2001-01-01 UTC.
APPLE_EPOCH = datetime(2001, 1, 1, tzinfo=timezone.utc)

EXIT_OK, EXIT_NOTHING, EXIT_USAGE, EXIT_NO_DISK, EXIT_NO_AUTOMATION = 0, 0, 2, 3, 4


def die(code, msg):
    print(f"tnf-relay: {msg}", file=sys.stderr)
    sys.exit(code)


def load_state():
    try:
        with open(STATE) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def save_state(state):
    tmp = STATE + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(state, fh, indent=1)
    os.replace(tmp, STATE)


def apple_ns(dt):
    return int((dt - APPLE_EPOCH).total_seconds() * 1_000_000_000)


def open_db():
    if not os.path.exists(CHAT_DB):
        die(EXIT_NO_DISK, f"{CHAT_DB} not found. This script runs on macOS only.")
    try:
        # mode=ro only. sqlite cannot write, will not create a -wal and will not
        # lock, so his Messages database is never modified by this.
        #
        # immutable=1 was here and is deliberately gone. It PROMISES sqlite that
        # nothing else will change the file, which lets it skip the current WAL -
        # and Messages is running, writing that WAL, the whole time. A minute-by-
        # minute relay would have read a stale snapshot and silently missed the
        # newest messages, which are the only ones it exists to carry.
        return sqlite3.connect(f"file:{CHAT_DB}?mode=ro", uri=True)
    except sqlite3.OperationalError as exc:
        die(
            EXIT_NO_DISK,
            "cannot open chat.db: "
            f"{exc}\n"
            "  Grant Full Disk Access: System Settings > Privacy & Security >\n"
            "  Full Disk Access > + > add the program running this script, then\n"
            "  quit and reopen it.",
        )


def fetch(conn, since_ns, last_rowid, self_handles):
    """His own outgoing messages, newest last, after the watermark.

    self_handles: when non-empty, restrict to the note-to-self thread.

    The first version of this filter accepted any handle that appeared in at
    least one chat, which is every handle there is - so --self-chat-only let
    through outgoing TNF-prefixed messages from ordinary one-to-one threads,
    because in those chat_identifier is the CORRESPONDENT's handle and the
    subquery matched it. A message he typed to somebody else could be relayed
    as an instruction to himself. The filter has to name his own handle.
    """
    where = ["m.is_from_me = 1", "m.date > ?", "m.ROWID > ?"]
    args = [since_ns, last_rowid]
    if self_handles:
        marks = ",".join("?" for _ in self_handles)
        # Two conditions, and both are load-bearing. The chat must be
        # identified by one of HIS OWN handles, which a one-to-one chat with
        # anyone else is not; and nobody else may be a participant on it,
        # which rules out a group chat that happens to carry his handle.
        where.append(
            f"c.chat_identifier IN ({marks}) AND NOT EXISTS ("
            "  SELECT 1 FROM chat_handle_join chj"
            "  JOIN handle h ON h.ROWID = chj.handle_id"
            f" WHERE chj.chat_id = c.ROWID AND h.id NOT IN ({marks})"
            ")"
        )
        args.extend(self_handles)
        args.extend(self_handles)
    sql = f"""
        SELECT m.ROWID, m.date, COALESCE(m.text, ''), COALESCE(c.chat_identifier, '')
        FROM message m
        LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
        LEFT JOIN chat c ON c.ROWID = cmj.chat_id
        WHERE {" AND ".join(where)}
        ORDER BY m.ROWID ASC
    """
    return conn.execute(sql, args).fetchall()


def split(text):
    """First line is the subject, the rest is the body.

    Leading and trailing whitespace comes off both, and nothing else does:
    no case fixing, no collapsing, no reflowing. That is exactly what rule 9
    of docs/INTAKE_GRAMMAR.md allows ("no trimming beyond the leading and
    trailing space"), so a KEY: VALUE line reaches the sweep as typed. The
    docstring used to claim "verbatim, both", which was not true of a value
    with trailing space and invited the reader to assume more than it does.
    """
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    subject = lines[0].strip()
    body = "\n".join(lines[1:]).strip()
    return subject, body


def lint(subject, body):
    """
    Console warnings only. NEVER changes the message. The sweep is the single
    validator (docs/INTAKE_GRAMMAR.md); this only tells the operator early that
    a message will come back as an unparsed_intake queue row.
    """
    notes = []
    actions = [l for l in body.split("\n") if l.strip().upper().startswith("ACTION:")]
    if not actions:
        notes.append("no ACTION: line, the sweep will stage this as unparsed_intake")
    if len(actions) > 1:
        notes.append(f"{len(actions)} ACTION: lines, one action per message")
    if subject.upper().startswith("UPDATE TNF:") and any(
        a.split(":", 1)[1].strip().lower() in {"payment", "owner", "release", "refund", "queue", "identity"}
        for a in actions
        if ":" in a
    ):
        notes.append("money or identity action under UPDATE TNF:, needs DECISION TNF:")
    for line in body.split("\n"):
        if line.strip() and ":" not in line:
            notes.append(f"not a KEY: VALUE line: {line.strip()!r}")
    return notes


def write_outbox(subject, body, rowid, when):
    os.makedirs(OUTBOX, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", subject)[:60].strip("-") or "message"
    path = os.path.join(OUTBOX, f"{when:%Y%m%dT%H%M%S}-{rowid}-{safe}.txt")
    with open(path, "w") as fh:
        fh.write(f"To: {ANTHONY}\nFrom: {ANTHONY}\nSubject: {subject}\n\n{body}\n")
    return path


def send_self(subject, body):
    """
    Mail.app, to ANTHONY and nobody else. The recipient is not interpolated
    from anything the message said, so no body can redirect it.
    """
    script = """
    on run {theSubject, theBody, theTo}
      tell application "Mail"
        set m to make new outgoing message with properties {subject:theSubject, content:theBody, visible:false}
        tell m to make new to recipient at end of to recipients with properties {address:theTo}
        send m
      end tell
    end run
    """
    proc = subprocess.run(
        ["osascript", "-e", script, subject, body, ANTHONY],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        err = (proc.stderr or "").strip()
        if "-1743" in err or "not authorized" in err.lower() or "1743" in err:
            die(
                EXIT_NO_AUTOMATION,
                "Mail.app refused automation: "
                f"{err}\n"
                "  Grant it: System Settings > Privacy & Security > Automation >\n"
                "  (the program running this script) > tick Mail.",
            )
        die(EXIT_NO_AUTOMATION, f"osascript failed: {err}")


def main():
    ap = argparse.ArgumentParser(description="Relay TNF-prefixed iMessages to a self-addressed email.")
    ap.add_argument("--mode", choices=["dry-run", "draft", "send-self"], default="dry-run")
    ap.add_argument("--since-hours", type=float, default=6.0,
                    help="on a first run with no watermark, look back this far (default 6)")
    ap.add_argument("--self-chat-only", action="store_true",
                    help="only the note-to-self thread, not every thread he types in")
    ap.add_argument("--self-handle", action="append", default=[], metavar="HANDLE",
                    help="a handle of his own, as Messages stores it (an Apple ID or a "
                         "phone number in +1XXXXXXXXXX form). Repeatable. Defaults to "
                         f"{ANTHONY}. Pass his number here at run time rather than "
                         "committing it - the repo is public.")
    args = ap.parse_args()

    # --self-chat-only is only meaningful against a known handle. Without one
    # the filter cannot tell his note-to-self thread from any other thread, and
    # silently relaying everything is the failure this guard exists to stop.
    self_handles = []
    if args.self_chat_only:
        self_handles = args.self_handle or [ANTHONY]

    if sys.platform != "darwin":
        die(EXIT_NO_DISK, f"macOS only, this is {sys.platform}. Run it on the Mac.")

    state = load_state()
    last_rowid = int(state.get("last_rowid", 0))
    since = datetime.now(timezone.utc) - timedelta(hours=args.since_hours)
    since_ns = apple_ns(since) if last_rowid == 0 else 0

    conn = open_db()
    try:
        rows = fetch(conn, since_ns, last_rowid, self_handles)
    except sqlite3.DatabaseError as exc:
        die(EXIT_NO_DISK, f"chat.db read failed: {exc}")
    finally:
        conn.close()

    # The watermark is persisted after EACH row, not once at the end.
    #
    # send-self calls osascript per message and die()s on the first refusal.
    # With a single post-loop save, a run that sent four messages and then hit
    # a refusal on the fifth exited having recorded none of them, so the next
    # run re-sent all four. Each copy reaches the sweep as a new Gmail message
    # with its own id, so source-message deduplication downstream cannot see
    # they are the same iMessage - four duplicate queue items, or four repeated
    # intake actions against the pool. Sending twice is the expensive failure
    # here; skipping a row we already handled is not.
    def advance(rowid):
        nonlocal high
        if rowid <= high:
            return
        high = rowid
        state["last_rowid"] = high
        state["last_run"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        if args.mode != "dry-run":
            save_state(state)

    relayed, high = 0, last_rowid
    for rowid, date_ns, text, chat in rows:
        if not text or not PREFIX.match(text):
            advance(rowid)  # handled: it is not ours, and never will be
            continue
        subject, body = split(text)
        when = APPLE_EPOCH + timedelta(seconds=date_ns / 1_000_000_000)
        print(f"\n[{rowid}] {when:%Y-%m-%d %H:%M} in {chat or 'unknown thread'}")
        print(f"  Subject: {subject}")
        print("  Body:")
        for line in body.split("\n"):
            print(f"    {line}")
        for note in lint(subject, body):
            print(f"  lint: {note}")
        if args.mode == "draft":
            print(f"  wrote {write_outbox(subject, body, rowid, when)}")
        elif args.mode == "send-self":
            send_self(subject, body)
            print(f"  sent to {ANTHONY}")
        # Only now, once the send or the draft actually succeeded. send_self
        # die()s on failure, so reaching this line means this row is done.
        advance(rowid)
        relayed += 1

    if high > last_rowid and args.mode == "dry-run":
        print(f"\ndry run, watermark NOT advanced (would be {high})")

    if relayed == 0:
        print("nothing to relay")
    else:
        print(f"\n{relayed} message(s) {'relayed' if args.mode == 'send-self' else 'found'}")
        if args.mode == "draft":
            print("draft mode: these are files, not mail. The sweep will not see them.")
    sys.exit(EXIT_OK)


if __name__ == "__main__":
    main()
