// Development-only test users created by scripts/setup_test_users.py.
// Passwords can be overridden with RV_PW_<USERNAME> environment variables.
const DOMAIN = "rv.test";

const USERS = {
	rv_admin: "***REMOVED***",
	rv_accountant: "***REMOVED***",
	rv_restricted: "***REMOVED***",
	rv_noexport: "***REMOVED***",
	rv_none: "***REMOVED***",
};

module.exports = Object.entries(USERS).map(([username, password]) => ({
	username,
	email: `${username}@${DOMAIN}`,
	password: process.env[`RV_PW_${username.toUpperCase()}`] || password,
}));
