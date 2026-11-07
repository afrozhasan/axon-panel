#!/usr/bin/env bash
# ==============================================================================
# Axon Panel — Backup & Restoration Engine
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

BACKUP_DEST="/var/backups/axon-panel"
CONFIG_DIR="/etc/axon-panel"
SERVICE_NAME="axon-panel"

# Backwards compatibility auto-detection
if [[ ! -d "$CONFIG_DIR" && -d "/etc/axonpanel" ]]; then
  CONFIG_DIR="/etc/axonpanel"
elif [[ ! -d "$CONFIG_DIR" && -d "/etc/webpanel" ]]; then
  CONFIG_DIR="/etc/webpanel"
fi

if ! systemctl list-unit-files 2>/dev/null | grep -q "^axon-panel.service"; then
  if systemctl list-unit-files 2>/dev/null | grep -q "^axonpanel.service"; then
    SERVICE_NAME="axonpanel"
  elif systemctl list-unit-files 2>/dev/null | grep -q "^webpanel.service"; then
    SERVICE_NAME="webpanel"
  fi
fi

ACTION="backup"
RESTORE_FILE=""

usage() {
  cat <<EOF
${BOLD}Axon Panel Backup & Restoration Utility${NC}

Usage:
  ./backup.sh [action] [options]

Actions:
  --backup              Create an atomic timestamped backup archive (default)
  --restore <archive>   Safely restore database and configuration from backup
  --list                List available backup snapshots in ${BACKUP_DEST}

Options:
  --dest <dir>          Destination directory for backups (default: ${BACKUP_DEST})
  --config-dir <dir>    Configuration directory (default: ${CONFIG_DIR})
  --service <s>         Systemd service name (default: ${SERVICE_NAME})
  -h, --help            Show this help message and exit

Examples:
  ./backup.sh
  ./backup.sh --restore /var/backups/axon-panel/axon-backup-20261107_120000.tar.gz
  ./backup.sh --list
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup) ACTION="backup"; shift ;;
    --restore) ACTION="restore"; RESTORE_FILE="${2:-}"; shift 2 ;;
    --list) ACTION="list"; shift ;;
    --dest) BACKUP_DEST="$2"; shift 2 ;;
    --config-dir) CONFIG_DIR="$2"; shift 2 ;;
    --service) SERVICE_NAME="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown option: $1 (run with --help)" ;;
  esac
done

[[ $EUID -eq 0 ]] || fail "The backup tool must be run as root. Run: sudo ./backup.sh"

