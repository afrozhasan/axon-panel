#!/usr/bin/env bash
# ==============================================================================
# Axon Panel — Uninstaller Utility
# https://github.com/afrozhasan/axon-panel
# ==============================================================================

set -euo pipefail

BOLD=$'\033[1m'
CYAN=$'\033[1;36m'
GREEN=$'\033[1;32m'
YELLOW=$'\033[1;33m'
RED=$'\033[1;31m'
NC=$'\033[0m'

log()  { printf '\n%b==>%b %s\n' "$CYAN" "$NC" "$*"; }
info() { printf '    %b•%b %s\n' "$CYAN" "$NC" "$*"; }
ok()   { printf '%b  ✓%b %s\n' "$GREEN" "$NC" "$*"; }
warn() { printf '%b warn:%b %s\n' "$YELLOW" "$NC" "$*"; }
fail() { printf '%berror:%b %s\n' "$RED" "$NC" "$*" >&2; exit 1; }

PURGE=0
NON_INTERACTIVE=0
KEEP_BACKUPS=1
INSTALL_DIR="/opt/axon-panel"
CONFIG_DIR="/etc/axon-panel"
LOG_DIR="/var/log/axon-panel"
SERVICE_NAME="axon-panel"

usage() {
  cat <<EOF
${BOLD}Axon Panel Uninstallation Utility${NC}

Usage:
  sudo ./uninstall.sh [options]

Options:
  --purge          Completely remove application code, configuration, logs, and database
  --dir <path>     Application installation directory (default: ${INSTALL_DIR})
  --yes, -y        Non-interactive execution; do not prompt for confirmation
  -h, --help       Show this help message and exit

Safety Notice:
  By default, all backups in /var/backups/axon-panel are preserved.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge) PURGE=1; shift ;;
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    -y|--yes) NON_INTERACTIVE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown option: $1 (run with --help)" ;;
  esac
done

[[ $EUID -eq 0 ]] || fail "The uninstaller must be run as root. Run: sudo ./uninstall.sh"

printf '\n%b' "$RED"
cat <<'EOF'
    ___                             ____                       __
   /   |  _  ______  ____          / __ \____ _____  ___  / /
  / /| | | |/_/ __ \/ __ \ ______ / /_/ / __ `/ __ \/ _ \/ / 
 / ___ |_>  </ /_/ / / / /_____// ____/ /_/ / / / /  __/ /  
/_/  |_/_/|_|\____/_/ /_/      /_/    \__,_/_/ /_/\___/_/   
EOF
printf '%b\n' "$NC"
printf '  %bAxon Panel System Uninstaller%b\n\n' "$BOLD" "$NC"

if [[ $NON_INTERACTIVE -eq 0 ]]; then
  echo "This tool will remove the Axon Panel service, Nginx configuration, and cron tasks."
  if [[ $PURGE -eq 1 ]]; then
    warn "PURGE MODE ENABLED: Application directories (${INSTALL_DIR}, ${CONFIG_DIR}) will be PERMANENTLY deleted."
  fi
  read -r -p "Are you sure you want to proceed with uninstallation? [y/N]: " CONFIRM
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    info "Uninstallation cancelled by user."
    exit 0
  fi
fi

# 1. Automatic pre-uninstall safety backup
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_DIR}/backup.sh" ]]; then
  log "Creating pre-uninstallation safety backup..."
  bash "${SCRIPT_DIR}/backup.sh" --backup || warn "Safety backup step completed with warnings."
fi

# 2. Stop and disable systemd service
log "Stopping and disabling systemd service (${SERVICE_NAME})..."
if systemctl is-active --quiet "$SERVICE_NAME"; then
  systemctl stop "$SERVICE_NAME"
fi
systemctl disable "$SERVICE_NAME" >/dev/null 2>&1 || true

rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
ok "Service ${SERVICE_NAME} disabled and unit file removed."

# 3. Clean up Nginx configuration
log "Removing Nginx reverse proxy configuration..."
NGINX_CHANGED=0
if [[ -f "/etc/nginx/sites-enabled/${SERVICE_NAME}" ]]; then
  rm -f "/etc/nginx/sites-enabled/${SERVICE_NAME}"
  NGINX_CHANGED=1
fi
if [[ -f "/etc/nginx/sites-available/${SERVICE_NAME}" ]]; then
  rm -f "/etc/nginx/sites-available/${SERVICE_NAME}"
  NGINX_CHANGED=1
fi
if [[ -f "/etc/nginx/snippets/${SERVICE_NAME}-allowlist.conf" ]]; then
  rm -f "/etc/nginx/snippets/${SERVICE_NAME}-allowlist.conf"
fi

if [[ $NGINX_CHANGED -eq 1 ]] && command -v nginx >/dev/null 2>&1; then
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx
    ok "Nginx reloaded cleanly."
  else
    warn "Nginx syntax error detected after site removal. Check with: nginx -t"
  fi
fi

# 4. Remove cron alerts
if [[ -f "/etc/cron.d/axon-server-alerts" ]]; then
  log "Removing server alerts cron job..."
  rm -f "/etc/cron.d/axon-server-alerts"
  ok "Cron job removed."
fi

# 5. Handle application files and purge
if [[ $PURGE -eq 1 ]]; then
  log "Purging application files, configuration, and logs..."
  if [[ -d "$INSTALL_DIR" ]]; then
    rm -rf "$INSTALL_DIR"
    ok "Removed application code: ${INSTALL_DIR}"
  fi
  if [[ -d "$CONFIG_DIR" ]]; then
    rm -rf "$CONFIG_DIR"
    ok "Removed configuration directory: ${CONFIG_DIR}"
  fi
  if [[ -d "$LOG_DIR" ]]; then
    rm -rf "$LOG_DIR"
    ok "Removed logs: ${LOG_DIR}"
  fi

  # Optionally remove dedicated user
  if id -u axonpanel >/dev/null 2>&1; then
    userdel axonpanel >/dev/null 2>&1 || true
    ok "Removed dedicated system user: axonpanel"
  fi
else
  info "Preserving application directory: ${INSTALL_DIR}"
  info "Preserving configuration & database: ${CONFIG_DIR}"
  info "Preserving log files: ${LOG_DIR}"
  info "Run with --purge to delete these directories."
fi

if [[ $KEEP_BACKUPS -eq 1 ]]; then
  info "Backups remain safely preserved in: /var/backups/axon-panel"
fi

printf '\n%b' "$GREEN"
echo "────────────────────────────────────────────────────────────────────────────"
echo "  ✓ Axon Panel has been successfully uninstalled."
echo "────────────────────────────────────────────────────────────────────────────"
printf '%b\n\n' "$NC"
