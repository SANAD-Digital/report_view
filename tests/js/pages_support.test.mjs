// Helpers of the Pages view (views/pages/support.js): the bounded cache of languages, letter
// heads and formats; the {0} arguments of a translated message; the page numbers a letter
// head's footer carries (the builder's empty .page / .topage spans, ADR-018).
import { test } from "node:test";
import assert from "node:assert/strict";
import "./_json.mjs";

globalThis.frappe ||= {
	utils: { escape_html: (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`) },
	format: (v) => Number(v).toLocaleString("en-US"),
};

const { Lru, format_msg, page_spans } = await import("../../report_view/public/js/report_view/views/pages/support.js");

test("Lru keeps its most recently used entries; peek does not make one recent", () => {
	const lru = new Lru(2);
	lru.set("a", 1).set("b", 2);
	assert.equal(lru.get("a"), 1);
	lru.set("c", 3);
	assert.deepEqual([...lru.keys()], ["a", "c"]);
	assert.equal(lru.peek("a"), 1);
	lru.set("d", 4);
	assert.deepEqual([...lru.keys()], ["c", "d"]);
	assert.equal(lru.get("gone"), undefined);
});

test("format_msg fills {0}, {1}; a missing argument stays as written", () => {
	assert.equal(format_msg("Page {0} of {1}", ["2", "9"]), "Page 2 of 9");
	assert.equal(format_msg("{0} and {2}", ["x"]), "x and {2}");
});

test("page_spans numbers the footer's own spans, formatted; other HTML is left alone", () => {
	const html = 'p. <span class="page"></span> / <span class="topage"></span>';
	assert.equal(page_spans(html, 3, 1200), 'p. <span class="page">3</span> / <span class="topage">1,200</span>');
	assert.equal(page_spans("<b>no numbers</b>", 1, 2), "<b>no numbers</b>");
});

test("a print format's selectors are held to the sheets: html, :root and body stand for them", async () => {
	const { scope_selector } = await import("../../report_view/public/js/report_view/views/pages/support.js");
	const S = ".s";
	assert.equal(scope_selector("body", S), ".s");
	assert.equal(scope_selector("html", S), ".s");
	assert.equal(scope_selector(":root", S), ".s");
	assert.equal(scope_selector("html body .x", S), ".s .x");
	assert.equal(scope_selector("body.rtl .y", S), ".s.rtl .y");
	assert.equal(scope_selector("body > div", S), ".s > div");
	assert.equal(scope_selector(".print-format td", S), ".s .print-format td");
	assert.equal(scope_selector("table > tr", S), ".s table > tr");
	// a word that only starts like body is not body
	assert.equal(scope_selector("bodyx", S), ".s bodyx");
});
