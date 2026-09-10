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
        # Read-only and immutable: sqlite will not create a -wal, will not lock,
        # and cannot write. His Messages database is never modified by this.
        return sqlite3.connect(f"file:{CHAT_DB}?mode=ro&immutable=1", uri=True)
    except sqlite3.OperationalError as exc:
        die(
            EXIT_NO_DISK,
            "cannot open chat.db: "
            f"{exc}\n"
            "  Grant Full Disk Access: System Settings > Privacy & Security >\n"
            "  Full Disk Access > + > add the program running this script, then\n"
            "  quit and reopen it.",
        )


def fetch(conn, since_ns, last_rowid, self_chat_only):
    """His own outgoing messages, newest last, after the watermark."""
    where = ["m.is_from_me = 1", "m.date > ?", "m.ROWID > ?"]
    args = [since_ns, last_rowid]
    if self_chat_only:
        # The note-to-self thread: the only handle on the chat is his own.
        where.append(
            "c.chat_identifier IN ("
            "  SELECT h.id FROM handle h"
            "  JOIN chat_handle_join chj ON chj.handle_id = h.ROWID"
            "  GROUP BY h.id HAVING COUNT(DISTINCT chj.chat_id) > 0"
            ")"
        )
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
    """First line is the subject, the rest is the body. Verbatim, both."""
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
    args = ap.parse_args()

    if sys.platform != "darwin":
        die(EXIT_NO_DISK, f"macOS only, this is {sys.platform}. Run it on the Mac.")

    state = load_state()
    last_rowid = int(state.get("last_rowid", 0))
    since = datetime.now(timezone.utc) - timedelta(hours=args.since_hours)
    since_ns = apple_ns(since) if last_rowid == 0 else 0

    conn = open_db()
    try:
        rows = fetch(conn, since_ns, last_rowid, args.self_chat_only)
    except sqlite3.DatabaseError as exc:
        die(EXIT_NO_DISK, f"chat.db read failed: {exc}")
    finally:
        conn.close()

    relayed, high = 0, last_rowid
    for rowid, date_ns, text, chat in rows:
        high = max(high, rowid)
        if not text or not PREFIX.match(text):
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
        relayed += 1

    if high > last_rowid:
        state["last_rowid"] = high
        state["last_run"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        if args.mode != "dry-run":
            save_state(state)
        else:
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
