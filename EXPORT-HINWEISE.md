# Export-Hinweise zu "homelab_dashboard"

Erzeugt: 18.10.2026, 08:03:09

Dieses Paket wurde automatisch gepackt. Was dabei passiert ist:

## Entfernt

| Was | Warum |
|---|---|
| `.env` und alle Varianten | enthielten echte Zugangsdaten. Ersatz: `.env.example` mit Platzhaltern |
| `node_modules`, `.venv`, `__pycache__` | werden auf dem Zielserver neu installiert und wären dort womöglich für die falsche Architektur gebaut |
| `.git` | Entwicklungsgeschichte gehört nicht in ein Deployment-Paket |
| Log- und Cache-Dateien | Betriebsdaten der Entwicklungsumgebung |

Konkret ausgelassen wurden:

- `.env.example`
- `node_modules`
- `.env`

## Ersetzt

Vorlage `.env.example`: aus `.env` erzeugt, 13 Schlüssel. Die Werte sind Platzhalter - **kein einziger echter Wert ist enthalten**.

`docker-compose.yml`: durch eine eigenständige Fassung ersetzt (generische Dienstnamen, eigene Datenbank, `build: .` statt Bind-Mount). Die Originalfassung liegt als `docker-compose.appfactory.yml` daneben.

## Sicherheitsprüfung

### Adressen in Dokumentation - automatisch ersetzt

In diesen Textdateien standen Adressen aus dem Ursprungsnetz. Sie wurden
durch Platzhalter ersetzt (in reiner Dokumentation ist das gefahrlos):

- `README.md` (Tailscale-Adresse (100.x.y.z))

### Adressen im Quellcode - bitte selbst prüfen

Hier wurde **nicht** eingegriffen: eine Adresse im Code blind zu ersetzen
könnte die Anwendung unbrauchbar machen. Bitte ansehen und durch eigene
Werte oder Umgebungsvariablen ersetzen:

- `public/js/views/apps.js` (Zeile 185) - AppFactory-Netzsegment 10.10.50.x
- `server/config.js` (Zeile 82, 84, 96) - AppFactory-Netzsegment 10.10.50.x, Tailscale-Adresse (100.x.y.z)

## Datenbank

Quelle: `homelab_dashboard_db`, 4 Tabellen.

| Tabelle | Im Export |
|---|---|
| `bookmarks` | nur Struktur |
| `schema_version` | nur Struktur |
| `settings` | Struktur **und** Daten (Stammdaten) |
| `users` | nur Struktur |

Die Einordnung wurde aus den Tabellennamen geschlossen (Konfigurations- und Stammdatentabellen mit wenigen Zeilen). Passt sie nicht, legen Sie im Projekt eine `appfactory-export.json` mit `{ "stammdatenTabellen": ["..."] }` an - dann gilt diese Liste.

## Erkannte Technik

Node.js (engines.node: >=18). Laufzeit-Image: `node:18-alpine`, Installation: `npm ci --omit=dev`, Start: `npm start`.

## Gewählte Export-Variante

Code + SQL + Anleitung. Das Docker-Image wird auf dem Zielserver mit
`docker compose up -d --build` gebaut, es liegt **kein** fertiges Image
im Paket. Das hält den Download klein und erzeugt ein Image, das zur
Architektur des Zielservers passt.
