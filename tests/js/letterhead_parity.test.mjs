// The editor and the print draw a letter head alike (ADR-018 «عقد HTML»): the six styles of
// the gallery and a fixture of every element type and option, drawn by render.js with a
// company's values, are written to report_view/tests/fixtures/letterhead_parity.json; the
// Python test (report_view/tests/test_letterhead.py, TestRendererParity) draws the same
// layouts with core/letterhead.py and compares them element by element. Run this test again
// after changing render.js, model.js or the contract: the file changes with them.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./_json.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.join(HERE, "..", "..", "report_view");
const GOLDEN = path.join(PKG, "tests", "fixtures", "letterhead_parity.json");

const { set_font_registry } = await import("../../report_view/public/js/report_view/fonts.js");
set_font_registry(JSON.parse(fs.readFileSync(path.join(PKG, "fonts.json"), "utf8")));
const { render_band, qr_texts } = await import("../../report_view/public/js/report_view/letterhead/render.js");
const { PRESETS, build_preset } = await import("../../report_view/public/js/report_view/letterhead/presets.js");
const { clamp_layout } = await import("../../report_view/public/js/report_view/letterhead/model.js");

// the company as both sides see it: the values per field (the server reads them from its
// records; the Python test hands it these), its logo, its website for the QR code
const VALUES = {
	company_name: "SND Accounting",
	company_name_ar: "شركة سند للمحاسبة",
	abbr: "SA",
	tax_id: "",
	phone_no: "777 999 579",
	fax: "",
	email: "info@example.com",
	website: "example.com",
	registration_details: "CR 1234\nChamber 99",
	country: "Yemen",
	address: "Hadda St.\nSana'a, Amanat\nYemen",
	address_line1: "Hadda St.",
	city: "Sana'a",
};
const LOGO = "/files/logo.png";

const f = (id, token, patch = {}) => ({ id, type: "field", slot: null, x: 0, y: 0, w: 60, h: 0, ...patch, props: { token, label: "", hide_empty: true, ...(patch.props || {}) } });

/** Every type and option, free and in the slots, with numbers that are not round. */
const EDGE = {
	v: 1,
	font: "Cairo",
	colors: { primary: "#204060", text: "#111111", muted: "#777777" },
	header: {
		h: 40,
		pad_top: 4.5,
		slots: { right: 33.5, center: 25, left: 33.5 },
		elements: [
			{ id: "t1", type: "text", slot: null, x: 7.33, y: 1.25, w: 41.17, h: 6, style: { size: 11.5, weight: 700, color: "primary", align: "start" }, props: { text: "مرحبا بكم\nسطر ثان", dir: "auto" } },
			{ id: "t2", type: "text", slot: null, x: 120, y: 2, w: 55, style: { align: "end" }, props: { text: "Welcome", dir: "ltr" } },
			{ id: "t3", type: "text", slot: null, x: 60, y: 9, w: 60, style: { align: "center" }, props: { text: "Mixed نص", dir: "rtl" } },
			{ id: "t4", type: "text", slot: "right", props: { text: "Est. 1990", dir: "auto" } },
			f("f1", "company_name_ar", { x: 10, y: 14, w: 70, style: { align: "start", size: 14, weight: 600, color: "#AA2200" } }),
			f("f2", "company_name", { x: 100, y: 14, w: 70, style: { align: "end" } }),
			f("f3", "phone_no", { x: 10, y: 20, w: 70, style: { align: "start" }, props: { label: "هاتف:" } }),
			f("f4", "address", { x: 100, y: 20, w: 70, h: 12, style: { align: "start" } }),
			f("f5", "email", { slot: "left" }),
			f("f6", "tax_id", { slot: "right", props: { label: "الرقم الضريبي:", hide_empty: false } }),
			f("f7", "fax", { slot: "right" }),
			f("f8", "registration_details", { slot: "left", style: { gap: 0.6 } }),
			f("f9", "company_name_ar", { x: 60, y: 30, w: 50, style: { align: "center" } }),
			{ id: "l1", type: "logo", slot: null, x: 150.5, y: 3, w: 24, h: 18 },
			{ id: "l2", type: "logo", slot: "center", w: 20, h: 15, style: { gap: 2 } },
			{ id: "i1", type: "image", slot: "center", w: 22, h: 10, props: { src: "/files/stamp.png", fit: "contain" } },
			{ id: "i2", type: "image", slot: null, x: 0, y: 30, w: 30, h: 9, props: { src: "/assets/report_view/x.png", fit: "cover" } },
			{ id: "n1", type: "line", slot: null, x: 0, y: 38, w: 180, style: { color: "primary" }, props: { thick: 0.5, style: "solid" } },
			{ id: "n2", type: "line", slot: "left", w: 40, style: { color: "muted" }, props: { thick: 0.3, style: "dashed" } },
			{ id: "n3", type: "line", slot: null, x: 20, y: 36, w: 140, props: { thick: 0.4, style: "double" } },
			{ id: "b1", type: "band", slot: null, x: 0, y: 0, w: 180, h: 1.5, props: { fill: "primary", radius: 0 } },
			{ id: "b2", type: "band", slot: null, x: 130, y: 25, w: 45, h: 10, props: { fill: "#FFEEDD", radius: 3, corners: "tl,br" } },
			{ id: "b3", type: "band", slot: "center", w: 30, h: 2, props: { fill: "muted", radius: 1 } },
			{ id: "q1", type: "qr", slot: null, x: 85, y: 2, w: 20, h: 16, props: { source: "text", text: "https://example.com/x" } },
			{ id: "q2", type: "qr", slot: "left", w: 14, h: 14, props: { source: "website" } },
		],
	},
	footer: {
		h: 20,
		pad_top: 2,
		slots: { right: 40, center: 20, left: 40 },
		elements: [
			{ id: "p1", type: "page", slot: null, x: 0, y: 12, w: 60, style: { align: "start" }, props: { format: "both" } },
			{ id: "p2", type: "page", slot: "center", props: { format: "ar" } },
			{ id: "p3", type: "page", slot: null, x: 120, y: 12, w: 60, h: 5, style: { align: "end", size: 7.5 }, props: { format: "en" } },
			{ id: "p4", type: "page", slot: "right", props: { format: "en" } },
			f("g1", "website", { slot: "left" }),
		],
	},
};

