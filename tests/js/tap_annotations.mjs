// CI helper (not a test): reads the TAP output of `node --test` and prints one GitHub
// annotation per failing test, with the error's first lines, so a failure is readable
// without a sign-in. Usage: node tests/js/tap_annotations.mjs node-test.tap
import fs from "node:fs";

const lines = fs.readFileSync(process.argv[2], "utf8").split("\n");
// GitHub's workflow commands: %, CR and LF are escaped in the message
const esc = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
let count = 0;
for (let i = 0; i < lines.length; i++) {
	const m = /^\s*not ok \d+ - (.*)$/.exec(lines[i]);
	if (!m) continue;
	const detail = [];
	for (let j = i + 1; j < lines.length && !/^\s*(not ok|ok) \d+/.test(lines[j]) && detail.length < 25; j++) {
		const t = lines[j].trim();
		if (t && t !== "---" && t !== "...") detail.push(t);
	}
	console.log(`::error title=${esc(m[1]).replace(/[:,]/g, " ")}::${esc(detail.join("\n"))}`);
	count++;
}
if (!count) console.log("::error title=node --test::failed with no failing test in the TAP output (a file that does not load?)");
