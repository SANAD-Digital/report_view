// The site the scripts of tests/site run against: RV_SITE (https://your.site), never a
// default, so no server name lives in the repository. On a development machine it sits
// next to the passwords in the env file:
//   set -a; . ~/.config/report_view/test-users.env; set +a
module.exports = function site() {
	const value = (process.env.RV_SITE || "").replace(/\/+$/, "");
	if (!value) throw new Error("Set RV_SITE to the site to test (https://your.site), e.g. in ~/.config/report_view/test-users.env.");
	return value;
};
