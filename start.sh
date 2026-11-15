#!/usr/bin/env bash
cd "$(dirname "$0")"

echo "============================================================"
echo "  Pokorní z Příbora - Spouštím lokální server..."
echo "  Veřejný web:      http://localhost:3000"
echo "  CMS Administrace: http://localhost:3000/admin.html"
echo "  Výchozí heslo:    pribor1756"
echo "============================================================"
echo ""

# Ukončit případnou starší instanci server.js běžící na pozadí
if pgrep -f "node server.js" >/dev/null 2>&1; then
  echo "[INFO] Ukončuji předchozí běžící instanci serveru (node server.js)..."
  pkill -f "node server.js" 2>/dev/null || true
  sleep 0.5
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[INFO] Node.js nebyl nalezen. Pokouším se nainstalovat Node.js..."
  if command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y nodejs
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update && sudo apt-get install -y nodejs
  elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -Sy --noconfirm nodejs
  elif command -v brew >/dev/null 2>&1; then
    brew install node
  else
    echo "[CHYBA] Nepodařilo se automaticky nainstalovat Node.js. Nainstalujte jej prosím z https://nodejs.org/"
    exit 1
  fi
fi

if command -v xdg-open >/dev/null 2>&1; then
  (sleep 1 && xdg-open "http://localhost:3000") &
fi

node server.js
