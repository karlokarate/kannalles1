# Handover: Retry-After + Circuit Hardening (2026-07-12T08:17:36Z)

```json
{
  "task": "retry-after-circuit-hardening",
  "status": "completed",
  "root_causes": [
    "UI did not enforce Retry-After and allowed immediate repeated upstream search retries.",
    "Vercel gateway lacked upstream circuit bypass, so repeated failures hit Search-a-licious and legacy endpoints every request."
  ],
  "changes": [
    {
      "file": "src/App.tsx",
      "summary": [
        "Added temporary search lock derived from retryAt/retryAfterMs for 429/503 conditions.",
        "Disabled both 'Suche' and 'Manuell/Berechnen' actions while lock is active and show countdown.",
        "Reduced default page_size setting from 15 to 10 to lower upstream pressure."
      ]
    },
    {
      "file": "api/_lib/gateway.js",
      "summary": [
        "Added circuit breaker state for search-a-licious and OFF legacy search.",
        "Skips temporarily unhealthy upstreams with diagnostic attempts instead of immediate retries.",
        "Adds Retry-After response header on gateway errors when retryAt is available."
      ]
    }
  ],
  "validation": [
    {
      "command": "npm --prefix /workspaces/kannalles1 run typecheck",
      "result": "pass"
    },
    {
      "command": "node --check /workspaces/kannalles1/api/_lib/gateway.js",
      "result": "pass"
    }
  ],
  "expected_effect": [
    "Fewer immediate re-hits to unstable OFF search upstreams during outage windows.",
    "Deterministic UI behavior during server-advised cooldown periods.",
    "Clearer operator telemetry through gateway_attempts including circuit bypass entries."
  ]
}
```
