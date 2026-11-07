#!/usr/bin/env bash
# ==============================================================================
# Axon Panel — System Health Verification Script
# https://github.com/afrozhasan/axon-panel
# ==============================================================================

set -euo pipefail

BOLD=$'\033[1m'
CYAN=$'\033[1;36m'
GREEN=$'\033[1;32m'
YELLOW=$'\033[1;33m'
RED=$'\033[1;31m'
NC=$'\033[0m'

QUIET=0
JSON_OUTPUT=0
SERVICE_NAME="axon-panel"
INTERNAL_PORT="9090"
CONFIG_DIR="/etc/axon-panel"

usage() {
  cat <<EOF
${BOLD}Axon Panel Health Check Tool${NC}

Usage:
  ./health-check.sh [options]

Options:
  --quiet        Suppress visual output; exit with code 0 on healthy, 1 on failure
  --json         Print health report in JSON format
  --service <s>  Service unit name to check (default: axon-panel)
  --port <p>     Internal port to check (default: 9090)
  -h, --help     Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --quiet) QUIET=1; shift ;;
    --json) JSON_OUTPUT=1; shift ;;
    --service) SERVICE_NAME="$2"; shift 2 ;;
    --port) INTERNAL_PORT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ ! -d "$CONFIG_DIR" && -d "/etc/axonpanel" ]]; then
  CONFIG_DIR="/etc/axonpanel"
elif [[ ! -d "$CONFIG_DIR" && -d "/etc/webpanel" ]]; then
  CONFIG_DIR="/etc/webpanel"
fi

STATUS_SERVICE="ok"
STATUS_PORT="ok"
STATUS_DB="ok"
STATUS_NGINX="ok"
STATUS_DISK="ok"
STATUS_MEM="ok"
FAILED_CHECKS=0

# 1. Systemd Service Check
if systemctl is-active --quiet "$SERVICE_NAME"; then
  STATUS_SERVICE="active"
elif systemctl is-active --quiet "webpanel" && [[ "$SERVICE_NAME" == "axon-panel" ]]; then
  SERVICE_NAME="webpanel"
  STATUS_SERVICE="active"
else
  STATUS_SERVICE="inactive"
  FAILED_CHECKS=$((FAILED_CHECKS + 1))
fi

# 2. HTTP Port Response Check
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:${INTERNAL_PORT}/api/auth/session" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "401" ]]; then
  STATUS_PORT="listening (${HTTP_CODE})"
else
  STATUS_PORT="unreachable (code: ${HTTP_CODE})"
  FAILED_CHECKS=$((FAILED_CHECKS + 1))
fi

# 3. Database Check
DB_FILE="${CONFIG_DIR}/axon.db"
if [[ -f "$DB_FILE" ]]; then
  if command -v sqlite3 >/dev/null 2>&1; then
    INTEGRITY=$(sqlite3 "$DB_FILE" "PRAGMA integrity_check;" 2>/dev/null || echo "error")
    if [[ "$INTEGRITY" == "ok" ]]; then
      STATUS_DB="ok (integrity verified)"
    else
      STATUS_DB="corrupted (${INTEGRITY})"
      FAILED_CHECKS=$((FAILED_CHECKS + 1))
    fi
  else
    STATUS_DB="present (sqlite3 binary not installed for deep check)"
  fi
else
  STATUS_DB="missing (${DB_FILE} not found)"
  FAILED_CHECKS=$((FAILED_CHECKS + 1))
fi

# 4. Nginx Syntax Check
if command -v nginx >/dev/null 2>&1; then
  if nginx -t >/dev/null 2>&1; then
    STATUS_NGINX="valid"
  else
    STATUS_NGINX="syntax_error"
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
  fi
else
  STATUS_NGINX="nginx_not_installed"
fi

# 5. Disk Space Check (Require >= 500 MB on root mount)
AVAILABLE_ROOT_KB=$(df -P / | awk 'NR==2 {print $4}')
AVAILABLE_ROOT_MB=$((AVAILABLE_ROOT_KB / 1024))
if [[ $AVAILABLE_ROOT_MB -ge 500 ]]; then
  STATUS_DISK="${AVAILABLE_ROOT_MB} MB free"
