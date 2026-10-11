// The "Period" field of the criteria bar and its popover (docs/architecture.md §11.1 #17-#22,
// design: reference/design/screens/date.png): presets, a date range on two months, or a part
// of a fiscal year; the number of days; Apply / Cancel. Enter in a field commits its date,
// elsewhere it applies; Escape closes
// (components/popover.js). It writes the report's own filters (from / to date, fiscal year)
// through the page; the report then runs as before.

import { icons } from "../components/icons.js";
import { open_popover, close_popover } from "../components/popover.js";
import {
	preset_list,
	FISCAL_PARTS,
	fiscal_range,
	fiscal_part_of,
	fiscal_year_of,
	month_cells,
	week_columns,
	days_between,
	parse_iso,
	is_iso,
	iso,
	ym,
} from "./periods.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function esc(s) {
	return frappe.utils.escape_html(String(s ?? ""));
}

function user_date(d) {
	return d ? frappe.datetime.str_to_user(d) : "";
}

// A date typed in the user's format, as "YYYY-MM-DD", or null.
function parse_user_date(text) {
	const value = String(text || "").trim();
	if (!value) return null;
	try {
		const out = frappe.datetime.user_to_str(value);
		return is_iso(out) ? out : null;
	} catch {
		return null;
	}
}

let fiscal_years_cache = null;

// Fiscal years the user may read (frappe.client.get_list applies the permissions).
function load_fiscal_years() {
	if (!fiscal_years_cache) {
		fiscal_years_cache = Promise.resolve(
			frappe.db.get_list("Fiscal Year", {
				fields: ["name", "year_start_date", "year_end_date"],
				order_by: "year_start_date asc",
				limit: 200,
			})
		)
			.then((rows) =>
				(rows || [])
					.filter((r) => is_iso(r.year_start_date) && is_iso(r.year_end_date))
					.map((r) => ({ name: r.name, from: r.year_start_date, to: r.year_end_date }))
			)
			.catch(() => []);
	}
	return fiscal_years_cache;
}

export class PeriodPicker {
	/**
	 * @param {object} o
	 * @param {HTMLElement} o.root the .rv element (popovers)
	 * @param {HTMLElement} o.parent where the field goes
	 * @param {() => {from: string, to: string, fiscal_year: string|null}} o.get current filter values
	 * @param {(p: {from, to, fiscal_year}) => void} o.on_apply
	 */
	constructor({ root, parent, get, on_apply }) {
		this.root = root;
		this.get = get;
		this.on_apply = on_apply;
		this.fiscal_years = [];
		this.tag = null;
		this.first_day = Number(frappe.datetime.get_first_day_of_the_week_index?.() || 0) || 0;
		const field = document.createElement("div");
		field.className = "rv-field rv-period";
		field.innerHTML = `<span class="rv-field-lbl">${esc(__("Period"))}</span>
			<button type="button" class="rv-datefield" aria-haspopup="dialog" aria-label="${esc(__("Choose the period"))}">
				${icons.calendar()}<span class="ltr"></span><span class="rv-date-tag"></span>${icons.chevron_down()}
			</button>`;
		parent.appendChild(field);
		this.el = field;
		this.button = field.querySelector(".rv-datefield");
		this.button.addEventListener("click", () => (this.popover ? close_popover() : this.open()));
		load_fiscal_years().then((list) => {
			this.fiscal_years = list;
			this.refresh();
		});
	}

	today() {
		return frappe.datetime.get_today();
	}

	presets() {
		return preset_list(this.today(), { first_day: this.first_day, fiscal_years: this.fiscal_years, label: (t) => __(t, null, "Report View") });
	}

	fy_label(fy, m0, m1) {
		const part = FISCAL_PARTS.find((p) => p.range[0] === m0 && p.range[1] === m1);
		if (part) return `${__(part.name)} ${fy.name}`;
		return __("Months {0}–{1} · {2}", [m0 + 1, m1 + 1, fy.name]);
	}

	/** Text of the period and its tag: a preset, the fiscal part chosen, or "Custom period". */
	describe(from, to) {
		if (this.tag && this.tag.from === from && this.tag.to === to) return this.tag.label;
		const preset = this.presets().find((p) => !p.sep && p.from === from && p.to === to);
		if (preset) return preset.label;
		return __("Custom period");
	}

	refresh() {
		const { from, to } = this.get();
		this.button.querySelector(".ltr").textContent = from && to ? `${user_date(from)} – ${user_date(to)}` : "—";
		const tag = this.button.querySelector(".rv-date-tag");
		tag.textContent = from && to ? this.describe(from, to) : "";
		tag.hidden = !(from && to);
	}

	// ------------------------------------------------------------ popover

