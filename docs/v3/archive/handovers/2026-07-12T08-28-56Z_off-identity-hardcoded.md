# Handover: OFF Identity Hardcoded (2026-07-12T08:28:56Z)

```json
{
  "task": "off-identity-hardcoded",
  "status": "completed",
  "request": "Hardcode OFF User-Agent and OFF contact email.",
  "hardcoded_values": {
    "off_contact_email": "chrisfischtopher@googlemail.com",
    "off_user_agent_pattern": "KH-Checker/<APP_VERSION> (+https://karlokarate.github.io/kannalles1/; contact: chrisfischtopher@googlemail.com)"
  },
  "changed_files": [
    "api/_lib/gateway.js",
    "server/index.mjs",
    ".env.example"
  ],
  "behavior": [
    "Gateway now always sends User-Agent and From headers to OFF upstreams using hardcoded identity.",
    "Local server path now also always sends User-Agent and From headers.",
    "Environment variables OFF_USER_AGENT/OFF_CONTACT_EMAIL are documented as currently unused due to hardcoding."
  ],
  "validation": [
    {
      "command": "node --check /workspaces/kannalles1/api/_lib/gateway.js",
      "result": "pass"
    },
    {
      "command": "node --check /workspaces/kannalles1/server/index.mjs",
      "result": "pass"
    },
    {
      "command": "npm --prefix /workspaces/kannalles1 run typecheck",
      "result": "pass"
    }
  ]
}
```
