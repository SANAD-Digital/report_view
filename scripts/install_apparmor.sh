#!/usr/bin/env bash
# Lets the Chromium of Report View's PDF engine (ADR-016) start its own sandbox on Ubuntu
# 23.10+ (kernel.apparmor_restrict_unprivileged_userns = 1): installs the AppArmor profile
# scripts/apparmor/report-view-chromium for the bench's binary and loads it. Needs root.
# core/pdf.py notices within ten minutes (or at the next restart) and stops passing
# --no-sandbox; Report View Global Settings -> PDF engine shows "sandbox: on".
#
#   sudo apps/report_view/scripts/install_apparmor.sh [--bench DIR] [--binary PATH] [--remove]
#
#   --bench DIR    the bench folder (default: three levels above this script)
#   --binary PATH  the Chromium to allow (default: <bench>/chromium-rv/chrome-headless-shell-linux64/chrome-headless-shell)
#   --remove       unload and delete the profile
#
# Run it again after moving the bench or the binary: the profile names its real path.
set -euo pipefail

NAME="report-view-chromium"
TARGET="/etc/apparmor.d/${NAME}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
template="${script_dir}/apparmor/${NAME}"
bench="$(cd "${script_dir}/../../.." && pwd)"
binary=""
remove=0

while [ $# -gt 0 ]; do
	case "$1" in
		--bench) bench="$(cd "$2" && pwd)"; shift 2 ;;
		--binary) binary="$2"; shift 2 ;;
		--remove) remove=1; shift ;;
		-h|--help) sed -n '2,15p' "$0"; exit 0 ;;
		*) echo "Unknown option: $1" >&2; exit 2 ;;
	esac
done

say() { printf '%s\n' "$*"; }
fail() { printf 'install_apparmor: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "needs root: sudo $0 $*"
command -v apparmor_parser >/dev/null || fail "apparmor_parser is missing (apt-get install apparmor)"

if [ "${remove}" = 1 ]; then
	if [ -f "${TARGET}" ]; then
		apparmor_parser -R "${TARGET}" 2>/dev/null || true
		rm -f "${TARGET}"
		say "Removed ${TARGET}"
	else
		say "No ${TARGET}: nothing to remove"
	fi
	exit 0
fi

restrict=/proc/sys/kernel/apparmor_restrict_unprivileged_userns
if [ ! -r "${restrict}" ] || [ "$(cat "${restrict}")" != 1 ]; then
	say "This kernel does not restrict user namespaces (${restrict} is not 1): Chromium's sandbox needs no profile."
	exit 0
fi

[ -f "${template}" ] || fail "missing ${template}"
binary="${binary:-${bench}/chromium-rv/chrome-headless-shell-linux64/chrome-headless-shell}"
[ -x "${binary}" ] || fail "no Chromium at ${binary}: run scripts/install_chromium.sh first (as the bench user)"
# AppArmor matches the resolved path of what is executed
binary="$(readlink -f "${binary}")"
case "${binary}" in
	*'"'*|*$'\n'*|*'@{'*) fail "the path ${binary} cannot be written into a profile" ;;
esac

profile="$(<"${template}")"
profile="${profile//@@RV_CHROMIUM@@/${binary}}"
tmp="$(mktemp "${TARGET}.XXXXXX")"
trap 'rm -f "${tmp}"' EXIT
printf '%s\n' "${profile}" >"${tmp}"
# check it before it replaces anything
apparmor_parser -Q -K "${tmp}" >/dev/null || fail "apparmor_parser refused the profile"
chmod 0644 "${tmp}"
mv "${tmp}" "${TARGET}"
trap - EXIT
apparmor_parser -r "${TARGET}"
say "Loaded ${TARGET} for ${binary}"

# the same check core/pdf.py makes, as the binary's owner (the bench user)
owner="$(stat -c %U "${binary}")"
work="$(runuser -u "${owner}" -- mktemp -d)"
if out="$(runuser -u "${owner}" -- "${binary}" --headless --disable-gpu --disable-dev-shm-usage \
	--no-first-run --user-data-dir="${work}" --dump-dom 'data:text/html,<p>rv-sandbox-ok</p>' 2>&1)" \
	&& [[ "${out}" == *rv-sandbox-ok* ]]; then
	say "Chromium's sandbox starts for ${owner}: PDFs drop --no-sandbox within ten minutes (or at the next restart)."
else
	say "${out}" | tail -5 >&2
	rm -rf "${work}"
	fail "Chromium's sandbox still does not start"
fi
rm -rf "${work}"
