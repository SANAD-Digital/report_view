#!/usr/bin/env bash
# Installs the Chromium of Report View's PDF agent (ADR-016): a pinned Chrome for Testing
# "chrome-headless-shell" build, in <bench>/chromium-rv, where report_view/core/pdf.py
# looks for it (or set "report_view_chromium_path" in common_site_config.json).
#
# Idempotent: when the pinned version is already there it only checks it and prints the
# system packages it needs. Another version is replaced only with --force.
#
#   apps/report_view/scripts/install_chromium.sh [--bench DIR] [--dir DIR] [--force]
#
#   --bench DIR  the bench folder (default: three levels above this script)
#   --dir DIR    install folder (default: <bench>/chromium-rv)
#   --force      replace a different version that is already installed
set -euo pipefail

VERSION="153.0.8010.12"
URL="https://storage.googleapis.com/chrome-for-testing-public/${VERSION}/linux64/chrome-headless-shell-linux64.zip"
ZIP_SHA256="a9da028861a0cf789ff25c2fed45f5f1aaf969ed9247835b6a7821a4f7af9d1d"
BIN_SHA256="ded93a9c9a53a1ae040f08124badcca95c938e9d5015ff340c3b5538c41bf39e"
SUBDIR="chrome-headless-shell-linux64"
BINARY="chrome-headless-shell"
# what deb.deps of this build lists (the first of each alternative), and fonts for Arabic
APT_PACKAGES="ca-certificates fonts-liberation fonts-noto-core libasound2t64 libatk-bridge2.0-0t64 \
libatk1.0-0t64 libatspi2.0-0t64 libc6 libcairo2 libcups2t64 libcurl4t64 libdbus-1-3 libexpat1 libgbm1 \
libglib2.0-0t64 libgtk-3-0t64 libnspr4 libnss3 libpango-1.0-0 libudev1 libvulkan1 libx11-6 libxcb1 \
libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bench="$(cd "${script_dir}/../../.." && pwd)"
target=""
force=0

while [ $# -gt 0 ]; do
	case "$1" in
		--bench) bench="$(cd "$2" && pwd)"; shift 2 ;;
		--dir) target="$2"; shift 2 ;;
		--force) force=1; shift ;;
		-h|--help) sed -n '2,15p' "$0"; exit 0 ;;
		*) echo "Unknown option: $1" >&2; exit 2 ;;
	esac
done
target="${target:-${bench}/chromium-rv}"
binary="${target}/${SUBDIR}/${BINARY}"

say() { printf '%s\n' "$*"; }
fail() { printf 'install_chromium: %s\n' "$*" >&2; exit 1; }

print_packages() {
	say ""
	say "System packages Chromium needs (Debian/Ubuntu; on releases before Ubuntu 24.04 drop the 't64' suffixes):"
	say "  sudo apt-get install -y ${APT_PACKAGES}"
	if [ -f "${target}/${SUBDIR}/deb.deps" ]; then
		say "The build's own list: ${target}/${SUBDIR}/deb.deps"
	fi
}

check_binary() {
	# $1: the binary; prints its version, fails when it does not run
	local out
	if ! out="$("$1" --version 2>&1)"; then
		say "${out}" >&2
		print_packages
		fail "${1} does not run: install the system packages above"
	fi
	say "${out}"
}

sha256() { sha256sum "$1" | cut -d' ' -f1; }

[ "$(uname -s)" = "Linux" ] || fail "only Linux is supported"
[ "$(uname -m)" = "x86_64" ] || fail "Chrome for Testing has no linux build for $(uname -m)"
command -v sha256sum >/dev/null || fail "sha256sum is required"

if [ -x "${binary}" ]; then
	if [ "$(sha256 "${binary}")" = "${BIN_SHA256}" ]; then
		say "Report View Chromium ${VERSION} is already installed in ${target}"
		check_binary "${binary}"
		print_packages
		exit 0
	fi
	if [ "${force}" != 1 ]; then
		say "A different Chromium is installed in ${target}:"
		"${binary}" --version 2>&1 || true
		fail "run again with --force to replace it with ${VERSION}"
	fi
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/rv-cft-install.XXXXXX")"
trap 'rm -rf "${work}"' EXIT

say "Downloading Chrome for Testing headless shell ${VERSION}"
if command -v curl >/dev/null; then
	curl -fsSL --show-error --retry 3 -o "${work}/chs.zip" "${URL}"
elif command -v wget >/dev/null; then
	wget -q -O "${work}/chs.zip" "${URL}"
else
	fail "curl or wget is required"
fi
[ "$(sha256 "${work}/chs.zip")" = "${ZIP_SHA256}" ] || fail "the download's SHA-256 does not match ${ZIP_SHA256}"

mkdir -p "${work}/new"
if command -v unzip >/dev/null; then
	unzip -q "${work}/chs.zip" -d "${work}/new"
else
	python3 -I -m zipfile -e "${work}/chs.zip" "${work}/new"
fi
new_binary="${work}/new/${SUBDIR}/${BINARY}"
[ -f "${new_binary}" ] || fail "the archive has no ${SUBDIR}/${BINARY}"
[ "$(sha256 "${new_binary}")" = "${BIN_SHA256}" ] || fail "the binary's SHA-256 does not match ${BIN_SHA256}"
# python's zipfile keeps no modes
chmod 0755 "${new_binary}" "${work}/new/${SUBDIR}"/*.so* 2>/dev/null || true
check_binary "${new_binary}"

# swap in place: the old folder is removed only once the new one is there
mkdir -p "$(dirname "${target}")"
if [ -e "${target}" ]; then
	mv "${target}" "${work}/old"
fi
mv "${work}/new" "${target}"
say "Installed in ${target}"
say "Binary: ${binary}"
print_packages
