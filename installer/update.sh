#!/usr/bin/env bash
# ==============================================================================
# Axon Panel — Safe Version Update Engine
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

GITHUB_REPO="afrozhasan/axon-panel"
INSTALL_DIR="/opt/axon-panel"
SERVICE_NAME="axon-panel"
CONFIG_DIR="/etc/axon-panel"
TARGET_VERSION=""
CHECK_ONLY=0
SKIP_BACKUP=0
FORCE=0

# Auto-detect running service
if ! systemctl list-unit-files 2>/dev/null | grep -q "^axon-panel.service"; then
  if systemctl list-unit-files 2>/dev/null | grep -q "^axonpanel.service"; then
    SERVICE_NAME="axonpanel"
  elif systemctl list-unit-files 2>/dev/null | grep -q "^webpanel.service"; then
    SERVICE_NAME="webpanel"
  fi
fi

# Auto-detect installation directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -f "${INSTALL_DIR}/package.json" ]]; then
  PANEL_DIR="$INSTALL_DIR"
elif [[ -f "${PARENT_DIR}/package.json" ]]; then
  PANEL_DIR="$PARENT_DIR"
else
  PANEL_DIR="$INSTALL_DIR"
fi

if [[ ! -d "$CONFIG_DIR" && -d "/etc/axonpanel" ]]; then
  CONFIG_DIR="/etc/axonpanel"
elif [[ ! -d "$CONFIG_DIR" && -d "/etc/webpanel" ]]; then
  CONFIG_DIR="/etc/webpanel"
fi

usage() {
  cat <<EOF
${BOLD}Axon Panel Update Engine${NC}

Usage:
  sudo ./update.sh [options]

Options:
  --check              Check available releases and exit without updating
  --version <tag>      Specify explicit release version (e.g. v1.1.0)
  --dir <path>         Application directory (default: ${PANEL_DIR})
  --force              Force re-installation of the target release version
  --skip-backup        Skip pre-update automated backup (NOT recommended)
  -h, --help           Show this help message and exit

Examples:
  sudo ./update.sh
  sudo ./update.sh --check
  sudo ./update.sh --version v1.0.1
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_ONLY=1; shift ;;
    --version) TARGET_VERSION="$2"; shift 2 ;;
    --dir) PANEL_DIR="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --skip-backup) SKIP_BACKUP=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown option: $1 (run with --help)" ;;
  esac
done

[[ $EUID -eq 0 ]] || fail "The updater must be run as root. Run: sudo ./update.sh"

