// The library of letter head styles (ADR-030): every style belongs to a family the gallery
// shows, every family has styles, and every style gives a layout the builder accepts.
import { test } from "node:test";
import assert from "node:assert/strict";
import "./_json.mjs";

const { PRESETS, FAMILIES, build_preset } = await import("../../report_view/public/js/report_view/letterhead/presets.js");
const { clamp_layout } = await import("../../report_view/public/js/report_view/letterhead/model.js");

test("every style is in a family, every family has styles, no two styles share an id", () => {
	const families = new Set(FAMILIES.map((f) => f.id));
	assert.equal(families.size, FAMILIES.length);
	const ids = PRESETS.map((p) => p.id);
	assert.equal(new Set(ids).size, ids.length);
	for (const p of PRESETS) assert.ok(families.has(p.family), `${p.id}: family «${p.family}»`);
	for (const f of FAMILIES) assert.ok(PRESETS.some((p) => p.family === f.id), `family «${f.id}» has no style`);
});

test("every style has its own design (no style falls back to the classic one) and keeps as the builder clamps it", () => {
	const classic = JSON.stringify(build_preset("classic"));
	for (const p of PRESETS) {
		const layout = build_preset(p.id);
		if (p.id !== "classic") assert.notEqual(JSON.stringify(layout), classic, `${p.id} is drawn as «classic»`);
		assert.deepEqual(clamp_layout(structuredClone(layout)), layout, p.id);
	}
});