else
  STATUS_DISK="low disk space (${AVAILABLE_ROOT_MB} MB free)"
  FAILED_CHECKS=$((FAILED_CHECKS + 1))
fi

# 6. Memory Check (Require >= 64 MB available)
AVAILABLE_MEM_KB=$(grep MemAvailable /proc/meminfo 2>/dev/null | awk '{print $2}' || echo "0")
AVAILABLE_MEM_MB=$((AVAILABLE_MEM_KB / 1024))
if [[ $AVAILABLE_MEM_MB -ge 64 ]]; then
  STATUS_MEM="${AVAILABLE_MEM_MB} MB available"
else
  STATUS_MEM="critically low memory (${AVAILABLE_MEM_MB} MB available)"
  FAILED_CHECKS=$((FAILED_CHECKS + 1))
fi

if [[ $JSON_OUTPUT -eq 1 ]]; then
  cat <<EOF
{
  "healthy": $((FAILED_CHECKS == 0 ? 1 : 0)),
  "failedChecks": ${FAILED_CHECKS},
  "service": "${STATUS_SERVICE}",
  "serviceName": "${SERVICE_NAME}",
  "port": "${STATUS_PORT}",
  "database": "${STATUS_DB}",
  "nginx": "${STATUS_NGINX}",
  "disk": "${STATUS_DISK}",
  "memory": "${STATUS_MEM}",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
elif [[ $QUIET -eq 0 ]]; then
  printf '\n%b=== Axon Panel System Health Inspection ===%b\n\n' "$CYAN" "$NC"
  
  if [[ "$STATUS_SERVICE" == "active" ]]; then
    printf '  %b✓%b Service (%s):        %s\n' "$GREEN" "$NC" "$SERVICE_NAME" "$STATUS_SERVICE"
  else
    printf '  %b✗%b Service (%s):        %s\n' "$RED" "$NC" "$SERVICE_NAME" "$STATUS_SERVICE"
  fi

  if [[ "$STATUS_PORT" =~ listening ]]; then
    printf '  %b✓%b Internal HTTP Daemon:   %s\n' "$GREEN" "$NC" "$STATUS_PORT"
  else
    printf '  %b✗%b Internal HTTP Daemon:   %s\n' "$RED" "$NC" "$STATUS_PORT"
  fi

  if [[ "$STATUS_DB" =~ ok|present ]]; then
    printf '  %b✓%b SQLite WAL Database:    %s\n' "$GREEN" "$NC" "$STATUS_DB"
  else
    printf '  %b✗%b SQLite WAL Database:    %s\n' "$RED" "$NC" "$STATUS_DB"
  fi

  if [[ "$STATUS_NGINX" == "valid" ]]; then
    printf '  %b✓%b Nginx Virtual Hosts:    %s\n' "$GREEN" "$NC" "$STATUS_NGINX"
  elif [[ "$STATUS_NGINX" == "nginx_not_installed" ]]; then
    printf '  %b•%b Nginx Virtual Hosts:    %s\n' "$YELLOW" "$NC" "$STATUS_NGINX"
  else
    printf '  %b✗%b Nginx Virtual Hosts:    %s\n' "$RED" "$NC" "$STATUS_NGINX"
  fi

  printf '  %b✓%b Storage Capacity:       %s\n' "$GREEN" "$NC" "$STATUS_DISK"
  printf '  %b✓%b Host Memory:            %s\n' "$GREEN" "$NC" "$STATUS_MEM"
  
  if [[ $FAILED_CHECKS -eq 0 ]]; then
    printf '\n%b✓ System status: ALL HEALTH CHECKS PASSED.%b\n\n' "$GREEN" "$NC"
  else
    printf '\n%b✗ System status: %d HEALTH CHECK(S) FAILED.%b\n\n' "$RED" "$FAILED_CHECKS" "$NC"
  fi
fi

if [[ $FAILED_CHECKS -eq 0 ]]; then
  exit 0
else
  exit 1
fi
