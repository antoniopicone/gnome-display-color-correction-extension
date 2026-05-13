#!/usr/bin/env bash
set -euo pipefail

B='\033[1;34m'; G='\033[1;32m'; Y='\033[1;33m'; NC='\033[0m'
info() { printf "${B}==> ${NC}%s\n" "$*"; }
ok()   { printf "${G}==> OK: ${NC}%s\n" "$*"; }
warn() { printf "${Y}==> WARN: ${NC}%s\n" "$*"; }

UUID="display-color-correct@antoniopicone.it"
EXT_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

info "Installing to ${EXT_DIR}..."
mkdir -p "${EXT_DIR}/schemas"

cp "${REPO_DIR}/metadata.json" "${EXT_DIR}/"
cp "${REPO_DIR}/extension.js"  "${EXT_DIR}/"
cp "${REPO_DIR}/prefs.js"      "${EXT_DIR}/"
cp "${REPO_DIR}/schemas/"*.xml "${EXT_DIR}/schemas/"

glib-compile-schemas "${EXT_DIR}/schemas/"
ok "Schema compiled."

info "Enabling extension..."
gnome-extensions enable "${UUID}" 2>/dev/null || \
    warn "Could not enable automatically. After logout/login, enable 'Display Color Correction' in Extension Manager."

ok "Done. Defaults: R_sat=0.73  G_sat=0.90  B_sat=0.93"
