// The letter head drawn from a layout (ADR-018 «عقد HTML», letterhead/render.js) and the six
// styles of the gallery (letterhead/presets.js), with a company's real values.
import { test } from "node:test";
import assert from "node:assert/strict";
import "./_json.mjs";

const { render_band, missing_tokens, qr_texts, is_rtl_text, resolve_color, page_html, esc } = await import("../../report_view/public/js/report_view/letterhead/render.js");
const { PRESETS, build_preset, blank_layout, brand_from_rgb } = await import("../../report_view/public/js/report_view/letterhead/presets.js");
const { clamp_layout, default_layout, LIMITS, REF_W } = await import("../../report_view/public/js/report_view/letterhead/model.js");

const CTX = {
	values: { company_name: "Example Trading", company_name_ar: "شركة المثال للتجارة", phone_no: "555010099", email: "info@example.com", website: "example.com", address: "Sana'a\nYemen", tax_id: "" },
	logo: "/files/logo.png",
	qr: {},
};

const layout_with = (elements, band = {}) => clamp_layout({ header: { h: 35, pad_top: 6, slots: { right: 34, center: 26, left: 34 }, ...band, elements } });

test("band: the ADR structure — comment, root, slots with their directions and places", () => {
	const l = layout_with([{ id: "e1", type: "field", slot: "right", style: { size: 9, weight: 400, color: "muted", gap: 1 }, props: { token: "phone_no", label: "هاتف:" } }]);
	const html = render_band(l, "header", CTX);
	assert.ok(html.startsWith("<!-- rv-lh v1 header h=35 -->"));
	assert.match(html, /<div class="rvlh" data-rv-lh="header" data-h="35" dir="ltr" style="position:relative;width:100%;height:35mm;overflow:hidden;box-sizing:border-box;font-family:'IBM Plex Sans Arabic',sans-serif;color:#17211C;line-height:1.35;-webkit-print-color-adjust:exact;print-color-adjust:exact">/);
	assert.match(html, /<div data-slot="right" dir="rtl" style="position:absolute;top:6mm;right:0;width:34%;padding:0 1mm;box-sizing:border-box;text-align:right">/);
	assert.match(html, /<div data-el="e1" style="font-size:9pt;font-weight:400;color:#5B6660;margin:0 0 1mm">هاتف: <bdi dir="ltr">555010099<\/bdi><\/div>/);
	// empty slots are not written outside the editor
	assert.doesNotMatch(html, /data-slot="left"/);
	// nothing the old printers cannot read
	assert.doesNotMatch(html, /display:\s*(grid|flex)|var\(--|transform|<script/);
});

test("band: center and left slots", () => {
	const l = layout_with([
		{ id: "a", type: "logo", slot: "center", w: 26, h: 22 },
		{ id: "b", type: "field", slot: "left", props: { token: "company_name" } },
	]);
	const html = render_band(l, "header", CTX);
	assert.match(html, /data-slot="center" dir="auto" style="position:absolute;top:6mm;left:50%;margin-left:-13%;width:26%;padding:0 1mm;box-sizing:border-box;text-align:center"/);
	assert.match(html, /<img src="\/files\/logo.png" alt="" style="display:inline-block;vertical-align:top;width:auto;height:auto;max-width:26mm;max-height:22mm">/);
	assert.match(html, /data-slot="left" dir="ltr" style="position:absolute;top:6mm;left:0;width:34%;padding:0 1mm;box-sizing:border-box;text-align:left"/);
});

test("free elements: x and w as percentages of 180mm, y and h in mm", () => {
	const l = layout_with([
		{ id: "e9", type: "line", slot: null, x: 18, y: 28, w: 144, style: { color: "primary" }, props: { thick: 0.6 } },
		{ id: "b1", type: "band", slot: null, x: 0, y: 0, w: 90, h: 12, props: { fill: "#AA0000", radius: 3 } },
		{ id: "t1", type: "text", slot: null, x: 90, y: 4, w: 90, style: { align: "start" }, props: { text: "مرحبا\nسطر" } },
	]);
	const html = render_band(l, "header", CTX);
	assert.match(html, /data-el="e9" style="position:absolute;left:10%;top:28mm;width:80%;line-height:0"><div style="display:inline-block;vertical-align:top;width:100%;height:0;border-top:0.6mm solid #1E5C45">/);
	assert.match(html, /data-el="b1" style="position:absolute;left:0%;top:0mm;width:50%;height:12mm;background-color:#AA0000;border-radius:3mm">/);
	// an Arabic text aligned to its start is aligned right; its line breaks kept
	assert.match(html, /data-el="t1" dir="rtl" style="[^"]*text-align:right">مرحبا<br>سطر<\/div>/);
	assert.ok(html.indexOf('data-el="b1"') > html.indexOf("data-el=\"e9\""), "free elements in their order");
});

test("empty values: hidden when asked, label kept otherwise, a hint in the editor", () => {
	const l = layout_with([
		{ id: "a", type: "field", slot: "right", props: { token: "tax_id", label: "الرقم الضريبي:" } },
		{ id: "b", type: "field", slot: "right", props: { token: "fax", label: "Fax", hide_empty: false } },
	]);
	const html = render_band(l, "header", CTX);
	assert.doesNotMatch(html, /data-el="a"/);
	assert.match(html, /data-el="b"[^>]*>Fax<\/div>/);
	const ed = render_band(l, "header", CTX, { editor: true, hint: (el) => `${el.props.token} — empty`, label: (el) => `Field ${el.props.token}`, selected: "a" });
	assert.match(ed, /data-el="a" class="rvlb-el is-selected" data-type="field" tabindex="0" role="button" aria-label="Field tax_id" aria-pressed="true"/);
	assert.match(ed, /<span class="rvlb-hint">tax_id — empty<\/span>/);
	assert.doesNotMatch(ed, /0000|XXX|123/, "no made-up values");
	assert.deepEqual(missing_tokens(l, CTX), ["tax_id", "fax"]);
});

test("escaping: values, labels and texts never become HTML", () => {
	const l = layout_with([
		{ id: "a", type: "text", slot: "left", props: { text: "<b>x</b> & 'y'" } },
		{ id: "b", type: "field", slot: "left", props: { token: "company_name", label: '<img src=x onerror="1">' } },
	]);
	const html = render_band(l, "header", { values: { company_name: "<script>alert(1)</script>" } });
	assert.doesNotMatch(html, /<b>|<script>|<img src=x/);
	assert.match(html, /&lt;b&gt;x&lt;\/b&gt; &amp; &#39;y&#39;/);
	assert.equal(esc(null), "");
});

test("address on several lines, page numbers, QR", () => {
	const l = clamp_layout({
		header: { elements: [{ id: "a", type: "field", slot: "right", props: { token: "address" } }, { id: "q", type: "qr", slot: "left", w: 16, h: 16, props: { source: "website" } }] },
		footer: { elements: [{ id: "p", type: "page", slot: "center", props: { format: "both" } }] },
	});
	const ctx = { ...CTX, qr: { "example.com": "<svg id=qr></svg>" } };
	const [header, footer] = [render_band(l, "header", ctx), render_band(l, "footer", ctx)];
	assert.match(header, />Sana&#39;a<br>Yemen</);
	assert.match(header, /<span style="display:inline-block;vertical-align:top;width:16mm;height:16mm"><svg id=qr><\/svg><\/span>/);
	assert.match(footer, /<span class="page"><\/span>/);
	assert.match(footer, /<span class="topage"><\/span>/);
	assert.match(page_html("ar", [2, 5]), /صفحة <span class="page">2<\/span> من <span class="topage">5<\/span>/);
	assert.match(page_html("en"), /^<span dir="ltr">Page /);
	assert.match(page_html("both"), /^<span dir="ltr">Page .*<\/span> \| <span dir="rtl">صفحة /, "both = en | ar");
	assert.deepEqual(qr_texts(l, CTX), ["example.com"]);
});

test("images: public files only, cover as a background, never object-fit", () => {
	const l = layout_with([
		{ id: "i1", type: "image", slot: null, x: 0, y: 0, w: 30, h: 20, props: { src: "/files/a.png", fit: "cover" } },
		{ id: "i2", type: "image", slot: "left", w: 30, h: 20, props: { src: "/files/b.png" } },
	]);
	const html = render_band(l, "header", { ...CTX, logo: "/private/files/logo.png" });
	assert.match(html, /background-image:url\('\/files\/a.png'\);background-position:center;background-repeat:no-repeat;-webkit-background-size:cover;background-size:cover/);
	assert.match(html, /<img src="\/files\/b.png" alt="" style="display:inline-block;vertical-align:top;width:auto;height:auto;max-width:30mm;max-height:20mm">/);
	assert.doesNotMatch(html, /object-fit/);
	const logo = render_band(layout_with([{ id: "g", type: "logo", slot: "center" }]), "header", { ...CTX, logo: "/private/files/logo.png" });
	assert.doesNotMatch(logo, /private/, "a private logo is not printed");
});

test("a footer of height 0 is not written", () => {
	const l = clamp_layout({ footer: { h: 0 } });
	assert.equal(render_band(l, "footer", CTX), "");
});

test("helpers: direction and colours", () => {
	assert.equal(is_rtl_text("  123 شركة"), true);
	assert.equal(is_rtl_text("ACME شركة"), false);
	const l = default_layout();
	assert.equal(resolve_color(l, "primary"), "#1E5C45");
	assert.equal(resolve_color(l, "#123456"), "#123456");
	assert.equal(resolve_color(l, "nope"), "#17211C");
});

test("presets: six styles, valid layouts, real data, the last two with free elements", () => {
	assert.equal(PRESETS.length, 6);
	for (const p of PRESETS) {
		const l = build_preset(p.id, { colors: { primary: "#224466" } });
		assert.deepEqual(clamp_layout(l), l, `${p.id} is already clamped`);
		assert.equal(l.colors.primary, "#224466");
		const ids = [...l.header.elements, ...l.footer.elements].map((e) => e.id);
		assert.equal(new Set(ids).size, ids.length, `${p.id}: unique ids`);
		assert.ok(new TextEncoder().encode(JSON.stringify(l)).length < LIMITS.bytes);
		for (const b of ["header", "footer"]) for (const e of l[b].elements) if (e.slot === null) assert.ok(e.x + e.w <= REF_W + 0.01, `${p.id} ${e.id} inside`);
		const html = render_band(l, "header", CTX);
		assert.match(html, /شركة المثال للتجارة|Example Trading/, `${p.id} shows the company`);
		assert.doesNotMatch(html, /الرقم الضريبي/, `${p.id}: the empty tax id is not printed`);
	}
	const free = (id) => build_preset(id).header.elements.filter((e) => e.slot === null && e.type !== "line").length;
	assert.ok(free("corner") >= 2 && free("band_top") >= 2, "the colour shapes are free elements");
	assert.equal(build_preset("classic").header.elements.filter((e) => e.slot === "right")[0].props.token, "company_name_ar");
	assert.equal(build_preset("unknown").header.elements.length, build_preset("classic").header.elements.length);
	assert.equal(blank_layout().header.elements.length, 0);
});

test("brand colour from a logo: greys give none, bright colours are darkened for text", () => {
	assert.equal(brand_from_rgb(128, 128, 130), null);
	const c = brand_from_rgb(60, 200, 120);
	assert.match(c, /^#[0-9A-F]{6}$/);
	const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
	assert.ok(g > r && g > b, "hue kept");
	assert.ok(g < 200, "darkened");
});
