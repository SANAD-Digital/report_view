// Report View Settings (ADR-023): what a report shows in Report View and the JSON its look
// depends on. A new record starts from the report's shipped file; the effective settings
// (the shipped file with this record over it, as the server merges them) are shown below.

const RVS_PREVIEW_MS = 400;

frappe.ui.form.on("Report View Settings", {
	onload(frm) {
		// opened from Report View's menu (or with a report chosen): the shipped values first
		if (frm.is_new() && frm.doc.report && !frm.__rvs_loaded) rvs_load(frm, "shipped_values", false);
	},

	refresh(frm) {
		frm.set_query("row_details_print_format", () => ({ filters: { print_format_for: "Custom", disabled: 0 } }));
		frm.add_custom_button(__("Load from shipped defaults"), () => rvs_load(frm, "shipped_values", true), __("Shipped file"));
		frm.add_custom_button(__("Reset to shipped"), () => rvs_load(frm, "reset_values", true), __("Shipped file"));
		if (frm.doc.report && !frm.is_new()) {
			frm.add_custom_button(__("Open in Report View"), () => frappe.set_route("report-view", frm.doc.report));
		}
		rvs_preview(frm);
	},

	report(frm) {
		if (frm.is_new() && frm.doc.report) rvs_load(frm, "shipped_values", false);
		else rvs_preview(frm);
	},
});

// Every other field: the preview follows what is typed (after a pause).
frappe.ui.form.on("Report View Settings", Object.fromEntries(
	(frappe.get_meta?.("Report View Settings")?.fields || []).map((df) => [df.fieldname, (frm) => rvs_schedule(frm)])
));

function rvs_schedule(frm) {
	clearTimeout(frm.__rvs_timer);
	frm.__rvs_timer = setTimeout(() => rvs_preview(frm), RVS_PREVIEW_MS);
}

async function rvs_load(frm, method, ask) {
	if (!frm.doc.report) {
		frappe.msgprint(__("Choose the report first"));
		return;
	}
	const go = async () => {
		frm.__rvs_loaded = true;
		const args = { report_name: frm.doc.report };
		const r = method === "reset_values"
			? await frappe.xcall("report_view.api.settings.reset_values", args, "GET")
			: await frappe.xcall("report_view.api.settings.shipped_values", args, "GET");
		for (const [field, value] of Object.entries(r.values)) {
			if (frm.fields_dict[field]) await frm.set_value(field, value);
		}
		if (method === "shipped_values" && !r.shipped && ask) {
			frappe.show_alert({ message: __("This report ships no settings file: the defaults are empty"), indicator: "orange" });
		}
		rvs_preview(frm);
	};
	if (!ask) return go();
	const text = method === "shipped_values"
		? __("Replace the values of this form with the report's shipped file?")
		: __("Clear the JSON parts and the default view, and set every tool as the shipped file has it?");
	frappe.confirm(text, go);
}

async function rvs_preview(frm) {
	const field = frm.get_field("effective_settings");
	if (!field?.$wrapper) return;
	const esc = frappe.utils.escape_html;
	if (!frm.doc.report) {
		field.$wrapper.html(`<p class="text-muted small">${esc(__("Choose the report to see its effective settings"))}</p>`);
		return;
	}
	const token = (frm.__rvs_token = (frm.__rvs_token || 0) + 1);
	let r;
	try {
		r = await frappe.xcall("report_view.api.settings.preview", { report_name: frm.doc.report, doc: JSON.stringify(frm.doc) }, "POST");
	} catch {
		return;
	}
	if (token !== frm.__rvs_token) return;
	const s = r.settings;
	const off = Object.entries(s.features).filter(([k, v]) => k !== "chart_types" && v === false).map(([k]) => k);
	const pills = off.length
		? off.map((k) => `<span class="indicator-pill gray">${esc(__(frappe.meta.get_label("Report View Settings", k) || k))}</span>`).join(" ")
		: `<span class="indicator-pill green">${esc(__("Every tool is on"))}</span>`;
	const error = r.error ? `<p><span class="indicator-pill red">${esc(r.error)}</span></p>` : "";
	field.$wrapper.html(`<div class="rvs-effective">
		${error}
		<p class="small">${esc(__("Turned off:"))} ${pills}</p>
		<pre class="small" dir="ltr" style="text-align: left; max-height: 480px; overflow: auto;">${esc(JSON.stringify(s, null, 1))}</pre>
	</div>`);
}
