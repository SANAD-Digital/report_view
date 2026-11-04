// The report's filters read back as short items (the trial layouts, ADR-025): the chips of
// layout A (components/filter_chips.js) and the sentence of layout C
// (components/filter_sentence.js) both show them, and both open the same editor. Nothing here
// changes how a filter works: every filter stays the Frappe control of criteria.js /
// report_filters.js, and its editor is that very control, moved into a popover while it is
// open and put back where it was after.

import { open_popover, close_popover, menu_content } from "../components/popover.js";
import { icons } from "../components/icons.js";
import { esc, fmt_int } from "../util.js";

const is_empty = (v) => v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length);

function user_date(d) {
	try {
		return d ? frappe.datetime.str_to_user(d) : "";
	} catch {
		return String(d || "");
	}
}

/**
 * The text of a filter's value, as short as a chip needs: a date in the user's format, a
 * list as its one value or its count, a tick as «Yes».
 * @param {object} df the filter's definition
 * @param {*} value
 */
export function value_text(df, value) {
	if (is_empty(value)) return "";
	const type = df?.fieldtype || "";
	if (Array.isArray(value)) {
		if (type === "DateRange" && value.length === 2) return `${user_date(value[0])} – ${user_date(value[1])}`;
		const items = value.map((v) => (v && typeof v === "object" ? v.value ?? v.name ?? "" : v)).filter((v) => !is_empty(v));
		if (!items.length) return "";
		return items.length === 1 ? String(items[0]) : __("{0} selected", [fmt_int(items.length)]);
	}
	if (type === "Check") return value ? __("Yes") : __("No");
	if (type === "Date") return user_date(value);
	if (type === "Select") return __(String(value));
	return String(value);
}

/**
 * The items the head shows, in the order of the criteria bar: the company, the period, the
 * other filters of the bar, then those behind «More options» that hold a value (a tick only
 * when it is not the report's default).
 * @param {import("./criteria.js").CriteriaBar} criteria
 * @returns {Array<{key: string, kind: "period"|"filter", label: string, text: string, fieldname?: string, reqd?: boolean, from?: string, to?: string}>}
 */
export function filter_items(criteria) {
	if (!criteria) return [];
	const plan = criteria.plan;
	const f = criteria.filters;
	const out = [];
	const control_item = (c) => {
		const df = c.df;
		const label = __(df.label, null, df.parent);
		return { key: df.fieldname, kind: "filter", fieldname: df.fieldname, label, text: value_text(df, c.get_value()), reqd: Boolean(df.reqd) };
	};
	const visible = (c) => !c.df.hidden_due_to_dependency;
	const main = f.controls.filter((c) => plan.place.get(c.df.fieldname) === "main" && visible(c));
	const company = main.find((c) => c.df.fieldname === plan.keys.company_key);
	if (company) out.push(control_item(company));
	if (plan.has_period) {
		const p = criteria.period_values();
		out.push({
			key: "__period",
			kind: "period",
			label: __("Period"),
			text: p.from && p.to ? `${user_date(p.from)} – ${user_date(p.to)}` : "",
			from: p.from ? user_date(p.from) : "",
			to: p.to ? user_date(p.to) : "",
		});
	}
	for (const c of main) if (c !== company) out.push(control_item(c));
	for (const c of f.controls) {
		if (plan.place.get(c.df.fieldname) !== "more" || !visible(c)) continue;
		const v = c.get_value();
		if (is_empty(v) || v === 0) continue;
		if (c.df.fieldtype === "Check" && String(v) === String(c.df.default ?? "")) continue;
		out.push(control_item(c));
	}
	return out;
}

/** Whether the report has filters behind «More options» (the «+ Filter» item). */
export function has_more(criteria) {
	return addable_controls(criteria).length > 0 || option_controls(criteria).length > 0;
}

/** A control's wrap, moved into `box` while a popover is open and put back where it was after. */
function borrow(wrap, box) {
	const home = { parent: wrap.parentNode, next: wrap.nextSibling };
	box.append(wrap);
	return () => {
		if (home.parent) home.parent.insertBefore(wrap, home.next && home.next.parentNode === home.parent ? home.next : null);
	};
}

const is_more = (criteria, c) => criteria.plan.place.get(c.df.fieldname) === "more" && !c.df.hidden_due_to_dependency;

/** The filters behind «More options» that hold no value yet: what «+ Filter» offers to add. */
export function addable_controls(criteria) {
	if (!criteria) return [];
	return criteria.filters.controls.filter((c) => is_more(criteria, c) && c.df.fieldtype !== "Check" && is_empty(c.get_value()));
}

