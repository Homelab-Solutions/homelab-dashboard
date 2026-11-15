# homelab_dashboard - Installation auf einem eigenen Server

Dieses Paket wurde am 18.10.2026, 08:03:09 erzeugt und enthält alles,
was zum Betrieb auf einem beliebigen Server nötig ist. Es enthält **keine**
Zugangsdaten und keine Adressen aus der Umgebung, in der das Projekt
entwickelt wurde.

---

## 1. Voraussetzungen

**Erkannte Technik:** Node.js (engines.node: >=18)

Es gibt zwei Wege. Der erste ist deutlich kürzer.

### Weg A - mit Docker (empfohlen)

- Docker Engine 24 oder neuer
- Docker Compose v2 (`docker compose version`)

Sonst nichts. Laufzeitumgebung und Datenbank bringt das Paket mit.

### Weg B - ohne Docker, direkt auf dem Server

- Node.js 18 oder neuer, dazu npm
- MariaDB 10.6+ oder MySQL 8+
- Systempakete: keine (das Node-Image bringt alles mit)

---

## 2. Code entpacken

```bash
unzip homelab_dashboard.zip
cd homelab_dashboard
```

---

## 3. Konfiguration anlegen

```bash
cp .env.example .env
```

Dann `.env` öffnen und ausfüllen. **Zwingend selbst zu setzen:**

| Schlüssel | Was dort hinein muss |
|---|---|
| `DB_HOST` | Zugangsdaten **Ihrer** Datenbank. Bei Weg A: `DB_HOST=db`, den Rest frei wählen. |
| `DB_PORT` | Zugangsdaten **Ihrer** Datenbank. Bei Weg A: `DB_HOST=db`, den Rest frei wählen. |
| `DB_USER` | Zugangsdaten **Ihrer** Datenbank. Bei Weg A: `DB_HOST=db`, den Rest frei wählen. |
| `DB_PASSWORD` | Zugangsdaten **Ihrer** Datenbank. Bei Weg A: `DB_HOST=db`, den Rest frei wählen. |
| `DB_NAME` | Zugangsdaten **Ihrer** Datenbank. Bei Weg A: `DB_HOST=db`, den Rest frei wählen. |
| `DB_ROOT_PASSWORD` | Nur bei Weg A: Root-Passwort des mitgelieferten Datenbank-Containers. Frei wählen. |

**Geheimnisse - bitte neu erzeugen, nicht erraten:**

- `DB_PASSWORD`
- `SESSION_SECRET`
- `ADMIN_PASSWORD`

Ein brauchbares Zufallsgeheimnis erzeugt zum Beispiel:

```bash
openssl rand -base64 32
```

**Ihre eigene Adresse bzw. Domain:**

- `HOST`

---

## 4. Datenbank

Die Datei **`datenbank.sql`** enthält die Struktur aller 4 Tabellen.
Zusätzlich sind die Stammdaten dieser Tabellen enthalten: `settings`.

Nutzdaten und Testdaten aus der Entwicklung sind **nicht** enthalten. Das ist Absicht.

### Bei Weg A (Docker)

Nichts zu tun. Der Datenbank-Container spielt `datenbank.sql` beim **ersten**
Start selbst ein (`/docker-entrypoint-initdb.d`). Wichtig: das passiert nur
beim ersten Start mit leerem Volume. Soll später neu eingespielt werden:

```bash
docker compose down -v      # ACHTUNG: löscht die Datenbank-Daten
docker compose up -d --build
```

### Bei Weg B (eigene Datenbank)

```bash
# 1. Datenbank und Benutzer anlegen (Namen frei wählbar, müssen zur .env passen)
sudo mysql -e "CREATE DATABASE app_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "CREATE USER 'app_user'@'localhost' IDENTIFIED BY 'IHR_PASSWORT';"
sudo mysql -e "GRANT ALL PRIVILEGES ON app_db.* TO 'app_user'@'localhost'; FLUSH PRIVILEGES;"

# 2. Struktur und Stammdaten einspielen
mysql -u app_user -p app_db < datenbank.sql
```

---

## 5. Anwendung starten

### Weg A - Docker

```bash
docker compose up -d --build
```

Danach läuft die Anwendung auf **http://IHR-SERVER:3002**.

Den Port auf dem Server ändern Sie über `APP_PORT` in der `.env` - der Port
im Container bleibt davon unberührt.

```bash
docker compose logs -f app     # mitlesen
docker compose ps              # Zustand
docker compose down            # anhalten
```

### Weg B - ohne Docker

```bash
npm ci --omit=dev
npm start
```

Für den Dauerbetrieb einen Prozessmanager verwenden, damit die Anwendung
einen Neustart des Servers übersteht:

```bash
npm install -g pm2
pm2 start npm --name homelab_dashboard -- start
pm2 save && pm2 startup
```

---

## 6. Absicherung (empfohlen)

Die Anwendung spricht HTTP und bringt keine Verschlüsselung mit. Für einen
Betrieb, der aus dem Internet erreichbar ist:

1. **Reverse Proxy mit HTTPS davorschalten** (nginx, Caddy oder Traefik).
   Caddy holt sich das Zertifikat von selbst:

   ```
   ihre-domain.example {
       reverse_proxy localhost:3002
   }
   ```

2. **Den Anwendungsport nicht nach außen öffnen.** In der Firewall nur 80/443
   freigeben, nicht 3002. Bei Weg A hilft dafür in der `docker-compose.yml`:
   `- "127.0.0.1:${APP_PORT:-3002}:3002"`.
3. **Den Datenbank-Port gar nicht veröffentlichen.** Das mitgelieferte
   `docker-compose.yml` tut das bereits nicht - die Datenbank ist nur im
   internen Compose-Netz erreichbar.
4. **Sicherungen einrichten.** Für die Datenbank z. B.
   `docker compose exec db mariadb-dump -u root -p<PASSWORT> <DB> > sicherung.sql`.

---

## 7. Was dieses Paket enthält

| Datei | Bedeutung |
|---|---|
| `INSTALL.md` | diese Anleitung |
| `EXPORT-HINWEISE.md` | was beim Packen bereinigt wurde, und was noch zu prüfen ist |
| `.env.example` | Vorlage für Ihre `.env` - enthält keine echten Werte |
| `datenbank.sql` | Tabellenstruktur und Stammdaten |
| `docker-compose.yml` | eigenständige Fassung für Weg A |
| `Dockerfile` | aus dem Projekt übernommen |
| `docker-compose.appfactory.yml` | Originalfassung, **nur zum Nachsehen** - nicht für einen fremden Server geeignet |

---

## 8. Wenn etwas nicht läuft

| Symptom | Wahrscheinliche Ursache |
|---|---|
| `docker compose up` bricht mit „DB_PASSWORD fehlt" ab | `.env` nicht angelegt oder Wert leer (Schritt 3) |
| Anwendung startet, antwortet aber nicht | falscher Port in der `.env`, oder die Anwendung lauscht auf `127.0.0.1` statt `0.0.0.0` |
| Fehler „Access denied for user" | `DB_USER`/`DB_PASSWORD` in der `.env` passen nicht zu den Werten des `db`-Dienstes |
| Tabellen fehlen | `datenbank.sql` wurde nicht eingespielt. Bei Weg A passiert das nur beim ersten Start mit leerem Volume (Schritt 4) |