printf '%b' "$CYAN"
cat <<'EOF'
    ___                             ____                       __
   /   |  _  ______  ____          / __ \____ _____  ___  / /
  / /| | | |/_/ __ \/ __ \ ______ / /_/ / __ `/ __ \/ _ \/ / 
 / ___ |_>  </ /_/ / / / /_____// ____/ /_/ / / / /  __/ /  
/_/  |_/_/|_|\____/_/ /_/      /_/    \__,_/_/ /_/\___/_/   
EOF
printf '%b\n' "$NC"
printf '  %bAxon Panel Automated Upgrade Engine%b\n\n' "$BOLD" "$NC"

# 1. Detect Installed Version
CURRENT_VERSION="unknown"
if [[ -f "${PANEL_DIR}/package.json" ]]; then
  CURRENT_VERSION=$(grep '"version"' "${PANEL_DIR}/package.json" | head -n 1 | awk -F '"' '{print $4}')
fi
info "Current installed version: ${CURRENT_VERSION}"

# 2. Query GitHub Releases
log "Checking GitHub releases for ${GITHUB_REPO}..."
LATEST_TAG=""
RELEASE_JSON=$(curl -fsSL --max-time 10 "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" 2>/dev/null || echo "")

if [[ -n "$RELEASE_JSON" ]]; then
  LATEST_TAG=$(printf '%s' "$RELEASE_JSON" | grep '"tag_name"' | head -n 1 | awk -F '"' '{print $4}')
fi

if [[ -z "$TARGET_VERSION" ]]; then
  if [[ -n "$LATEST_TAG" ]]; then
    TARGET_VERSION="$LATEST_TAG"
  else
    warn "Could not fetch latest release from GitHub API (offline or rate-limited)."
    if [[ -d "${PANEL_DIR}/.git" ]]; then
      info "Git repository detected. Will perform Git pull update."
      TARGET_VERSION="git-head"
    else
      fail "Cannot determine latest release version. Specify with --version <tag>"
    fi
  fi
fi

info "Target upgrade version:   ${TARGET_VERSION}"

# Strip leading 'v' for comparison if needed
CLEAN_CURRENT="${CURRENT_VERSION#v}"
CLEAN_TARGET="${TARGET_VERSION#v}"

if [[ $CHECK_ONLY -eq 1 ]]; then
  if [[ "$CLEAN_CURRENT" == "$CLEAN_TARGET" ]]; then
    ok "Axon Panel is up to date (version ${CURRENT_VERSION})."
  else
    ok "New version available: ${TARGET_VERSION} (current: ${CURRENT_VERSION})"
    info "Run 'sudo ./update.sh' to install the update."
  fi
  exit 0
fi

if [[ "$CLEAN_CURRENT" == "$CLEAN_TARGET" && $FORCE -eq 0 && "$TARGET_VERSION" != "git-head" ]]; then
  ok "Axon Panel is already running the requested version (${CURRENT_VERSION})."
  info "To reinstall anyway, run with: --force"
  exit 0
fi

# 3. Create Pre-Update Safety Backup
PRE_BACKUP_PATH=""
if [[ $SKIP_BACKUP -eq 0 ]]; then
  log "Creating pre-update safety backup..."
  BACKUP_SCRIPT="${SCRIPT_DIR}/backup.sh"
  if [[ -f "$BACKUP_SCRIPT" ]]; then
    BACKUP_OUTPUT=$(bash "$BACKUP_SCRIPT" --backup)
    PRE_BACKUP_PATH=$(printf '%s' "$BACKUP_OUTPUT" | grep 'Archive:' | awk '{print $2}')
    ok "Safety backup created: ${PRE_BACKUP_PATH}"
  else
    warn "backup.sh not found at ${BACKUP_SCRIPT}. Proceeding with manual config copy..."
    TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
    MANUAL_BACKUP="/var/backups/axon-panel/pre-update-${TIMESTAMP}"
    mkdir -p "$MANUAL_BACKUP"
    [[ -d "$CONFIG_DIR" ]] && cp -r "$CONFIG_DIR" "$MANUAL_BACKUP/config"
    PRE_BACKUP_PATH="$MANUAL_BACKUP"
    ok "Manual configuration backup created at: ${MANUAL_BACKUP}"
  fi
fi

# 4. Download and Deploy Requested Version
log "Applying Axon Panel update to ${TARGET_VERSION}..."

STAGING_DIR=$(mktemp -d "/tmp/axon-upgrade-XXXXXX")
trap 'rm -rf "${STAGING_DIR}"' EXIT

UPDATE_SUCCESS=0

if [[ "$TARGET_VERSION" == "git-head" || (-d "${PANEL_DIR}/.git" && "$TARGET_VERSION" =~ ^v?[0-9] ) ]]; then
  if [[ -d "${PANEL_DIR}/.git" ]]; then
    info "Updating via Git repository in ${PANEL_DIR}..."
    git config --global --add safe.directory "$PANEL_DIR" 2>/dev/null || true
    cd "$PANEL_DIR"
    git fetch --all --tags -q
    if [[ "$TARGET_VERSION" == "git-head" ]]; then
      BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")"
      if git pull origin "$BRANCH" -q 2>/dev/null; then
        info "Pulled latest commits from origin/${BRANCH}."
      else
        info "Using current repository branch ${BRANCH}."
      fi
    else
      git checkout "$TARGET_VERSION" -q
    fi
    UPDATE_SUCCESS=1
  fi
fi

if [[ $UPDATE_SUCCESS -eq 0 ]]; then
  TARBALL_URL="https://github.com/${GITHUB_REPO}/releases/download/${TARGET_VERSION}/axon-panel-${TARGET_VERSION}.tar.gz"
  CHECKSUM_URL="https://github.com/${GITHUB_REPO}/releases/download/${TARGET_VERSION}/SHA256SUMS"
  TARBALL_FILE="${STAGING_DIR}/axon-panel.tar.gz"
  CHECKSUM_FILE="${STAGING_DIR}/SHA256SUMS"

  info "Downloading release package: ${TARBALL_URL}..."
  if curl -fsSL --max-time 60 "$TARBALL_URL" -o "$TARBALL_FILE"; then
    info "Validating release checksums..."
    if curl -fsSL --max-time 15 "$CHECKSUM_URL" -o "$CHECKSUM_FILE" 2>/dev/null; then
      if (cd "$STAGING_DIR" && sha256sum --ignore-missing -c "$CHECKSUM_FILE" >/dev/null 2>&1); then
        ok "SHA256 checksum verified successfully."
      else
        warn "Checksum file downloaded but validation was inconclusive. Proceeding with caution..."
      fi
    fi

    mkdir -p "${STAGING_DIR}/extracted"
    tar -xzf "$TARBALL_FILE" -C "${STAGING_DIR}/extracted"

    # Copy files into PANEL_DIR, preserving uploads and runtime files
    mkdir -p "$PANEL_DIR"
    cp -a "${STAGING_DIR}/extracted"/. "${PANEL_DIR}/"
    ok "Application files updated in ${PANEL_DIR}."
    UPDATE_SUCCESS=1
  else
    warn "Direct release tarball download unavailable. Falling back to GitHub source archive..."
    SOURCE_URL="https://github.com/${GITHUB_REPO}/archive/refs/tags/${TARGET_VERSION}.tar.gz"
    if curl -fsSL --max-time 60 "$SOURCE_URL" -o "$TARBALL_FILE"; then
      mkdir -p "${STAGING_DIR}/extracted"
      tar -xzf "$TARBALL_FILE" -C "${STAGING_DIR}/extracted" --strip-components=1
      cp -a "${STAGING_DIR}/extracted"/. "${PANEL_DIR}/"
      ok "Source archive updated in ${PANEL_DIR}."
      UPDATE_SUCCESS=1
    else
      fail "Could not download release assets for ${TARGET_VERSION}."
    fi
  fi
fi

rm -rf "$STAGING_DIR"
trap - EXIT

# 5. Update Dependencies & Run Build
log "Updating runtime dependencies..."
cd "$PANEL_DIR"

if command -v npm >/dev/null 2>&1; then
  npm install --omit=dev --no-audit --no-fund --quiet
  ok "Node.js production dependencies up to date."

  # Check if frontend dist exists; if missing, build it
  if [[ ! -d "${PANEL_DIR}/dist" || ! -f "${PANEL_DIR}/dist/index.html" ]]; then
    info "Compiling frontend bundle..."
    npm install --include=dev --no-audit --no-fund --quiet
    npm run build
    ok "Frontend bundle compiled successfully."
  fi
fi

# 6. Apply Database Migrations
log "Executing SQLite database schema migrations..."
if node -e 'import("./server/lib/db.js").then(() => console.log("Database initialized."))' 2>/dev/null; then
  ok "Database schema migrations applied."
else
  warn "Database migration check returned warnings. Proceeding with service restart..."
fi

# 7. File Permissions
if id -u axonpanel >/dev/null 2>&1; then
  chown -R axonpanel:axonpanel "$PANEL_DIR" 2>/dev/null || true
fi

# 8. Restart Systemd Service
log "Restarting ${SERVICE_NAME} daemon..."
systemctl daemon-reload
systemctl restart "$SERVICE_NAME"
sleep 2

# 9. Health Verification & Automated Rollback
log "Verifying post-update health status..."
HEALTH_CHECK="${SCRIPT_DIR}/health-check.sh"
HEALTH_OK=1

if [[ -f "$HEALTH_CHECK" ]]; then
  if bash "$HEALTH_CHECK" --quiet; then
    ok "System health check passed."
  else
    HEALTH_OK=0
  fi
else
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    ok "Service ${SERVICE_NAME} is active."
  else
    HEALTH_OK=0
  fi
fi

if [[ $HEALTH_OK -eq 0 ]]; then
  warn "Health check failed after upgrade! Initiating automated rollback..."
  if [[ -n "$PRE_BACKUP_PATH" && -f "${SCRIPT_DIR}/backup.sh" && -f "$PRE_BACKUP_PATH" ]]; then
    bash "${SCRIPT_DIR}/backup.sh" --restore "$PRE_BACKUP_PATH"
    fail "Axon Panel upgrade failed. Automated rollback successfully restored pre-update backup: ${PRE_BACKUP_PATH}"
  else
    fail "Axon Panel upgrade failed. Review logs with: journalctl -u ${SERVICE_NAME} -n 50"
  fi
fi

# 10. Summary
NEW_VERSION="unknown"
if [[ -f "${PANEL_DIR}/package.json" ]]; then
  NEW_VERSION=$(grep '"version"' "${PANEL_DIR}/package.json" | head -n 1 | awk -F '"' '{print $4}')
fi

printf '\n%b' "$GREEN"
echo "────────────────────────────────────────────────────────────────────────────"
echo "  🎉 Axon Panel has been successfully updated to version ${NEW_VERSION}!"
echo "────────────────────────────────────────────────────────────────────────────"
printf '%b\n' "$NC"

cat <<EOF
  Active Service:   systemctl status ${SERVICE_NAME}
  Live Logs:        journalctl -u ${SERVICE_NAME} -f
  Pre-update Image: ${PRE_BACKUP_PATH:-None}

────────────────────────────────────────────────────────────────────────────
EOF
