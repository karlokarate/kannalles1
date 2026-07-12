# Handover: OFF Server Auth via Session Cookie Cache (2026-07-12T10:29:41Z)

```json
{
  "task": "off-server-auth-env",
  "status": "completed",
  "request": "Use OFF account only server-side and add retry.",
  "behavior": {
    "auth_mode": "server-side login session cookie",
    "login_endpoint": "https://world.openfoodfacts.org/cgi/login.pl",
    "login_params": ["user_id", "password", "remember_me", "redirect"],
    "session_reuse": "cookie cached per running gateway/server instance and reused for subsequent upstream requests",
    "retry_policy": "if a response indicates expired/invalid session, invalidate cookie, re-login once, and retry the upstream request exactly once"
  },
  "changed_files": [
    "api/_lib/gateway.js",
    "server/index.mjs",
    ".env.example",
    "README.md",
    ".codex/task-ledgers/2026-07-12_off-server-auth-env.ipynb"
  ],
  "validation": [
    { "command": "node --check api/_lib/gateway.js", "result": "pass" },
    { "command": "node --check server/index.mjs", "result": "pass" },
    { "command": "npm --prefix /workspaces/kannalles1 run typecheck", "result": "pass" }
  ],
  "notes": [
    "OFF documentation states read operations do not require authentication; authenticated session reuse is therefore optional and only applied when OFF_USERNAME/OFF_PASSWORD are configured.",
    "Session reuse is best-effort per warm instance. In serverless environments, cold starts or changed egress IPs can force a fresh login."
  ]
}
```
