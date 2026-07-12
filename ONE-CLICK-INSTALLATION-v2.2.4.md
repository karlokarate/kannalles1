# KH Checker v2.2.4 – One-Click-Installation

## Inhalt des Lieferpakets

```text
repo-overlay/                    direkt in den Repository-Stamm kopieren
artifacts/
  kh-checker-v2.2.4-komplett.zip
  ENTWICKLER-QUELLCODE-v2.2.4.zip
install-into-repo.sh             optionaler lokaler Installer
INSTALLATION-v2.2.4.md
VALIDATION-REPORT.md
SHA256SUMS.txt
```

## Empfohlener lokaler Weg

```bash
unzip KH-CHECKER-v2.2.4-ONE-CLICK-BUNDLE.zip
cd KH-CHECKER-v2.2.4-ONE-CLICK-BUNDLE
bash install-into-repo.sh /pfad/zu/kannalles1
```

Der Installer kopiert nur das Overlay und entfernt gezielt die drei alten konkurrierenden Workflows. Er führt **keinen** Commit und **keinen** Push aus.

## Manueller Weg

1. Inhalt von `repo-overlay/` direkt in den Stamm von `karlokarate/kannalles1` kopieren.
2. Folgende Dateien löschen, falls sie noch vorhanden sind:

```text
.github/workflows/deploy-pages.yml
.github/workflows/build-deploy-pages-v2.2.3.yml
.github/workflows/unpack-kh-checker-repo-integration.yml
```

3. Prüfen, dass unter `.github/workflows/` nur `build-deploy-pages.yml` verbleibt.
4. Änderungen normal committen und pushen.
5. GitHub **Actions** öffnen.
6. **Build, validate and deploy KH Checker v2.2.4** wählen.
7. **Run workflow** drücken. Der Workflow besitzt keine Eingaben.

## Warum kein Installationsworkflow mehr existiert

Der frühere Lauf konnte das Integrations-ZIP entpacken und committen, GitHub verweigerte aber den Push einer neuen Workflow-Datei. Der verwendete GitHub-App-Token hatte keine spezielle `workflows`-Berechtigung. v2.2.4 versucht nicht, diese Sicherheitsgrenze zu umgehen: Workflow-Dateien werden einmal direkt kopiert, danach liest und deployt der finale Workflow ausschließlich.

## Serieller Ablauf

1. Vorgebautes `releases/kh-checker-v2.2.4-komplett.zip` hart validieren.
2. Gelockte Abhängigkeiten mit `npm ci` installieren.
3. Hono/Zod → OpenAPI 3.1 erzeugen.
4. Redocly linten und Dokumentation erzeugen.
5. Orval Fetch/TypeScript/Zod/MSW/Faker erzeugen.
6. Generator-Drift, Workflowvertrag, TypeScript, Biome, Vitest, Server-/Script-Syntax, npm-Audit, Vite/PWA und Pages prüfen.
7. Playwright Chromium/WebKit für Desktop, Android, iPhone, Offline, Retry und axe versuchen.
8. Nur bei vollständigem Erfolg ein neues deterministisches Release erzeugen und auswählen.
9. Andernfalls das bereits validierte App-ZIP auswählen.
10. Finales Pages-Verzeichnis nochmals hart prüfen, hochladen und per OIDC deployen.

## Failsoft-Grenze

Registry-, Generator-, Audit-, Build- oder Browserstörungen disqualifizieren nur den Quellkandidaten. Unsichere ZIPs, Checksummenlücken, Secrets/Keys, JAR/AAR/APK, Server-/Datenbankinhalte, inkonsistente Generatornachweise, ungültige Pages-Pfade sowie Upload-/Deployfehler bleiben harte Abbrüche.

## Repository-Einstellungen

- Pages-Quelle: **GitHub Actions**.
- Environment `github-pages`: keine Required Reviewers und kein Wait Timer, wenn das Deployment ungated bleiben soll.
- Für den normalen direkten PWA-Betrieb sind keine Variablen erforderlich.
- Optional öffentlich: `VITE_DATA_GATEWAY_URL`, `VITE_AI_PARSE_URL`.
- Niemals API-Schlüssel in `VITE_*` eintragen.

## Nach dem Deploy

Die URL steht im Workflow Summary und unter **Deployments → github-pages**. Danach die Seite einmal öffnen und bei Bedarf als PWA installieren:

- iPhone/iPad: Safari → Teilen → Zum Home-Bildschirm
- Android: Chrome → App installieren
- Desktop: Installationssymbol des Browsers