const CASES = [...PRESETS.map((p) => ({ id: p.id, layout: build_preset(p.id, {}) })), { id: "edge", layout: clamp_layout(EDGE) }];

function draw(layout) {
	const ctx = { values: VALUES, logo: LOGO, qr: {} };
	for (const t of qr_texts(layout, ctx)) ctx.qr[t] = "<svg></svg>";
	return { header: render_band(layout, "header", ctx, { comment: false }), footer: render_band(layout, "footer", ctx, { comment: false }) };
}

test("parity golden: render.js output of the six styles and the edge fixture", () => {
	const cases = CASES.map((c) => ({ id: c.id, layout: c.layout, ...draw(c.layout) }));
	const golden = `${JSON.stringify({ values: VALUES, logo: LOGO, cases }, null, "\t")}\n`;
	const old = fs.existsSync(GOLDEN) ? fs.readFileSync(GOLDEN, "utf8") : "";
	if (old !== golden) fs.writeFileSync(GOLDEN, golden);
	// the fixture really holds every type, free and slotted, and every option
	const els = CASES.at(-1).layout.header.elements.concat(CASES.at(-1).layout.footer.elements);
	for (const type of ["text", "field", "logo", "image", "line", "band", "qr", "page"]) {
		assert.ok(els.some((e) => e.type === type && e.slot === null), `${type} free`);
		assert.ok(els.some((e) => e.type === type && e.slot), `${type} in a slot`);
	}
	for (const c of cases) assert.ok(c.header.includes('data-rv-lh="header"'), c.id);
});

test("an Arabic free element aligns to the right on the screen (the server prints the same)", () => {
	const { header } = draw(build_preset("simple", {}));
	// «simple»: the Arabic name, free, align start
	assert.match(header, /data-el="e2" dir="rtl" style="[^"]*text-align:right"/);
	const edge = draw(clamp_layout(EDGE)).header;
	assert.match(edge, /data-el="f1" dir="rtl" style="[^"]*text-align:right"/);
	assert.match(edge, /data-el="f2" dir="ltr" style="[^"]*text-align:right"/);
	assert.match(edge, /data-el="f3" dir="rtl" style="[^"]*text-align:right"/);
});
