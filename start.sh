#!/usr/bin/env bash
cd "$(dirname "$0")"

echo "============================================================"
echo "  Pokorní z Příbora - Spouštím lokální server..."
echo "  Veřejný web:      http://localhost:3000"
echo "  CMS Administrace: http://localhost:3000/admin.html"
echo "  Výchozí heslo:    pribor1756"
echo "============================================================"
echo ""

if command -v xdg-open >/dev/null 2>&1; then
  (sleep 1 && xdg-open "http://localhost:3000") &
fi

node server.js