	open() {
		const { from, to, fiscal_year } = this.get();
		const today = this.today();
		const start = from || today;
		const end = to || start;
		const fy =
			this.fiscal_years.find((f) => f.name === fiscal_year) ||
			fiscal_year_of(this.fiscal_years, start) ||
			this.calendar_year(parse_iso(start).y);
		const part = fiscal_part_of(fy, start, end);
		const tagged = this.tag && this.tag.from === start && this.tag.to === end;
		const p = parse_iso(start);
		this.dp = {
			mode: tagged && part ? "fiscal" : "range",
			from: start,
			to: end,
			hover: null,
			view: p.y * 12 + p.m,
			fy,
			m0: part ? part.m0 : 0,
			m1: part ? part.m1 : 11,
			month_pick: false,
		};
		const content = document.createElement("div");
		content.className = "dp-wrap";
		this.content = content;
		// Enter in a date field commits the typed date (the calendars follow it, the other
		// end is still to pick); Enter anywhere else in the picker applies.
		content.addEventListener("keydown", (e) => {
			if (e.key !== "Enter" || e.target.closest("button")) return;
			e.preventDefault();
			const input = e.target.closest("[data-input]");
			if (input) {
				if (parse_user_date(input.value)) this.typed(input.dataset.input, input.value);
				return;
			}
			this.apply();
		});
		this.render();
		this.popover = open_popover({
			root: this.root,
			anchor: this.button,
			content,
			cls: "dp",
			width: 880,
			label: __("Choose the period"),
			on_close: () => {
				this.popover = null;
				this.button.classList.remove("on");
			},
		});
		this.button.classList.add("on");
		(content.querySelector(".dp-pre.on") || content.querySelector(".dp-pre"))?.focus();
	}

	// Calendar years stand in for fiscal years when none can be read.
	calendar_year(y) {
		return { name: String(y), from: iso(y, 0, 1), to: iso(y, 11, 31), calendar: true };
	}

	fiscal_list() {
		if (this.fiscal_years.length) return this.fiscal_years;
		const y = parse_iso(this.today()).y;
		return [y - 3, y - 2, y - 1, y, y + 1].map((n) => this.calendar_year(n));
	}

	set(o) {
		Object.assign(this.dp, o);
		this.render();
	}

	set_fiscal(o) {
		const dp = Object.assign(this.dp, o, { mode: "fiscal", hover: null });
		const [from, to] = fiscal_range(dp.fy, dp.m0, dp.m1);
		const p = parse_iso(from);
		Object.assign(dp, { from, to, view: p.y * 12 + p.m });
		this.render();
	}

	pick(day) {
		const dp = this.dp;
		if (dp.to || !dp.from) this.set({ from: day, to: null, hover: null, mode: "range" });
		else if (day < dp.from) this.set({ from: day, to: dp.from, hover: null });
		else this.set({ to: day, hover: null });
	}

	render() {
		const dp = this.dp;
		const fiscal = dp.mode === "fiscal";
		const end = dp.to || dp.from;
		const presets = this.presets()
			.map((p) =>
				p.sep
					? '<div class="dp-pre-sep"></div>'
					: `<button type="button" class="dp-pre${dp.to && p.from === dp.from && p.to === dp.to ? " on" : ""}" data-from="${p.from}" data-to="${p.to}">${esc(p.label)}</button>`
			)
			.join("");
		this.content.innerHTML = `
			<div class="dp-presets">${presets}</div>
			<div class="dp-main">
				<div class="dp-mode">
					<div class="rv-seg" role="tablist" aria-label="${esc(__("Kind of period"))}">
						<button type="button" role="tab" data-mode="range" class="${fiscal ? "" : "on"}" aria-selected="${!fiscal}">${icons.calendar(14)}${esc(__("Date range"))}</button>
						<button type="button" role="tab" data-mode="fiscal" class="${fiscal ? "on" : ""}" aria-selected="${fiscal}">${icons.fiscal()}${esc(__("Fiscal period"))}</button>
					</div>
				</div>
				${fiscal ? this.fiscal_html() : this.range_html()}
				<div class="dp-ft">
					<span class="dp-rng">${__("From {0} to {1}", [`<bdi class="ltr">${esc(user_date(dp.from))}</bdi>`, `<bdi class="ltr">${esc(user_date(end))}</bdi>`])}</span>
					${!dp.to && !fiscal ? `<span class="dp-hint">${esc(__("Pick the end date"))}</span>` : ""}
					<span class="sp"></span>
					<span class="dp-days">${esc(__("{0} days", [days_between(dp.from, end)]))}</span>
					<button type="button" class="rv-btn" data-action="cancel">${esc(__("Cancel"))}</button>
					<button type="button" class="rv-btn primary" data-action="apply">${esc(__("Apply", null, "Report View"))}</button>
				</div>
			</div>`;
		this.bind();
		if (!fiscal) this.paint();
		this.popover?.place();
	}

