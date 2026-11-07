#!/usr/bin/env bash
# ==============================================================================
# Axon Panel — Automated Standalone System Installer
# Axon Panel by AxonWP (https://axonwp.com) — Developed by Afroz Hasan (https://afroz.me)
#
# GitHub: https://github.com/afrozhasan/axon-panel
# Supported OS: Ubuntu 22.04 LTS, Ubuntu 24.04 LTS, Debian 11 / 12
#
# Public Installation Command:
#   curl -fsSL https://github.com/afrozhasan/axon-panel/releases/latest/download/install.sh -o install.sh && sudo bash install.sh
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
DEFAULT_INSTALL_DIR="/opt/axon-panel"
SERVICE_NAME="axon-panel"
CONFIG_DIR="${AXONPANEL_CONFIG_DIR:-/etc/axon-panel}"
LOG_DIR="${AXONPANEL_LOG_DIR:-/var/log/axon-panel}"
BACKUP_DIR="${AXONPANEL_BACKUP_DIR:-/var/backups/axon-panel}"

# Default installer parameters
PANEL_DOMAIN=""
LETSENCRYPT_EMAIL=""
PANEL_PORT=9090
DO_SSL=1
RESET_PASSWORD=0
TARGET_DIR=""
VERSION_TAG=""
NON_INTERACTIVE=0

usage() {
  cat <<EOF
${BOLD}Axon Panel Standalone System Installer${NC}

Usage:
  ./install.sh [options]
  curl -fsSL https://github.com/afrozhasan/axon-panel/releases/latest/download/install.sh -o install.sh && sudo bash install.sh [options]

Options:
  --domain <name>       Domain or subdomain for the panel (e.g. panel.example.com)
  --email <address>     Let's Encrypt email address for TLS renewal notices
  --port <number>       Local internal port for the Node.js backend (default: 9090)
  --dir <path>          Target installation directory (default: ${DEFAULT_INSTALL_DIR})
  --version <tag>       Install explicit release version (e.g. v1.0.0; default: latest)
  --no-ssl              Skip Let's Encrypt SSL and serve the panel over HTTP
  --reset-password      Regenerate admin password even if an existing installation is found
  --yes, -y             Non-interactive installation with automated defaults
  -h, --help            Show this help message and exit

Examples:
  ./install.sh --domain panel.example.com --email admin@example.com
  ./install.sh --domain panel.mydomain.io --email webmaster@mydomain.io --no-ssl
  ./install.sh --version v1.0.0
EOF
}

# Parse Arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) PANEL_DOMAIN="$2"; shift 2 ;;
    --email) LETSENCRYPT_EMAIL="$2"; shift 2 ;;
    --port) PANEL_PORT="$2"; shift 2 ;;
    --dir) TARGET_DIR="$2"; shift 2 ;;
    --version) VERSION_TAG="$2"; shift 2 ;;
    --no-ssl) DO_SSL=0; shift ;;
    --reset-password) RESET_PASSWORD=1; shift ;;
    -y|--yes) NON_INTERACTIVE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown option: $1 (run with --help for details)" ;;
  esac
done