/** The report's options (its Check filters behind «More options»): one column of boxes. */
export function option_controls(criteria) {
	if (!criteria) return [];
	return criteria.filters.controls.filter((c) => is_more(criteria, c) && c.df.fieldtype === "Check");
}

/**
 * The editor of one filter, under its chip: that filter's own control in a small popover,
 * with Clear and Apply. The control is the live one (its value is the report's at once);
 * Apply closes the popover, Clear empties a filter that may be empty.
 */
function open_single({ root, criteria, fieldname, label, anchor }) {
	const c = criteria.filters.get_filter(fieldname);
	const wrap = criteria.filters.wraps.get(fieldname);
	if (!c || !wrap) return null;
	const box = document.createElement("div");
	box.className = "rv-fedit";
	const body = document.createElement("div");
	body.className = "rv-fedit-bd";
	const give_back = borrow(wrap, body);
	const foot = document.createElement("div");
	foot.className = "rv-fedit-ft";
	const may_clear = !c.df.reqd && c.df.fieldtype !== "Check";
	foot.innerHTML = `${may_clear ? `<button type="button" class="btn btn-default btn-sm" data-act="clear">${esc(__("Clear", null, "Report View"))}</button>` : ""}<button type="button" class="btn btn-primary btn-sm" data-act="apply">${esc(__("Apply", null, "Report View"))}</button>`;
	box.append(body, foot);
	const pop = open_popover({ root, anchor, content: box, cls: "rv-filter-pop", width: 280, label, on_close: give_back });
	foot.querySelector('[data-act="apply"]').addEventListener("click", () => pop.close());
	foot.querySelector('[data-act="clear"]')?.addEventListener("click", async () => {
		await c.set_value(Array.isArray(c.get_value()) ? [] : "");
		pop.close();
	});
	body.querySelector("input:not([type=hidden]), select, .form-control")?.focus();
	return pop;
}

/** «More options»: the report's check-box options, in one column. */
export function open_options({ root, criteria, anchor }) {
	const controls = option_controls(criteria);
	if (!controls.length) return null;
	const box = document.createElement("div");
	box.className = "rv-fedit rv-fopts";
	const body = document.createElement("div");
	body.className = "rv-fedit-bd";
	const backs = controls.map((c) => borrow(criteria.filters.wraps.get(c.df.fieldname), body));
	box.append(body);
	const pop = open_popover({ root, anchor, content: box, cls: "rv-filter-pop", width: 320, label: __("More options"), on_close: () => backs.reverse().forEach((f) => f()) });
	body.querySelector("input")?.focus();
	return pop;
}

/**
 * «+ Filter»: the filters that may still be added, one per line (each opens its own editor
 * under the same chip), then «More options…» for the report's check-box options.
 */
function open_add_menu({ root, criteria, anchor }) {
	const items = addable_controls(criteria).map((c) => ({
		key: c.df.fieldname,
		label: __(c.df.label, null, c.df.parent),
		act: () => open_single({ root, criteria, fieldname: c.df.fieldname, label: __(c.df.label, null, c.df.parent), anchor }),
	}));
	if (option_controls(criteria).length) {
		if (items.length) items.push({ sep: true });
		items.push({ key: "__options", label: __("More options…"), icon: icons.funnel(15), act: () => open_options({ root, criteria, anchor }) });
	}
	if (!items.length) return null;
	// the editor opens in place of the menu, under the same chip
	const wrapped = items.map((it) => (it.sep ? it : { ...it, act: () => (close_popover(), it.act()) }));
	const content = menu_content(wrapped, __("Add a filter"));
	const pop = open_popover({ root, anchor, content, width: 240, role: "menu", label: __("Add a filter") });
	content.querySelector(".rv-mi:not(:disabled)")?.focus();
	return pop;
}

/**
 * Opens the editor of an item under `anchor`: the period picker for the period, the add menu
 * for «+ Filter» (item null), else that filter's own control in a small popover.
 * @param {object} o {root, criteria, item (null: «+ Filter»), anchor}
 */
export function open_filter_editor({ root, criteria, item, anchor }) {
	if (!criteria) return null;
	if (!item) return open_add_menu({ root, criteria, anchor });
	if (item.kind === "period") {
		criteria.period?.open(anchor);
		return null;
	}
	return open_single({ root, criteria, fieldname: item.fieldname, label: item.label, anchor });
}

/** The markup of an item's value, for a chip or the sentence (escaped). */
export function item_value_html(item) {
	return item.text ? `<bdi>${esc(item.text)}</bdi>` : `<span class="rv-unset">${esc(__("Not set"))}</span>`;
}
