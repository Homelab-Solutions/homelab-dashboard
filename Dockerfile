# Eigenstaendiges Image fuer den Dauerbetrieb (z.B. unRaid).
# Enthaelt keine Zugangsdaten - diese kommen zur Laufzeit aus Umgebungsvariablen (.env bzw. Template-Variablen).
# Build-Kontext: .dockerignore (Positivliste: nur package*.json, server, public).
FROM node:22-alpine

# Vorgesehenes Ziel (Konto aus den AppFactory-Einstellungen, Repository-Name = Projekt-Slug); bei anderem Ziel anpassen.
LABEL org.opencontainers.image.source="https://github.com/homelabappfactory/homelab-dashboard"

WORKDIR /app

# Reproduzierbar: Lockfile ist Pflicht (npm ci), nur Laufzeit-Abhaengigkeiten
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# Anwendungscode
COPY server ./server
COPY public ./public

ENV NODE_ENV=production \
    PORT=3002 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data

# Die Anwendung schreibt ausschliesslich unter DATA_DIR (Datei-Storage dashboard.json, Session-Secret, temporaere Dateien dort).
# Nicht-Root: der Datenordner gehoert dem Benutzer "node" (uid 1000). Ein eingehaengtes Host-Verzeichnis (./data) muss ihm gehoeren,
# siehe README "Betrieb als Container".
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]

EXPOSE 3002

# Unauthentifizierter Health-Endpunkt der Anwendung (liefert nur ok, Storage-Modus, Version, Laufzeit)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3002)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