case "$ACTION" in
  list)
    printf '\n%b=== Available Axon Panel Backups in %s ===%b\n\n' "$CYAN" "$BACKUP_DEST" "$NC"
    if [[ ! -d "$BACKUP_DEST" ]]; then
      info "No backup directory exists yet."
      exit 0
    fi
    count=0
    for f in "$BACKUP_DEST"/axon-backup-*.tar.gz; do
      [[ -e "$f" ]] || continue
      count=$((count + 1))
      size=$(du -h "$f" | cut -f1)
      mtime=$(date -r "$f" "+%Y-%m-%d %H:%M:%S")
      printf '  %b•%b %-50s  [%s, %s]\n' "$CYAN" "$NC" "$(basename "$f")" "$size" "$mtime"
    done
    if [[ $count -eq 0 ]]; then
      info "No backup archives found."
    else
      printf '\nTotal backups: %d\n\n' "$count"
    fi
    exit 0
    ;;

  backup)
    log "Initiating atomic backup of Axon Panel configuration and state..."
    mkdir -p "$BACKUP_DEST"
    chmod 0700 "$BACKUP_DEST"

    TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
    TEMP_DIR=$(mktemp -d "/tmp/axon-backup-${TIMESTAMP}-XXXXXX")
    chmod 0700 "$TEMP_DIR"

    # Trap cleanup of temp dir on unexpected termination
    trap 'rm -rf "${TEMP_DIR}"' EXIT

    ARCHIVE_NAME="axon-backup-${TIMESTAMP}.tar.gz"
    ARCHIVE_PATH="${BACKUP_DEST}/${ARCHIVE_NAME}"

    mkdir -p "${TEMP_DIR}/config"

    # 1. Back up configuration files
    if [[ -d "$CONFIG_DIR" ]]; then
      info "Copying runtime configuration from: ${CONFIG_DIR}"
      cp -a "${CONFIG_DIR}"/. "${TEMP_DIR}/config/"
    else
      warn "Configuration directory ${CONFIG_DIR} does not exist."
    fi

    # 2. Safely back up SQLite WAL database
    DB_SOURCE="${CONFIG_DIR}/axon.db"
    if [[ -f "$DB_SOURCE" ]]; then
      info "Safely creating point-in-time database snapshot..."
      if command -v sqlite3 >/dev/null 2>&1; then
        sqlite3 "$DB_SOURCE" ".backup '${TEMP_DIR}/config/axon.db'"
      else
        cp -p "$DB_SOURCE" "${TEMP_DIR}/config/axon.db"
        [[ -f "${DB_SOURCE}-wal" ]] && cp -p "${DB_SOURCE}-wal" "${TEMP_DIR}/config/axon.db-wal"
        [[ -f "${DB_SOURCE}-shm" ]] && cp -p "${DB_SOURCE}-shm" "${TEMP_DIR}/config/axon.db-shm"
      fi
      ok "Database snapshot completed."
    fi

    # 3. Back up cron definition
    if [[ -f "/etc/cron.d/axon-server-alerts" ]]; then
      info "Backing up server alert cron configuration..."
      cp -p "/etc/cron.d/axon-server-alerts" "${TEMP_DIR}/axon-server-alerts.cron"
    fi

    # 4. Save metadata
    cat > "${TEMP_DIR}/metadata.json" <<EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "configDir": "${CONFIG_DIR}",
  "serviceName": "${SERVICE_NAME}",
  "hostname": "$(hostname)",
  "arch": "$(uname -m)",
  "os": "$(cat /etc/issue.net 2>/dev/null || echo "Linux")"
}
EOF

    # 5. Compress into tar.gz
    info "Packaging compressed archive..."
    tar -czf "$ARCHIVE_PATH" -C "$TEMP_DIR" .
    chmod 0600 "$ARCHIVE_PATH"

    # 6. Generate SHA256 checksum
    (cd "$BACKUP_DEST" && sha256sum "$ARCHIVE_NAME" > "${ARCHIVE_NAME}.sha256")

    rm -rf "$TEMP_DIR"
    trap - EXIT

    ARCHIVE_SIZE=$(du -h "$ARCHIVE_PATH" | cut -f1)
    ok "Backup completed successfully!"
    printf '\n  Archive:    %s (%s)\n' "$ARCHIVE_PATH" "$ARCHIVE_SIZE"
    printf '  Checksum:   %s.sha256\n\n' "$ARCHIVE_PATH"
    ;;

  restore)
    [[ -n "$RESTORE_FILE" ]] || fail "Specify a backup archive to restore with --restore <path>"
    [[ -f "$RESTORE_FILE" ]] || fail "Backup archive file not found: ${RESTORE_FILE}"

    log "Verifying archive integrity for: ${RESTORE_FILE}..."
    if ! tar -tzf "$RESTORE_FILE" >/dev/null 2>&1; then
      fail "The specified file is not a valid gzip tar archive."
    fi

    CHECKSUM_FILE="${RESTORE_FILE}.sha256"
    if [[ -f "$CHECKSUM_FILE" ]]; then
      info "Validating SHA256 checksum..."
      ARCHIVE_DIR="$(dirname "$RESTORE_FILE")"
      ARCHIVE_BASE="$(basename "$RESTORE_FILE")"
      if (cd "$ARCHIVE_DIR" && sha256sum -c "${ARCHIVE_BASE}.sha256" >/dev/null 2>&1); then
        ok "Checksum validation passed."
      else
        warn "Checksum file exists but validation failed! Proceeding with caution..."
      fi
    fi

    RESTORE_TEMP=$(mktemp -d "/tmp/axon-restore-XXXXXX")
    trap 'rm -rf "${RESTORE_TEMP}"' EXIT
    tar -xzf "$RESTORE_FILE" -C "$RESTORE_TEMP"

    log "Stopping service ${SERVICE_NAME} during restoration..."
    systemctl stop "$SERVICE_NAME" || true

    mkdir -p "$CONFIG_DIR"
    chmod 0700 "$CONFIG_DIR"

    if [[ -d "${RESTORE_TEMP}/config" ]]; then
      info "Restoring configuration and database to ${CONFIG_DIR}..."
      cp -a "${RESTORE_TEMP}/config"/. "${CONFIG_DIR}/"
      chmod -R 0600 "${CONFIG_DIR}"/* 2>/dev/null || true
      chmod 0700 "$CONFIG_DIR"
      ok "Configuration and database restored."
    fi

    if [[ -f "${RESTORE_TEMP}/axon-server-alerts.cron" ]]; then
      info "Restoring server alerts cron..."
      cp -p "${RESTORE_TEMP}/axon-server-alerts.cron" "/etc/cron.d/axon-server-alerts"
      chmod 0644 "/etc/cron.d/axon-server-alerts"
      ok "Cron job restored."
    fi

    rm -rf "$RESTORE_TEMP"
    trap - EXIT

    log "Starting service ${SERVICE_NAME}..."
    systemctl daemon-reload
    systemctl start "$SERVICE_NAME"

    sleep 1.5

    if systemctl is-active --quiet "$SERVICE_NAME"; then
      ok "Service is active and healthy."
    else
      fail "Service failed to start after restoration. Check logs: journalctl -u ${SERVICE_NAME} -n 50"
    fi

    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [[ -f "${SCRIPT_DIR}/health-check.sh" ]]; then
      info "Running post-restoration health check..."
      bash "${SCRIPT_DIR}/health-check.sh" || true
    fi

    ok "Restoration completed successfully from ${RESTORE_FILE}!"
    ;;
esac