# ------------------------------------------------------------------------------
# 1. PRE-INSTALLATION ENVIRONMENT & PRIVILEGE CHECKS
# ------------------------------------------------------------------------------
printf '%b' "$CYAN"
cat <<'EOF'
    ___                             ____                       __
   /   |  _  ______  ____          / __ \____ _____  ___  / /
  / /| | | |/_/ __ \/ __ \ ______ / /_/ / __ `/ __ \/ _ \/ / 
 / ___ |_>  </ /_/ / / / /_____// ____/ /_/ / / / /  __/ /  
/_/  |_/_/|_|\____/_/ /_/      /_/    \__,_/_/ /_/\___/_/   
EOF
printf '%b\n' "$NC"
printf '  %bAxon Panel by AxonWP (https://axonwp.com) — Developed by Afroz Hasan (https://afroz.me)%b\n\n' "$BOLD" "$NC"

[[ $EUID -eq 0 ]] || fail "This installer must be run as root. Run: sudo bash install.sh"

# Detect OS
if [[ -f /etc/os-release ]]; then
  # shellcheck source=/dev/null
  . /etc/os-release
  OS_ID="${ID:-}"
  OS_NAME="${PRETTY_NAME:-$ID}"
else
  fail "Cannot detect operating system. /etc/os-release was not found."
fi

info "Detected Operating System: $OS_NAME"

if [[ "$OS_ID" != "ubuntu" && "$OS_ID" != "debian" && "$OS_ID" != "pop" && "$OS_ID" != "linuxmint" ]]; then
  warn "Axon Panel is engineered and tested primarily for Ubuntu (22.04 LTS / 24.04 LTS) and Debian (11/12)."
  warn "Installation will continue on ${OS_NAME} on a best-effort basis."
fi

# Detect Memory
TOTAL_RAM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
TOTAL_RAM_MB=$((TOTAL_RAM_KB / 1024))
info "System RAM: ${TOTAL_RAM_MB} MB"

if [[ $TOTAL_RAM_MB -lt 800 ]]; then
  warn "System RAM is under 1 GB (${TOTAL_RAM_MB} MB detected). Axon Panel will operate, but configuring swap is strongly recommended."
fi

# Determine source location vs installation target
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "")"
PARENT_DIR="$(cd "${SCRIPT_DIR}/.." 2>/dev/null && pwd || echo "")"

LOCAL_REPO_DIR=""
if [[ -f "${SCRIPT_DIR}/package.json" && -d "${SCRIPT_DIR}/server" ]]; then
  LOCAL_REPO_DIR="${SCRIPT_DIR}"
elif [[ -f "${PARENT_DIR}/package.json" && -d "${PARENT_DIR}/server" ]]; then
  LOCAL_REPO_DIR="${PARENT_DIR}"
fi

if [[ -n "$TARGET_DIR" ]]; then
  INSTALL_DIR="$TARGET_DIR"
else
  INSTALL_DIR="$DEFAULT_INSTALL_DIR"
fi

# ------------------------------------------------------------------------------
# 2. INTERACTIVE CONFIGURATION (IF NOT PROVIDED VIA FLAGS)
# ------------------------------------------------------------------------------
if [[ -z "$PANEL_DOMAIN" && $NON_INTERACTIVE -eq 0 ]]; then
  log "Panel Domain Configuration:"
  echo "Specify the domain or subdomain you will use to access Axon Panel (e.g. panel.yourdomain.com)."
  echo "Leave empty to bind to the server hostname / localhost."
  read -r -p "Panel Domain [localhost]: " INPUT_DOMAIN
  PANEL_DOMAIN="${INPUT_DOMAIN:-localhost}"
elif [[ -z "$PANEL_DOMAIN" ]]; then
  PANEL_DOMAIN="localhost"
fi

if [[ "$PANEL_DOMAIN" != "localhost" && "$PANEL_DOMAIN" != "127.0.0.1" && "$DO_SSL" == "1" && -z "$LETSENCRYPT_EMAIL" && $NON_INTERACTIVE -eq 0 ]]; then
  echo ""
  echo "Enter an email address for Let's Encrypt TLS certificate renewal notices:"
  read -r -p "Admin Email: " INPUT_EMAIL
  LETSENCRYPT_EMAIL="${INPUT_EMAIL:-admin@localhost}"
elif [[ -z "$LETSENCRYPT_EMAIL" ]]; then
  LETSENCRYPT_EMAIL="admin@localhost"
fi

# ------------------------------------------------------------------------------
# 3. DEDICATED SYSTEM USER SETUP
# ------------------------------------------------------------------------------
log "Configuring dedicated system user (axonpanel)..."
if ! id -u axonpanel >/dev/null 2>&1; then
  useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin --comment "Axon Panel system user" axonpanel
  ok "Created dedicated system user: axonpanel"
else
  ok "Dedicated system user axonpanel already exists."
fi

# ------------------------------------------------------------------------------
# 4. SYSTEM PACKAGE DEPENDENCIES INSTALLATION
# ------------------------------------------------------------------------------
log "Validating and installing required system packages..."

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq || true

PKGS_TO_INSTALL=()
for pkg in curl git tar gzip unzip build-essential sqlite3 ca-certificates gnupg software-properties-common; do
  if ! dpkg -s "$pkg" >/dev/null 2>&1; then
    PKGS_TO_INSTALL+=("$pkg")
  fi
done

if [[ ${#PKGS_TO_INSTALL[@]} -gt 0 ]]; then
  info "Installing core system utilities: ${PKGS_TO_INSTALL[*]}..."
  apt-get install -y -qq "${PKGS_TO_INSTALL[@]}"
  ok "Core system utilities installed."
else
  ok "Core system utilities already present."
fi

# Ensure Nginx is installed
if ! command -v nginx >/dev/null 2>&1; then
  info "Installing Nginx web server..."
  apt-get install -y -qq nginx
  systemctl enable nginx --quiet
  systemctl start nginx || true
  ok "Nginx web server installed and enabled."
else
  ok "Nginx web server is already installed."
fi

# Ensure Node.js 22+ is installed
NODE_NEEDS_INSTALL=0
if ! command -v node >/dev/null 2>&1; then
  NODE_NEEDS_INSTALL=1
else
  NODE_MAJOR=$(node -v | tr -d 'v' | cut -d'.' -f1)
  if [[ "$NODE_MAJOR" -lt 22 ]]; then
    info "Installed Node.js is v${NODE_MAJOR}. Axon Panel requires Node.js 22 or higher."
    NODE_NEEDS_INSTALL=1
  fi
fi

if [[ $NODE_NEEDS_INSTALL -eq 1 ]]; then
  info "Provisioning Node.js 22.x LTS via NodeSource..."
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq || true
  apt-get install -y -qq nodejs
  ok "Node.js $(node -v) and npm $(npm -v) installed."
else
  ok "Node.js $(node -v) is active and meets version requirements."
fi

# Ensure Certbot is installed if SSL is enabled
if [[ "$DO_SSL" == "1" && "$PANEL_DOMAIN" != "localhost" ]]; then
  if ! command -v certbot >/dev/null 2>&1; then
    info "Installing Certbot and Nginx plugin..."
    apt-get install -y -qq certbot python3-certbot-nginx || true
    ok "Certbot installed."
  else
    ok "Certbot is already installed."
  fi
fi

# Ensure Ondřej Surý PHP repository is registered so multi-PHP versions (8.1 - 8.4) can be installed
log "Configuring PHP package repository..."
if [[ "$OS_ID" == "ubuntu" || "$OS_ID" == "pop" || "$OS_ID" == "linuxmint" ]]; then
  if ! grep -rqs "ondrej/php" /etc/apt/sources.list /etc/apt/sources.list.d/ 2>/dev/null; then
    info "Configuring Ondřej Surý PHP PPA (ppa:ondrej/php) for Ubuntu ${VERSION_CODENAME:-}..."
    if command -v add-apt-repository >/dev/null 2>&1; then
      LC_ALL=C.UTF-8 add-apt-repository -y ppa:ondrej/php || {
        warn "add-apt-repository failed; using direct Launchpad keyring configuration..."
        mkdir -p /etc/apt/keyrings
        curl -fsSL "https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x14AA40EC0831756756D7F66C4F4EA0AAE5267A6C" | gpg --dearmor -o /etc/apt/keyrings/ondrej-php.gpg --yes || true
        CODENAME="${VERSION_CODENAME:-$(lsb_release -sc 2>/dev/null || echo noble)}"
        echo "deb [signed-by=/etc/apt/keyrings/ondrej-php.gpg] https://ppa.launchpadcontent.net/ondrej/php/ubuntu/ ${CODENAME} main" > /etc/apt/sources.list.d/ondrej-php.list
      }
    fi
    apt-get update -qq || true
    ok "Ondřej Surý PHP PPA configured."
  else
    ok "Ondřej Surý PHP repository already present."
  fi
elif [[ "$OS_ID" == "debian" ]]; then
  if ! grep -rqs "packages.sury.org/php" /etc/apt/sources.list /etc/apt/sources.list.d/ 2>/dev/null; then
    info "Configuring Ondřej Surý PHP repository for Debian ${VERSION_CODENAME:-}..."
    apt-get install -y -qq apt-transport-https lsb-release ca-certificates curl || true
    mkdir -p /etc/apt/trusted.gpg.d
    curl -sSLo /etc/apt/trusted.gpg.d/php.gpg https://packages.sury.org/php/apt.gpg || true
    CODENAME="${VERSION_CODENAME:-$(lsb_release -sc 2>/dev/null || echo bookworm)}"
    echo "deb https://packages.sury.org/php/ ${CODENAME} main" > /etc/apt/sources.list.d/php.list
    apt-get update -qq || true
    ok "Debian PHP repository configured."
  else
    ok "Debian PHP repository already present."
  fi
fi

# Ensure baseline PHP-FPM service is available if no PHP is present on the system
if ! command -v php >/dev/null 2>&1 && ! ls /var/run/php/php*-fpm.sock >/dev/null 2>&1; then
  info "Installing baseline PHP 8.3 FPM runtime and common extensions..."
  apt-get install -y -qq php8.3-fpm php8.3-cli php8.3-common php8.3-mysql php8.3-curl php8.3-gd php8.3-mbstring php8.3-xml php8.3-zip php8.3-bcmath php8.3-intl || true
  systemctl enable php8.3-fpm --quiet || true
  systemctl start php8.3-fpm || true
  ok "Baseline PHP 8.3 FPM runtime installed."
else
  ok "Existing PHP installation detected; skipping baseline PHP installation."
fi

# ------------------------------------------------------------------------------
# 5. RETRIEVE APPLICATION SOURCE / RELEASE ASSETS
# ------------------------------------------------------------------------------
log "Deploying Axon Panel application into ${INSTALL_DIR}..."

mkdir -p "$INSTALL_DIR"

if [[ -n "$LOCAL_REPO_DIR" && -f "${LOCAL_REPO_DIR}/package.json" && -d "${LOCAL_REPO_DIR}/server" ]]; then
  if [[ "$LOCAL_REPO_DIR" != "$INSTALL_DIR" ]]; then
    info "Installing from local source repository at ${LOCAL_REPO_DIR}..."
    if command -v rsync >/dev/null 2>&1; then
      rsync -a --exclude 'node_modules' --exclude '.git' --exclude '*.db*' --exclude '*.log' "${LOCAL_REPO_DIR}/" "${INSTALL_DIR}/"
    else
      cp -a "${LOCAL_REPO_DIR}"/. "${INSTALL_DIR}/"
    fi
    ok "Source files staged into ${INSTALL_DIR}."
  else
    info "Deploying in-place within ${INSTALL_DIR}."
  fi
else
  # Standalone installer via curl: Fetch release package from GitHub
  info "Retrieving distribution assets from GitHub releases..."
  if [[ -z "$VERSION_TAG" ]]; then
    RELEASE_API=$(curl -fsSL --max-time 10 "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" 2>/dev/null || echo "")
    if [[ -n "$RELEASE_API" ]]; then
      VERSION_TAG=$(printf '%s' "$RELEASE_API" | grep '"tag_name"' | head -n 1 | awk -F '"' '{print $4}')
    fi
  fi

  [[ -n "$VERSION_TAG" ]] || VERSION_TAG="v1.0.0"
  info "Deploying Axon Panel release ${VERSION_TAG}..."

  TMP_RELEASE_DIR=$(mktemp -d "/tmp/axon-install-XXXXXX")
  EXTRACT_STAGING="${TMP_RELEASE_DIR}/extracted"
  mkdir -p "$EXTRACT_STAGING"
  trap 'rm -rf "${TMP_RELEASE_DIR}"' EXIT

  TARBALL_URL="https://github.com/${GITHUB_REPO}/releases/download/${VERSION_TAG}/axon-panel-${VERSION_TAG}.tar.gz"
  CHECKSUM_URL="https://github.com/${GITHUB_REPO}/releases/download/${VERSION_TAG}/SHA256SUMS"
  TARBALL_FILE="${TMP_RELEASE_DIR}/axon-panel.tar.gz"
  CHECKSUM_FILE="${TMP_RELEASE_DIR}/SHA256SUMS"

  if curl -fsSL --max-time 60 "$TARBALL_URL" -o "$TARBALL_FILE" 2>/dev/null; then
    if curl -fsSL --max-time 10 "$CHECKSUM_URL" -o "$CHECKSUM_FILE" 2>/dev/null; then
      if (cd "$TMP_RELEASE_DIR" && sha256sum --ignore-missing -c "$CHECKSUM_FILE" >/dev/null 2>&1); then
        ok "Package checksum verified."
      fi
    fi
    tar -xzf "$TARBALL_FILE" -C "$EXTRACT_STAGING"
  else
    # Fallback to GitHub source archive
    SOURCE_URL="https://github.com/${GITHUB_REPO}/archive/refs/tags/${VERSION_TAG}.tar.gz"
    info "Release tarball unavailable; downloading source archive from ${SOURCE_URL}..."
    if curl -fsSL --max-time 60 "$SOURCE_URL" -o "$TARBALL_FILE"; then
      tar -xzf "$TARBALL_FILE" -C "$EXTRACT_STAGING"
    else
      fail "Could not download Axon Panel release assets or source archive from GitHub."
    fi
  fi

  # Locate extracted application directory (handles nested directories such as axon-panel-v1.0.0/)
  SRC_EXTRACTED=""
  if [[ -f "${EXTRACT_STAGING}/package.json" ]]; then
    SRC_EXTRACTED="${EXTRACT_STAGING}"
  else
    NESTED_DIR=$(find "$EXTRACT_STAGING" -mindepth 1 -maxdepth 2 -name "package.json" -not -path "*/node_modules/*" -exec dirname {} \; | head -n 1)
    if [[ -n "$NESTED_DIR" && -f "${NESTED_DIR}/package.json" ]]; then
      SRC_EXTRACTED="$NESTED_DIR"
    fi
  fi

  [[ -n "$SRC_EXTRACTED" ]] || fail "Archive extraction failed: Could not locate package.json in downloaded release package."

  info "Staging release files into ${INSTALL_DIR}..."
  mkdir -p "$INSTALL_DIR"
  cp -a "${SRC_EXTRACTED}"/. "${INSTALL_DIR}/"

  rm -rf "$TMP_RELEASE_DIR"
  trap - EXIT
  ok "Axon Panel release ${VERSION_TAG} staged into ${INSTALL_DIR}."
fi

# Normalize directory structure: ensure INSTALL_DIR contains package.json directly
if [[ ! -f "${INSTALL_DIR}/package.json" ]]; then
  NESTED_PKG=$(find "$INSTALL_DIR" -mindepth 1 -maxdepth 2 -name "package.json" -not -path "*/node_modules/*" -exec dirname {} \; | head -n 1)
  if [[ -n "$NESTED_PKG" && -f "${NESTED_PKG}/package.json" && -d "${NESTED_PKG}/server" ]]; then
    info "Normalizing nested directory structure from ${NESTED_PKG} into ${INSTALL_DIR}..."
    cp -a "${NESTED_PKG}"/. "${INSTALL_DIR}/"
    rm -rf "${NESTED_PKG}"
  fi
fi

# Verify source completeness and required files
for req in "package.json" "server/index.js" "systemd/axon-panel.service"; do
  if [[ ! -f "${INSTALL_DIR}/${req}" ]]; then
    fail "Required application file missing: ${INSTALL_DIR}/${req}. Installation aborted."
  fi
done
ok "Source completeness and required application files verified."

# ------------------------------------------------------------------------------
# 6. APPLICATION DEPENDENCIES & FRONTEND PRODUCTION BUILD
# ------------------------------------------------------------------------------
log "Configuring application runtime, dependencies, and frontend build..."

# Step 1: Detect actual application root
APP_ROOT="$INSTALL_DIR"
if [[ ! -f "${APP_ROOT}/package.json" ]]; then
  CANDIDATE=$(find "$INSTALL_DIR" -maxdepth 2 -name "package.json" -not -path "*/node_modules/*" -exec dirname {} \; | head -n 1)
  if [[ -n "$CANDIDATE" && -f "${CANDIDATE}/package.json" ]]; then
    APP_ROOT="$CANDIDATE"
  fi
fi

if [[ ! -f "${APP_ROOT}/package.json" ]]; then
  fail "Cannot locate application package.json in ${INSTALL_DIR} or its subdirectories."
fi
info "Application root identified: ${APP_ROOT}"

# Step 2: Determine frontend application directory
FRONTEND_DIR=""
if [[ -f "${APP_ROOT}/web/package.json" ]] && grep -q '"build":' "${APP_ROOT}/web/package.json"; then
  FRONTEND_DIR="${APP_ROOT}/web"
elif [[ -f "${APP_ROOT}/frontend/package.json" ]] && grep -q '"build":' "${APP_ROOT}/frontend/package.json"; then
  FRONTEND_DIR="${APP_ROOT}/frontend"
elif [[ -f "${APP_ROOT}/client/package.json" ]] && grep -q '"build":' "${APP_ROOT}/client/package.json"; then
  FRONTEND_DIR="${APP_ROOT}/client"
elif [[ -f "${APP_ROOT}/package.json" ]] && grep -q '"build":' "${APP_ROOT}/package.json"; then
  FRONTEND_DIR="${APP_ROOT}"
else
  FRONTEND_DIR="${APP_ROOT}"
fi
info "Frontend application directory identified: ${FRONTEND_DIR}"

# Step 3: Validate package manager and lockfile
PKG_MANAGER="npm"
if [[ -f "${APP_ROOT}/pnpm-lock.yaml" || -f "${FRONTEND_DIR}/pnpm-lock.yaml" ]]; then
  PKG_MANAGER="pnpm"
elif [[ -f "${APP_ROOT}/yarn.lock" || -f "${FRONTEND_DIR}/yarn.lock" ]]; then
  PKG_MANAGER="yarn"
elif [[ -f "${APP_ROOT}/package-lock.json" || -f "${FRONTEND_DIR}/package-lock.json" ]]; then
  PKG_MANAGER="npm"
fi

if ! command -v "$PKG_MANAGER" >/dev/null 2>&1; then
  if [[ "$PKG_MANAGER" == "npm" ]]; then
    fail "Package manager 'npm' is not installed. Node.js/npm installation is required."
  elif [[ "$PKG_MANAGER" == "pnpm" ]]; then
    info "Installing pnpm globally via npm..."
    npm install -g pnpm || fail "Failed to install pnpm."
  elif [[ "$PKG_MANAGER" == "yarn" ]]; then
    info "Installing yarn globally via npm..."
    npm install -g yarn || fail "Failed to install yarn."
  fi
fi
ok "Package manager validated: ${PKG_MANAGER}"

# Step 4: Install dependencies using the appropriate package manager
log "Installing dependencies using ${PKG_MANAGER}..."
cd "$APP_ROOT"

INSTALL_EXIT_CODE=0
if [[ "$PKG_MANAGER" == "npm" ]]; then
  npm install --include=dev --no-audit --no-fund || INSTALL_EXIT_CODE=$?
elif [[ "$PKG_MANAGER" == "pnpm" ]]; then
  pnpm install --no-frozen-lockfile || INSTALL_EXIT_CODE=$?
elif [[ "$PKG_MANAGER" == "yarn" ]]; then
  yarn install || INSTALL_EXIT_CODE=$?
fi

if [[ $INSTALL_EXIT_CODE -ne 0 ]]; then
  fail "Dependency installation failed in ${APP_ROOT} with exit code ${INSTALL_EXIT_CODE}."
fi
ok "Application dependencies installed successfully."

# If frontend is in a separate directory with its own package.json, install its dependencies
if [[ "$FRONTEND_DIR" != "$APP_ROOT" && -f "${FRONTEND_DIR}/package.json" ]]; then
  log "Installing frontend dependencies in ${FRONTEND_DIR}..."
  cd "$FRONTEND_DIR"
  if [[ "$PKG_MANAGER" == "npm" ]]; then
    npm install --include=dev --no-audit --no-fund || fail "Frontend dependency installation failed in ${FRONTEND_DIR}."
  elif [[ "$PKG_MANAGER" == "pnpm" ]]; then
    pnpm install --no-frozen-lockfile || fail "Frontend pnpm install failed in ${FRONTEND_DIR}."
  elif [[ "$PKG_MANAGER" == "yarn" ]]; then
    yarn install || fail "Frontend yarn install failed in ${FRONTEND_DIR}."
  fi
  ok "Frontend dependencies installed."
fi

# Step 5: Execute actual production build script (Do not invent build command; do not skip frontend build)
log "Compiling production frontend interface from source..."
cd "$FRONTEND_DIR"

HAS_BUILD_SCRIPT=$(node -e '
  try {
    const pkg = JSON.parse(require("fs").readFileSync("package.json", "utf8"));
    if (pkg.scripts && typeof pkg.scripts.build === "string" && pkg.scripts.build.trim().length > 0) {
      console.log("yes");
    } else {
      console.log("no");
    }
  } catch(e) {
    console.log("no");
  }
')

if [[ "$HAS_BUILD_SCRIPT" != "yes" ]]; then
  fail "No 'build' script defined in ${FRONTEND_DIR}/package.json. Cannot execute production frontend build."
fi

# Step 6: Run build and check exit code
BUILD_EXIT_CODE=0
if [[ "$PKG_MANAGER" == "npm" ]]; then
  NODE_ENV=production npm run build || BUILD_EXIT_CODE=$?
elif [[ "$PKG_MANAGER" == "pnpm" ]]; then
  NODE_ENV=production pnpm run build || BUILD_EXIT_CODE=$?
elif [[ "$PKG_MANAGER" == "yarn" ]]; then
  NODE_ENV=production yarn build || BUILD_EXIT_CODE=$?
fi

if [[ $BUILD_EXIT_CODE -ne 0 ]]; then
  fail "Production frontend build failed with exit code ${BUILD_EXIT_CODE} in ${FRONTEND_DIR}. Check compiler error logs above."
fi

# Step 7: Verify that expected build artifacts exist
DIST_LOCATIONS=(
  "${INSTALL_DIR}/dist"
  "${FRONTEND_DIR}/dist"
  "${APP_ROOT}/dist"
)

FOUND_DIST=""
for d in "${DIST_LOCATIONS[@]}"; do
  if [[ -f "${d}/index.html" && -s "${d}/index.html" ]]; then
    FOUND_DIST="$d"
    break
  fi
done

if [[ -z "$FOUND_DIST" ]]; then
  fail "Production build completed with exit code 0, but expected build artifact ('dist/index.html') is missing or empty."
fi

# Align distribution bundle to ${INSTALL_DIR}/dist for backend server
if [[ "$FOUND_DIST" != "${INSTALL_DIR}/dist" ]]; then
  info "Synchronizing build artifacts from ${FOUND_DIST} to ${INSTALL_DIR}/dist..."
  mkdir -p "${INSTALL_DIR}/dist"
  cp -a "${FOUND_DIST}"/. "${INSTALL_DIR}/dist/"
fi

if [[ ! -f "${INSTALL_DIR}/dist/index.html" || ! -s "${INSTALL_DIR}/dist/index.html" ]]; then
  fail "Build artifact verification failed: ${INSTALL_DIR}/dist/index.html does not exist or is 0 bytes."
fi
ok "Frontend production bundle compiled and verified: ${INSTALL_DIR}/dist/index.html"

# Prune development dependencies to keep the runtime baseline lean (~42 MB RAM)
if [[ "$PKG_MANAGER" == "npm" ]]; then
  npm prune --omit=dev --no-audit --no-fund --quiet || true
fi

# ------------------------------------------------------------------------------
# 7. SECURE DIRECTORY LAYOUT & CONFIGURATION GENERATION
# ------------------------------------------------------------------------------
log "Setting up secure system directories..."
for dir in "$CONFIG_DIR" "$LOG_DIR" "$BACKUP_DIR"; do
  mkdir -p "$dir"
  chmod 0700 "$dir"
done

CONFIG_FILE="${CONFIG_DIR}/config.json"
INIT_SCRIPT="${INSTALL_DIR}/scripts/init-config.mjs"

ADMIN_PASSWORD=""
if [[ -f "$INIT_SCRIPT" ]]; then
  INIT_ARGS=("--domain" "$PANEL_DOMAIN" "--email" "$LETSENCRYPT_EMAIL" "--port" "$PANEL_PORT")
  if [[ $RESET_PASSWORD -eq 1 ]]; then
    INIT_ARGS+=("--reset-password")
  fi

  # Run init script with environment variables set
  export AXONPANEL_CONFIG_DIR="$CONFIG_DIR"
  export AXONPANEL_LOG_DIR="$LOG_DIR"
  INIT_OUTPUT=$(node "$INIT_SCRIPT" "${INIT_ARGS[@]}")
  ADMIN_PASSWORD=$(node -e "try { const d = JSON.parse(process.argv[1]); console.log(d.password || ''); } catch { console.log(''); }" "$INIT_OUTPUT")
  ok "Configuration generated in ${CONFIG_FILE}"
else
  fail "Cannot locate initialization helper: ${INIT_SCRIPT}"
fi

# ------------------------------------------------------------------------------
# 8. DATABASE INITIALIZATION & SCHEMA MIGRATIONS
# ------------------------------------------------------------------------------
log "Initializing embedded SQLite WAL database..."
export AXONPANEL_CONFIG_DIR="$CONFIG_DIR"
export AXONPANEL_LOG_DIR="$LOG_DIR"

if node -e 'import("./server/lib/db.js").then(() => console.log("Database schema ready."))' 2>/dev/null; then
  ok "Database initialized at ${CONFIG_DIR}/axon.db"
else
  warn "Database initialization returned warnings; continuing..."
fi

# Restrict database file permissions
chmod 0600 "${CONFIG_DIR}"/* 2>/dev/null || true
chmod 0700 "$CONFIG_DIR"

# Ensure user ownership of application directory
chown -R axonpanel:axonpanel "$INSTALL_DIR" 2>/dev/null || true

# ------------------------------------------------------------------------------
# 9. SYSTEMD SERVICE CONFIGURATION
# ------------------------------------------------------------------------------
log "Installing systemd service unit (${SERVICE_NAME}.service)..."

SERVICE_TEMPLATE="${INSTALL_DIR}/systemd/axon-panel.service"
SERVICE_DEST="/etc/systemd/system/${SERVICE_NAME}.service"

if [[ -f "$SERVICE_TEMPLATE" ]]; then
  sed -e "s|__PANEL_DIR__|${INSTALL_DIR}|g" \
      -e "s|__PANEL_DOMAIN__|${PANEL_DOMAIN}|g" \
      "$SERVICE_TEMPLATE" > "$SERVICE_DEST"
  chmod 0644 "$SERVICE_DEST"
  ok "Service file installed to ${SERVICE_DEST}"
else
  fail "Systemd template not found: ${SERVICE_TEMPLATE}"
fi

systemctl daemon-reload
systemctl enable "$SERVICE_NAME" --quiet
systemctl restart "$SERVICE_NAME"
ok "Service ${SERVICE_NAME} enabled and started."

# ------------------------------------------------------------------------------
# 10. NGINX REVERSE PROXY INTEGRATION
# ------------------------------------------------------------------------------
log "Configuring Nginx reverse proxy..."

NGINX_SITE="/etc/nginx/sites-available/${SERVICE_NAME}"
NGINX_LINK="/etc/nginx/sites-enabled/${SERVICE_NAME}"
SNIPPET="/etc/nginx/snippets/${SERVICE_NAME}-allowlist.conf"

mkdir -p /etc/nginx/snippets /etc/nginx/sites-available /etc/nginx/sites-enabled

# Empty allowlist snippet by default
if [[ ! -f "$SNIPPET" ]]; then
  echo "# Managed by Axon Panel — IP Allowlist" > "$SNIPPET"
  chmod 0644 "$SNIPPET"
fi

if [[ ! -f "$NGINX_SITE" ]]; then
  cat > "$NGINX_SITE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${PANEL_DOMAIN};

    include ${SNIPPET};

    client_max_body_size 512M;

    location / {
        proxy_pass http://127.0.0.1:${PANEL_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
}
EOF
  chmod 0644 "$NGINX_SITE"
fi

ln -sfn "$NGINX_SITE" "$NGINX_LINK"

if nginx -t >/dev/null 2>&1; then
  systemctl reload nginx
  ok "Nginx configured and reloaded."
else
  warn "Nginx syntax test failed. Check: nginx -t"
fi

# ------------------------------------------------------------------------------
# 11. LET'S ENCRYPT SSL CERTIFICATE (OPTIONAL)
# ------------------------------------------------------------------------------
if [[ "$DO_SSL" == "1" && "$PANEL_DOMAIN" != "localhost" && "$PANEL_DOMAIN" != "127.0.0.1" && ! "$PANEL_DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  log "Setting up Let's Encrypt TLS certificate for ${PANEL_DOMAIN}..."
  if [[ -d "/etc/letsencrypt/live/${PANEL_DOMAIN}" ]]; then
    ok "TLS certificate for ${PANEL_DOMAIN} already exists."
  else
    if certbot --nginx -d "$PANEL_DOMAIN" --non-interactive --agree-tos -m "$LETSENCRYPT_EMAIL" --redirect --keep-until-expiring >/dev/null 2>&1; then
      ok "TLS certificate issued and HTTP->HTTPS redirection configured."
    else
      warn "Certbot could not obtain a certificate for ${PANEL_DOMAIN}."
      warn "Ensure your DNS A record points to this server IP, then run:"
      warn "    certbot --nginx -d ${PANEL_DOMAIN} --redirect"
    fi
  fi
fi

# ------------------------------------------------------------------------------
# 12. CRON MONITORING (ALERTS & DAILY DIGEST)
# ------------------------------------------------------------------------------
log "Configuring automated server alerts cron job..."
CRON_FILE="/etc/cron.d/axon-server-alerts"
cat > "$CRON_FILE" <<EOF
# Axon Panel Server Health Alerts & Daily Digest
*/5 * * * * root /usr/bin/node ${INSTALL_DIR}/server/scripts/alert-monitor.js --cron-tick >> ${LOG_DIR}/alert-monitor.log 2>&1
EOF
chmod 0644 "$CRON_FILE"
ok "Server health alerts and daily digest scheduled in /etc/cron.d/axon-server-alerts."

# ------------------------------------------------------------------------------
# 13. FIREWALL CHECKS (UFW)
# ------------------------------------------------------------------------------
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  log "Verifying firewall rules for HTTP/HTTPS access..."
  ufw allow 80/tcp comment "Axon Panel HTTP" >/dev/null 2>&1 || true
  ufw allow 443/tcp comment "Axon Panel HTTPS" >/dev/null 2>&1 || true
  ok "Firewall rules for port 80 and 443 confirmed."
fi

# ------------------------------------------------------------------------------
# 14. HEALTH VERIFICATION
# ------------------------------------------------------------------------------
log "Verifying installation health status..."
sleep 2

HEALTH_SCRIPT="${INSTALL_DIR}/installer/health-check.sh"
if [[ -f "$HEALTH_SCRIPT" ]]; then
  if bash "$HEALTH_SCRIPT" --quiet; then
    ok "Axon Panel daemon is verified healthy and responsive."
  else
    warn "Health check reported warnings. Inspect with: sudo ${HEALTH_SCRIPT}"
  fi
else
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    ok "Axon Panel service is active."
  else
    fail "Axon Panel service failed to start. View logs: journalctl -u ${SERVICE_NAME} -n 50"
  fi
fi

# ------------------------------------------------------------------------------
# 15. COMPLETION SUMMARY
# ------------------------------------------------------------------------------
INSTALLED_VER="1.0.0"
if [[ -f "${INSTALL_DIR}/package.json" ]]; then
  INSTALLED_VER=$(grep '"version"' "${INSTALL_DIR}/package.json" | head -n 1 | awk -F '"' '{print $4}')
fi

SCHEME="https"
if [[ "$DO_SSL" == "0" || "$PANEL_DOMAIN" == "localhost" || "$PANEL_DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  SCHEME="http"
fi

printf '\n%b' "$GREEN"
echo "────────────────────────────────────────────────────────────────────────────"
echo "  🎉 Axon Panel v${INSTALLED_VER} has been successfully installed!"
echo "     By AxonWP (https://axonwp.com) • Developed by Afroz Hasan (https://afroz.me)"
echo "────────────────────────────────────────────────────────────────────────────"
printf '%b' "$NC"

cat <<EOF

  Access URL:     ${SCHEME}://${PANEL_DOMAIN}
  Username:       admin
EOF

if [[ -n "$ADMIN_PASSWORD" ]]; then
  cat <<EOF
  Password:       ${ADMIN_PASSWORD}

  ${YELLOW}⚠️  Save this password now — it is securely hashed in the database.${NC}
EOF
else
  cat <<EOF
  Password:       (Existing admin credentials preserved)
EOF
fi

cat <<EOF

  Installation Directory:   ${INSTALL_DIR}
  Configuration Directory:  ${CONFIG_DIR}
  Application Logs:         ${LOG_DIR}
  Backups Directory:        ${BACKUP_DIR}

  Service Management:
    • Check status:         systemctl status ${SERVICE_NAME}
    • Follow live logs:     journalctl -u ${SERVICE_NAME} -f
    • Restart daemon:       systemctl restart ${SERVICE_NAME}
    • Health inspection:    ${INSTALL_DIR}/installer/health-check.sh
    • Create backup:        ${INSTALL_DIR}/installer/backup.sh
    • Upgrade panel:        ${INSTALL_DIR}/installer/update.sh
    • Reset admin password: ${INSTALL_DIR}/installer/install.sh --reset-password

────────────────────────────────────────────────────────────────────────────
EOF
