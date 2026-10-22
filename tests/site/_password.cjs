// Passwords of the test users come from the environment only, never from the repository.
// On the dev server they are in ~/.config/report_view/test-users.env (chmod 600):
//   set -a; . ~/.config/report_view/test-users.env; set +a
// `name` is the variable that overrides it (RV_PW for an RV_USER of your own); `fallback`
// is the env-file variable of the script's default user (RV_ACCOUNTANT_PASSWORD, ...).
module.exports = function password(name, fallback) {
	const value = process.env[name] || (fallback && process.env[fallback]);
	if (!value) {
		throw new Error(`Set ${name}${fallback ? ` or ${fallback}` : ""} (source ~/.config/report_view/test-users.env).`);
	}
	return value;
};
