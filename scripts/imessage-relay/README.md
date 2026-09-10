# iMessage relay

Anthony texts or dictates a change, the pool applies it within the hour. He is
never at a keyboard.

```
he types in Messages  ->  this script  ->  self-addressed email  ->  TNF Sweep  ->  pool
```

The relay is a courier and nothing else. It never validates, never edits a body,
never touches the pool database, never moves money and never mails anyone but
Anthony. `docs/INTAKE_GRAMMAR.md` is the contract and the sweep is its only
validator, so there is one validator and not two that can drift.

## Where it runs

**On the Mac, and only on the Mac.** `~/Library/Messages/chat.db` exists nowhere
else. On any other platform the script exits 3 and says so. It has therefore
never been run against a real `chat.db`; it is shipped tested for syntax and for
its platform guard, not for a live read.

## Install

Grant Full Disk Access to the program that will run it (Terminal, iTerm, or
`/usr/bin/python3` under launchd).

```
System Settings > Privacy & Security > Full Disk Access > + > Terminal
```

Quit and reopen Terminal afterwards. You should see: `python3 -c "import sqlite3,os;
sqlite3.connect('file:'+os.path.expanduser('~/Library/Messages/chat.db')+'?mode=ro',uri=True)"`
return with no error.

## Run it

Dry run first. Nothing is written, nothing is sent, the watermark does not move.

```
python3 scripts/imessage-relay/tnf-imessage-relay.py --since-hours 24
```

You should see each `UPDATE TNF:` / `DECISION TNF:` / `NOTE TNF:` message he sent
in the last day, split into the subject it will carry and the body it will send,
with any lint warnings under it.

Then close the loop. This mails him, and the address is a constant in the script,
so no flag and no message body can send it anywhere else.

```
python3 scripts/imessage-relay/tnf-imessage-relay.py --mode send-self
```

You should see `sent to anthonydellapia@gmail.com` under each message, and the
mail arrive in his inbox within a minute. `--mode draft` writes `.txt` files to
`~/tnf-relay-outbox` instead; those are files, not mail, and the sweep will not
see them, so draft mode leaves the watermark alone and a later `--mode send-self`
still picks the same messages up. Only `--mode send-self` moves it, and it moves
it one message at a time as each send succeeds, so a refusal part-way through
never re-sends what already went.

Mail must have an account that sends as that address. The sweep only honours a
`DECISION TNF:` whose From and To are both his Gmail, and Mail otherwise sends
from whatever account is default: the relay would look like it worked while the
sweep correctly refused every decision. The script checks, and exits 5 without
sending if no account matches.

The first send-mode run asks for Automation permission. If it was ever refused:

```
System Settings > Privacy & Security > Automation > Terminal > tick Mail
```

## Keep it running

Every minute, quietly, from login.

```
mkdir -p ~/Library/LaunchAgents && cat > ~/Library/LaunchAgents/com.tnf.imessage-relay.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.tnf.imessage-relay</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/python3</string>
    <string>REPO/scripts/imessage-relay/tnf-imessage-relay.py</string>
    <string>--mode</string><string>send-self</string>
  </array>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/tmp/tnf-relay.log</string>
  <key>StandardErrorPath</key><string>/tmp/tnf-relay.err</string>
</dict></plist>
PLIST
launchctl load ~/Library/LaunchAgents/com.tnf.imessage-relay.plist
```

Replace `REPO` with the checkout path first. Under launchd the Full Disk Access
grant must be on `/usr/bin/python3` itself, not on Terminal. You should see
`tail -f /tmp/tnf-relay.log` print `nothing to relay` once a minute.

## Exit codes

| Code | Means |
|------|-------|
| 0 | ran, whether or not anything was relayed |
| 2 | bad arguments |
| 3 | `chat.db` unreadable: Full Disk Access, or not macOS |
| 4 | Mail.app refused: Automation permission |

## State

`~/.tnf-imessage-relay.json` holds the last relayed message ROWID. Nothing is
ever relayed twice. Delete it to replay from `--since-hours`; a dry run never
advances it.
