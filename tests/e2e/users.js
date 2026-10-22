// Development-only test users created by scripts/setup_test_users.py.
// Passwords never live in the repository: each one is read from
// RV_<NAME>_PASSWORD (RV_ADMIN_PASSWORD, RV_ACCOUNTANT_PASSWORD, ...), the same
// variables setup_test_users.py uses. On the dev server they are kept in
// ~/.config/report_view/test-users.env (chmod 600):
//   set -a; . ~/.config/report_view/test-users.env; set +a
const DOMAIN = "rv.test";

const USERNAMES = ["rv_admin", "rv_accountant", "rv_restricted", "rv_noexport", "rv_none"];

function password_var(username) {
	return `RV_${username.replace(/^rv_/, "").toUpperCase()}_PASSWORD`;
}

const missing = USERNAMES.map(password_var).filter((name) => !process.env[name]);
if (missing.length) {
	throw new Error(
		`Missing test-user passwords: ${missing.join(", ")}. ` +
			"Source ~/.config/report_view/test-users.env first (set -a; . <file>; set +a).",
	);
}

module.exports = USERNAMES.map((username) => ({
	username,
	email: `${username}@${DOMAIN}`,
	password: process.env[password_var(username)],
}));
