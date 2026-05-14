#!/usr/bin/env bash
# ============================================================
# Indian Stock Shorts AI — One-shot local setup script
# ============================================================
set -e

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
RESET="\033[0m"

info()  { echo -e "${GREEN}[✓]${RESET} $1"; }
warn()  { echo -e "${YELLOW}[!]${RESET} $1"; }
error() { echo -e "${RED}[✗]${RESET} $1"; exit 1; }
step()  { echo -e "\n${BOLD}--- $1 ---${RESET}"; }

step "Checking system dependencies"

command -v node >/dev/null 2>&1 || error "Node.js not found. Install from https://nodejs.org"
command -v npm  >/dev/null 2>&1 || error "npm not found."
command -v ffmpeg >/dev/null 2>&1 || warn "ffmpeg not found — install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)"
command -v psql >/dev/null 2>&1 || warn "PostgreSQL not found — install with: brew install postgresql (macOS)"
command -v redis-cli >/dev/null 2>&1 || warn "Redis not found — install with: brew install redis (macOS)"

info "Node $(node --version) · npm $(npm --version)"

step "Installing npm dependencies"
npm install --legacy-peer-deps

step "Setting up environment"
if [ ! -f .env.local ]; then
  cp .env.example .env.local
  warn ".env.local created from .env.example — please fill in your API keys before running"
else
  info ".env.local already exists"
fi

step "Generating Prisma client"
npm run db:generate 2>/dev/null || node_modules/.bin/prisma generate 2>/dev/null || warn "Prisma generate failed — run manually after setting DATABASE_URL"

step "Creating temp directories"
mkdir -p /tmp/stock-shorts-videos
info "Temp video directory: /tmp/stock-shorts-videos"

step "Installing Python edge-tts (free TTS fallback)"
if command -v pip3 >/dev/null 2>&1; then
  pip3 install edge-tts --quiet && info "edge-tts installed" || warn "edge-tts install failed — configure AZURE_SPEECH_KEY as fallback"
else
  warn "pip3 not found — install Python 3 for free TTS support"
fi

step "Done!"
echo ""
echo -e "  ${BOLD}Next steps:${RESET}"
echo "  1. Edit .env.local and add your API keys"
echo "  2. Start PostgreSQL:  brew services start postgresql"
echo "  3. Start Redis:       brew services start redis"
echo "  4. Create database:   createdb stock_shorts_db"
echo "  5. Push schema:       npm run db:push"
echo "  6. Start dev:         npm run dev"
echo ""
echo -e "  Open ${BOLD}http://localhost:3000${RESET} in your browser"
echo ""