	range_html() {
		const dp = this.dp;
		const ph = esc(frappe.datetime.get_user_date_fmt?.() || "dd-mm-yyyy");
		const months = [0, 1]
			.map((k) => {
				const v = dp.view + k;
				const y = Math.floor(v / 12);
				const m = ((v % 12) + 12) % 12;
				const cells = month_cells(y, m, this.first_day)
					.map((d) =>
						d
							? `<button type="button" class="dp-d" data-day="${d}" aria-label="${esc(user_date(d))}">${parse_iso(d).d}</button>`
							: '<span class="dp-d blank"></span>'
					)
					.join("");
				const wd = week_columns(this.first_day)
					.map((i) => `<span class="dp-wd">${esc(__(WEEKDAYS[i]))}</span>`)
					.join("");
				return `<div class="dp-cal">
					<div class="dp-cal-hd">
						<button type="button" class="dp-nav rv-flip${k === 0 ? "" : " ph"}" data-nav="-1" aria-label="${esc(__("Previous month"))}">${icons.chevron_start()}</button>
						<b>${esc(__(MONTHS[m]))} <bdi class="ltr">${y}</bdi></b>
						<button type="button" class="dp-nav rv-flip${k === 1 ? "" : " ph"}" data-nav="1" aria-label="${esc(__("Next month"))}">${icons.chevron_end()}</button>
					</div>
					<div class="dp-grid">${wd}${cells}</div>
				</div>`;
			})
			.join("");
		return `
			<div class="dp-inputs">
				<label class="dp-in"><span>${esc(__("From"))}</span><input type="text" inputmode="numeric" data-input="from" aria-label="${esc(__("From date"))}" placeholder="${ph}" value="${esc(user_date(dp.from))}"></label>
				<span class="dp-arrow rv-flip">${icons.arrow_end()}</span>
				<label class="dp-in${dp.to ? "" : " on"}"><span>${esc(__("To"))}</span><input type="text" inputmode="numeric" data-input="to" aria-label="${esc(__("To date"))}" placeholder="${ph}" value="${esc(user_date(dp.to))}"></label>
			</div>
			<div class="dp-cals">${months}</div>`;
	}

	fiscal_html() {
		const dp = this.dp;
		const list = this.fiscal_list();
		const at = list.findIndex((f) => f.name === dp.fy.name);
		const start = parse_iso(dp.fy.from);
		const parts = FISCAL_PARTS.map(
			(p) =>
				`<button type="button" data-part="${p.id}" title="${esc(__(p.name))}" class="${p.range[0] === dp.m0 && p.range[1] === dp.m1 ? "on" : ""}">${esc(__(p.short, null, "Report View"))}</button>`
		).join("");
		const bars = Array.from({ length: 12 }, (_, i) => {
			const [yy, mm] = ym(start.y, start.m + i);
			const on = i >= dp.m0 && i <= dp.m1;
			const title = `${__(MONTHS[mm])} ${yy}`;
			return `<button type="button" class="dp-mb${on ? " on" : ""}${dp.month_pick && i === dp.m0 ? " anchor" : ""}" data-month="${i}" title="${esc(title)}" aria-label="${esc(title)}"><i></i><span>${i + 1}</span><small>${esc(__(MONTHS_SHORT[mm]))}</small></button>`;
		}).join("");
		const note = dp.month_pick
			? __("Click another month to pick a range of months, or Apply for one month")
			: __("{0} · {1} months · click the months to pick a custom range", [this.fy_label(dp.fy, dp.m0, dp.m1), dp.m1 - dp.m0 + 1]);
		return `
			<div class="dp-fy">
				<div class="dp-fy-row"><span class="dp-fy-l">${esc(__("Fiscal Year"))}</span>
					<div class="dp-step">
						<button type="button" class="dp-nav rv-flip" data-fy="-1" aria-label="${esc(__("Previous year"))}" ${at <= 0 ? "disabled" : ""}>${icons.chevron_start()}</button>
						<b class="ltr">${esc(dp.fy.name)}</b>
						<button type="button" class="dp-nav rv-flip" data-fy="1" aria-label="${esc(__("Next year"))}" ${at < 0 || at >= list.length - 1 ? "disabled" : ""}>${icons.chevron_end()}</button>
					</div>
				</div>
				<div class="dp-fy-row"><span class="dp-fy-l">${esc(__("Starts in"))}</span>
					<div class="dp-step"><b>${esc(__(MONTHS[start.m]))}</b></div>
					<span class="dp-fy-hint">${esc(__("From the fiscal year settings of the company"))}</span>
				</div>
				<div class="dp-fy-row"><span class="dp-fy-l">${esc(__("Period"))}</span><div class="rv-seg">${parts}</div></div>
				<div class="dp-fy-row top"><span class="dp-fy-l">${esc(__("Months", null, "Report View"))}</span><div class="dp-months">${bars}</div></div>
				<p class="dp-fy-note">${esc(note)}</p>
			</div>`;
	}

