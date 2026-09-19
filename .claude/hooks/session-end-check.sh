#!/bin/bash
# ponytail: informational only (always exits 0) — flags likely secret patterns
# in the uncommitted diff at session end so they don't slip into a commit.
cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0
diff=$(git diff HEAD 2>/dev/null)
if echo "$diff" | grep -qE '(sk_live_|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z]+ PRIVATE KEY-----|ghp_[A-Za-z0-9]{36})'; then
  echo "session-end-check: possible secret pattern found in uncommitted diff — review before committing." >&2
fi
exit 0
