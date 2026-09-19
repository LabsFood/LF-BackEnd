#!/usr/bin/env node
// PreToolUse guard: catches denied patterns anywhere in a Bash command
// (the settings.json deny list only matches prefixes, so `echo x && rm -rf /`
// slips past it). Exit 2 blocks the tool call.
const BLOCKED = [
  /\brm\s+-rf\b/,
  /\bgit\s+push\s+(--force|-f)\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-f\b/,
  /\bsudo\b/,
  /\bchmod\s+777\b/,
  /\bssh\b/,
  />\s*\/dev\/(?!null\b|zero\b|random\b|urandom\b|stdout\b|stderr\b|tty\b|fd\/)/,
];

let data = '';
process.stdin.on('data', (c) => (data += c));
process.stdin.on('end', () => {
  let cmd = '';
  try {
    cmd = JSON.parse(data).tool_input?.command || '';
  } catch {
    process.exit(0);
  }
  if (BLOCKED.some((re) => re.test(cmd))) {
    console.error('Blocked by bash-guard hook: command matches a denied pattern.');
    process.exit(2);
  }
  process.exit(0);
});
