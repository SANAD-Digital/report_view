// Calendar logic of the period picker (docs/architecture.md §11.1 #17-#22): presets, fiscal
// periods, the days of a month. Pure module, dates as "YYYY-MM-DD" strings read in UTC.
// It chooses which dates the report runs on; it computes nothing of the report.

export function pad(n) {
	return String(n).padStart(2, "0");
}

export function iso(y, m, d) {
	return `${y}-${pad(m + 1)}-${pad(d)}`;
}

/** {y, m (0-11), d} of a "YYYY-MM-DD" string. */
export function parse_iso(x) {
	const [y, m, d] = String(x).split("-").map(Number);
	return { y, m: m - 1, d };
}

export function is_iso(x) {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(x || ""));
	if (!m) return false;
	const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
	return t.getUTCFullYear() === +m[1] && t.getUTCMonth() === +m[2] - 1 && t.getUTCDate() === +m[3];
}

/** [year, month] of month `m` of year `y`, with m out of 0-11 carried over. */
export function ym(y, m) {
	const k = y * 12 + m;
	return [Math.floor(k / 12), ((k % 12) + 12) % 12];
}

export function days_in_month(y, m) {
	return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

/** Last day of a month. */
export function eom(y, m) {
	const [yy, mm] = ym(y, m);
	return iso(yy, mm, days_in_month(yy, mm));
}

export function add_days(x, n) {
	const p = parse_iso(x);
	return new Date(Date.UTC(p.y, p.m, p.d + n)).toISOString().slice(0, 10);
}

/** Days from `a` to `b`, both included. */
export function days_between(a, b) {
	return Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;
}

/** Weekday 0-6 (Sunday = 0). */
export function weekday(x) {
	const p = parse_iso(x);
	return new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay();
}

/** The fiscal year that holds a date, from [{name, from, to}] (sorted or not). */
export function fiscal_year_of(fiscal_years, date) {
	return (fiscal_years || []).find((fy) => fy.from <= date && date <= fy.to) || null;
}

/**
 * Presets of the design (Main.dc.html presetList), with the fiscal years of the company
 * when they are known (else calendar years).
 * @param {string} today "YYYY-MM-DD"
 * @param {object} opts {first_day: 0-6, fiscal_years: [{name, from, to}], label: (text) => text}
 * @returns {Array<{id, label, from, to}|{sep: true}>}
 */
export function preset_list(today, { first_day = 0, fiscal_years = [], label = (t) => t } = {}) {
	const { y, m } = parse_iso(today);
	const back = (weekday(today) - first_day + 7) % 7;
	const q = Math.floor(m / 3) * 3;
	const lm = ym(y, m - 1);
	const lqs = ym(y, q - 3);
	const s6 = ym(y, m - 5);
	const fy = fiscal_year_of(fiscal_years, today);
	const year = fy ? [fy.from, fy.to] : [iso(y, 0, 1), iso(y, 11, 31)];
	const prev_fy = fy ? fiscal_year_of(fiscal_years, add_days(fy.from, -1)) : null;
	const last_year = prev_fy ? [prev_fy.from, prev_fy.to] : [iso(y - 1, 0, 1), iso(y - 1, 11, 31)];
	const item = (id, text, from, to) => ({ id, label: label(text), from, to });
	return [
		item("today", "Today", today, today),
		item("yesterday", "Yesterday", add_days(today, -1), add_days(today, -1)),
		item("last_7", "Last 7 days", add_days(today, -6), today),
		item("last_30", "Last 30 days", add_days(today, -29), today),
		item("week", "This week", add_days(today, -back), add_days(today, 6 - back)),
		{ sep: true },
		item("month", "This month", iso(y, m, 1), eom(y, m)),
		item("last_month", "Last month", iso(lm[0], lm[1], 1), eom(lm[0], lm[1])),
		item("last_6_months", "Last 6 months", iso(s6[0], s6[1], 1), eom(y, m)),
		item("quarter", "This quarter", iso(y, q, 1), eom(y, q + 2)),
		item("last_quarter", "Last quarter", iso(lqs[0], lqs[1], 1), eom(lqs[0], lqs[1] + 2)),
		{ sep: true },
		item("year_to_date", "Year to date", year[0], today < year[1] ? today : year[1]),
		item("fiscal_year", "Current fiscal year", year[0], year[1]),
		item("last_year", "Last fiscal year", last_year[0], last_year[1]),
	];
}

// Parts of a fiscal year (Main.dc.html FPS): month offsets from its first month.
export const FISCAL_PARTS = [
	{ id: "full", short: "Full", name: "Fiscal year", range: [0, 11] },
	{ id: "q1", short: "Q1", name: "First quarter", range: [0, 2] },
	{ id: "q2", short: "Q2", name: "Second quarter", range: [3, 5] },
	{ id: "q3", short: "Q3", name: "Third quarter", range: [6, 8] },
	{ id: "q4", short: "Q4", name: "Fourth quarter", range: [9, 11] },
	{ id: "h1", short: "H1", name: "First half", range: [0, 5] },
	{ id: "h2", short: "H2", name: "Second half", range: [6, 11] },
];

/**
 * Dates of months m0..m1 (offsets 0-11) of a fiscal year, clipped to the fiscal year (a year
 * that does not start on the first of a month keeps its own first and last day).
 */
export function fiscal_range(fy, m0, m1) {
	const s = parse_iso(fy.from);
	const a = ym(s.y, s.m + m0);
	const b = ym(s.y, s.m + m1);
	const from = m0 === 0 ? fy.from : iso(a[0], a[1], 1);
	const end = eom(b[0], b[1]);
	return [from, end > fy.to || m1 === 11 ? fy.to : end];
}

/** The fiscal part (months m0..m1) a range is, or null. */
export function fiscal_part_of(fy, from, to) {
	for (let m0 = 0; m0 < 12; m0++) {
		for (let m1 = m0; m1 < 12; m1++) {
			const [f, t] = fiscal_range(fy, m0, m1);
			if (f === from && t === to) return { m0, m1 };
		}
	}
	return null;
}

/**
 * Cells of a month grid: null for the blanks before the first day, then the dates.
 * @param {number} first_day 0-6, the first column of the week
 */
export function month_cells(y, m, first_day = 0) {
	const blanks = (new Date(Date.UTC(y, m, 1)).getUTCDay() - first_day + 7) % 7;
	const out = Array.from({ length: blanks }, () => null);
	for (let d = 1; d <= days_in_month(y, m); d++) out.push(iso(y, m, d));
	return out;
}

/** Weekday indexes (0-6) of the columns, starting with `first_day`. */
export function week_columns(first_day = 0) {
	return Array.from({ length: 7 }, (_, i) => (first_day + i) % 7);
}
