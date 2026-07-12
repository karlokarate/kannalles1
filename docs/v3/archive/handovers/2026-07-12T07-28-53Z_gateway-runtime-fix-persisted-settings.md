# Handover: Gateway Runtime Fix for Persisted Settings (2026-07-12T07:28:53Z)

```json
{
  "task": "gateway-runtime-fix-persisted-settings",
  "status": "completed",
  "root_cause": "Persisted app settings with empty dataGatewayUrl overrode the valid build default from VITE_DATA_GATEWAY_URL",
  "fix": "sanitizeSettings now falls back to DEFAULT_SETTINGS.dataGatewayUrl when persisted dataGatewayUrl is empty/whitespace",
  "changed_files": [
    "src/App.tsx"
  ],
  "validation": [
    {
      "command": "npm --prefix /workspaces/kannalles1 run typecheck",
      "result": "pass"
    }
  ],
  "user_visible_outcome": "App uses configured gateway URL again even on devices/browsers with old empty settings saved from previous runs"
}
```