	// Classes of the days of the range (start, end, inside, preview while the end is picked).
	paint() {
		const dp = this.dp;
		const today = this.today();
		const preview = !dp.to;
		const lo = dp.from;
		const hi = dp.to || (dp.hover && dp.hover >= dp.from ? dp.hover : null);
		for (const b of this.content.querySelectorAll(".dp-d[data-day]")) {
			const id = b.dataset.day;
			let c = "dp-d";
			if (id === lo) c += " s";
			if (dp.to && id === dp.to) c += " e";
			else if (preview && hi && id === hi && id !== lo) c += " pe";
			if (hi && id > lo && id < hi) c += preview ? " pv" : " in";
			if (id === today) c += " t";
			if (b.className !== c) b.className = c;
		}
	}

	bind() {
		const c = this.content;
		const dp = this.dp;
		for (const b of c.querySelectorAll(".dp-pre")) {
			b.addEventListener("click", () => {
				const p = parse_iso(b.dataset.from);
				this.set({ mode: "range", from: b.dataset.from, to: b.dataset.to, hover: null, view: p.y * 12 + p.m });
			});
		}
		for (const b of c.querySelectorAll("[data-mode]")) {
			b.addEventListener("click", () => (b.dataset.mode === "fiscal" ? this.set_fiscal({}) : this.set({ mode: "range" })));
		}
		for (const b of c.querySelectorAll("[data-nav]")) {
			b.addEventListener("click", () => this.set({ view: dp.view + Number(b.dataset.nav) }));
		}
		const days = c.querySelector(".dp-cals");
		if (days) {
			days.addEventListener("click", (e) => {
				const b = e.target.closest(".dp-d[data-day]");
				if (b) this.pick(b.dataset.day);
			});
			days.addEventListener("mouseover", (e) => {
				const b = e.target.closest(".dp-d[data-day]");
				if (!b || dp.to || dp.hover === b.dataset.day) return;
				dp.hover = b.dataset.day;
				this.paint();
			});
			days.addEventListener("mouseleave", () => {
				if (!dp.hover) return;
				dp.hover = null;
				this.paint();
			});
		}
		for (const input of c.querySelectorAll("[data-input]")) {
			input.addEventListener("change", () => this.typed(input.dataset.input, input.value));
		}
		for (const b of c.querySelectorAll("[data-fy]")) {
			b.addEventListener("click", () => {
				const list = this.fiscal_list();
				const at = list.findIndex((f) => f.name === dp.fy.name) + Number(b.dataset.fy);
				if (list[at]) this.set_fiscal({ fy: list[at] });
			});
		}
		for (const b of c.querySelectorAll("[data-part]")) {
			b.addEventListener("click", () => {
				const p = FISCAL_PARTS.find((x) => x.id === b.dataset.part);
				this.set_fiscal({ m0: p.range[0], m1: p.range[1], month_pick: false });
			});
		}
		for (const b of c.querySelectorAll("[data-month]")) {
			b.addEventListener("click", () => {
				const i = Number(b.dataset.month);
				if (!dp.month_pick) this.set_fiscal({ m0: i, m1: i, month_pick: true });
				else this.set_fiscal({ m0: Math.min(dp.m0, i), m1: Math.max(dp.m0, i), month_pick: false });
			});
		}
		c.querySelector('[data-action="cancel"]').addEventListener("click", () => close_popover());
		c.querySelector('[data-action="apply"]').addEventListener("click", () => this.apply());
	}

	// A date typed in one of the two inputs.
	typed(which, text) {
		const dp = this.dp;
		const value = parse_user_date(text);
		if (!value) {
			this.render();
			return;
		}
		if (which === "from") {
			const p = parse_iso(value);
			const to = dp.to && dp.to < value ? value : dp.to;
			this.set({ mode: "range", from: value, to, view: p.y * 12 + p.m });
		} else if (value < dp.from) {
			this.set({ mode: "range", from: value, to: dp.from });
		} else {
			this.set({ mode: "range", to: value });
		}
	}

	apply() {
		const dp = this.dp;
		const from = dp.from;
		const to = dp.to || dp.from;
		const fiscal = dp.mode === "fiscal";
		this.tag = fiscal ? { from, to, label: this.fy_label(dp.fy, dp.m0, dp.m1) } : null;
		const fy = fiscal && !dp.fy.calendar ? dp.fy : fiscal_year_of(this.fiscal_years, from);
		close_popover();
		this.on_apply({ from, to, fiscal_year: fy ? fy.name : null });
		this.refresh();
	}
}
