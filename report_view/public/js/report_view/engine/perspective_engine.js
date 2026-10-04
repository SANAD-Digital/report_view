// Perspective engine: loading, handle lifecycle and the tables of one report result
// (docs/architecture.md §8أ.1, §8أ.3; ADR-012). With queries.js, the only module that
// touches Perspective.
//
// Loading: the JS of @finos/perspective is part of the bundle; the two WASM files and the
// worker are static assets of the same origin, and we create the worker ourselves so that
// we own its handle (terminate() is the only way to give WASM memory back).

import perspective from "@finos/perspective";
import { build_table_input, batches, perspective_type, KIND } from "./schema.js";
import { build_nodes, build_facts } from "./tree_nodes.js";
import { build_report_rows } from "./report_rows.js";
import { to_view_config, CURRENCY_COUNT_PREFIX } from "./view_config.js";
import * as queries from "./queries.js";

// Must equal the pinned version in package.json (tests/js/engine.test.mjs checks it): it
// breaks the one-year cache of /assets on upgrade.
export const VERSION = "3.8.0";
export const BASE = "/assets/report_view/node_modules/@finos/perspective/dist";
export const IDLE_MS = 60000;

// ---------------------------------------------------------------- handles

/**
 * Registry of every table and view. Perspective never settles a call on a deleted handle
 * (nor a second delete()), and a table deleted while it has views dies but stays in the
 * engine. So: every handle is registered, delete() goes through the manager only, a call
 * on a deleted handle throws at once, and the views of a table are deleted before it.
 */
export class EngineHandles {
	constructor(client) {
		this.client = client;
		this.entries = new Map();
		this.latest = new Map();
		this.seq = 0;
	}

	_register(kind, raw, name, table) {
		const entry = { kind, raw, name, table, deleted: false, deletion: null, pending: new Set() };
		const proxy = new Proxy(raw, {
			get: (target, prop) => {
				// Promise resolution probes `then` on any value returned from an async function.
				if (prop === "then") return undefined;
				if (typeof prop === "symbol") return target[prop];
				if (entry.deleted) throw new Error(`report_view: ${kind} "${name}" was deleted (${String(prop)})`);
				if (prop === "delete") throw new Error("report_view: delete engine handles through EngineHandles.delete()");
				const value = target[prop];
				if (typeof value !== "function") return value;
				return (...args) => this._track(entry, value.apply(target, args));
			},
		});
		this.entries.set(proxy, entry);
		return proxy;
	}

	// Calls in flight on a handle: its delete waits for them.
	_track(entry, out) {
		if (out && typeof out.then === "function") {
			entry.pending.add(out);
			const done = () => entry.pending.delete(out);
			out.then(done, done);
		}
		return out;
	}

	_entry(handle) {
		const entry = this.entries.get(handle);
		if (!entry) throw new Error("report_view: unknown or already deleted engine handle");
		return entry;
	}

	/** @param {object} schema explicit {column: type}; Perspective never infers types here */
	async table(schema, label = "table") {
		const name = `rv_${++this.seq}_${label}`;
		const raw = await this.client.table(schema, { name });
		return this._register("table", raw, name, null);
	}

	view(table, config, label = "view") {
		const parent = this._entry(table);
		if (parent.deleted) throw new Error(`report_view: table "${parent.name}" was deleted (view)`);
		return this._track(parent, this._create_view(parent, table, config, label));
	}

	async _create_view(parent, table, config, label) {
		const name = `${parent.name}/${label}_${++this.seq}`;
		const raw = await parent.raw.view(config);
		if (parent.deleted) {
			// The table is being deleted: it must not be left with a view nobody owns.
			await raw.delete();
			throw new Error(`report_view: table "${parent.name}" was deleted (view)`);
		}
		return this._register("view", raw, name, table);
	}

	/**
	 * Racing requests for one slot (a setting changes while a view is being built): only the
	 * newest result is returned, an older one is deleted and gives null.
	 */
	async latest_view(slot, table, config, label) {
		const generation = (this.latest.get(slot) || 0) + 1;
		this.latest.set(slot, generation);
		const view = await this.view(table, config, label);
		if (this.latest.get(slot) !== generation) {
			await this.delete(view);
			return null;
		}
		return view;
	}

	is_alive(handle) {
		const entry = this.entries.get(handle);
		return Boolean(entry) && !entry.deleted;
	}

	delete(handle) {
		const entry = this._entry(handle);
		if (entry.deleted) throw new Error(`report_view: ${entry.kind} "${entry.name}" was already deleted`);
		// From here no new call can start on this handle.
		entry.deleted = true;
		entry.deletion = this._delete(handle, entry);
		return entry.deletion;
	}

	async _delete(handle, entry) {
		try {
			// Calls in flight settle first (a view being created on a deleted table deletes itself).
			await Promise.allSettled([...entry.pending]);
			if (entry.kind === "table") {
				for (const [other, e] of [...this.entries]) {
					if (e.table !== handle) continue;
					await (e.deletion || this.delete(other));
				}
			}
			await entry.raw.delete();
		} finally {
			this.entries.delete(handle);
		}
	}

	/** A temporary view (unique values, totals, counts): always deleted in `finally`. */
	async with_view(table, config, fn, label = "temp") {
		const view = await this.view(table, config, label);
		try {
			return await fn(view);
		} finally {
			if (this.is_alive(view)) await this.delete(view);
		}
	}

	async delete_all() {
		for (const kind of ["view", "table"]) {
			for (const [handle, entry] of [...this.entries]) {
				if (entry.kind !== kind) continue;
				await (entry.deletion || this.delete(handle));
			}
		}
	}

	/** The worker is gone: nothing can be deleted any more, every handle is dead. */
	abandon() {
		for (const entry of this.entries.values()) entry.deleted = true;
		this.entries.clear();
	}

	/** Handles not deleted yet (development counter; the lifecycle tests require none). */
	debug_handles() {
		return [...this.entries.values()].filter((e) => !e.deleted).map((e) => ({ kind: e.kind, name: e.name }));
	}
}

// ---------------------------------------------------------------- loading

let wasm_started = false;
let engine = null;
let live = null;
let idle_timer = null;
let unload_hooked = false;
let requests = 0;

function start_wasm() {
	if (wasm_started) return;
	wasm_started = true;
	perspective.init_server(fetch(`${BASE}/wasm/perspective-server.wasm?v=${VERSION}`));
	perspective.init_client(fetch(`${BASE}/wasm/perspective-js.wasm?v=${VERSION}`));
}

/** Starts the WASM download (once per page), in parallel with the first api.run. */
export function warm_up() {
	start_wasm();
}

function terminate_now() {
	const current = live;
	live = null;
	engine = null;
	clearTimeout(idle_timer);
	if (!current) return;
	current.handles.abandon();
	current.client.terminate();
	current.worker.terminate();
}

/**
 * The engine of the page: one worker, one client, one handle manager.
 * @returns {Promise<{client: object, worker: Worker, handles: EngineHandles}>}
 */
export function get_engine() {
	clearTimeout(idle_timer);
	requests += 1;
	if (!engine) {
		start_wasm();
		const worker = new Worker(`${BASE}/cdn/perspective-server.worker.js?v=${VERSION}`, { type: "module" });
		const started = perspective.worker(Promise.resolve(worker)).then(
			(client) => {
				const out = { client, worker, handles: new EngineHandles(client) };
				if (engine === started) live = out;
				return out;
			},
			(error) => {
				if (engine === started) engine = null;
				worker.terminate();
				throw error;
			}
		);
		engine = started;
		if (!unload_hooked) {
			unload_hooked = true;
			window.addEventListener("beforeunload", terminate_now);
		}
	}
	return engine;
}

/** Deletes every view and table, then terminates the client and the worker. */
export async function dispose_engine() {
	clearTimeout(idle_timer);
	if (!engine) return;
	const started = engine;
	const seen = requests;
	let current;
	try {
		current = await started;
	} catch {
		return;
	}
	if (engine !== started || requests !== seen) return;
	await current.handles.delete_all();
	// Not if the page asked for the engine again in the meantime.
	if (engine === started && requests === seen) terminate_now();
}

/** The user left the page: the worker is terminated unless they come back within IDLE_MS. */
export function schedule_dispose(ms = IDLE_MS) {
	clearTimeout(idle_timer);
	if (!engine) return;
	idle_timer = setTimeout(() => dispose_engine(), ms);
}

export function cancel_dispose() {
	clearTimeout(idle_timer);
}

/** True once the worker and the WASM files are loaded (the first load takes a moment). */
export function engine_ready() {
	return live !== null;
}

/** Handles of the running engine that were not deleted (none when no engine is running). */
export function debug_handles() {
	return live ? live.handles.debug_handles() : [];
}

// ---------------------------------------------------------------- one report result

function numeric_totals(values, mixed) {
	const out = {};
	for (const [key, value] of Object.entries(values)) {
		if (typeof value === "number" && Number.isFinite(value) && !mixed[key]) out[key] = value;
	}
	return out;
}

/**
 * The tables of one normalized report and the views opened on them: the facts, and the table
 * of the report "as it came" (nodes of a tree report; rows of a report with summary rows
 * between its facts). Every number a view shows is computed by Perspective, or is the
 * report's own value in the nodes or rows table.
 */
export class ReportSession {
	constructor(handles, normalized, opts = {}) {
		this.handles = handles;
		this.normalized = normalized;
		this.locale = opts.locale;
		this.quick_filters = opts.quick_filters || [];
		this.tables = {};
		this.sizes = {};
		this.level_rids = new Map();
		this.rows_by_rid = new Map(normalized.rows.map((r) => [r.__rid, r]));
		this.slot = `main:${Math.random().toString(36).slice(2)}`;
		this.closed = false;
	}

	static async create(handles, normalized, opts = {}) {
		const session = new ReportSession(handles, normalized, opts);
		try {
			await session.load();
		} catch (e) {
			await session.close();
			throw e;
		}
		return session;
	}

	async _load_table(label, rows, extras) {
		const input = build_table_input(this.normalized.columns, rows, { locale: this.locale, extras });
		const table = await this.handles.table(input.schema, label);
		this.tables[label] = table;
		this.sizes[label] = input.size;
		for (const batch of batches(input.data, input.size)) await table.update(batch);
	}

	async load() {
		if (this.normalized.tree?.enabled) {
			const nodes = build_nodes(this.normalized);
			await this._load_table("nodes", nodes.rows, nodes.extras);
			const facts = build_facts(this.normalized);
			this.level_rids = facts.level_rids;
			await this._load_table("facts", facts.rows, facts.extras);
		} else {
			await this._load_table("facts", this.normalized.facts, []);
			const reported = build_report_rows(this.normalized);
			if (reported) await this._load_table("rows", reported.rows, []);
		}
	}

	_reference_totals(post) {
		const totals = this.normalized.report_totals || {};
		const row = post.total.source === "row" ? this.rows_by_rid.get(post.total.rid) : totals.frappe_total;
		const values = {};
		for (const key of post.measures) {
			const v = row?.[key];
			values[key] = typeof v === "number" && Number.isFinite(v) ? v : null;
		}
		const currencies = {};
		for (const key of post.currency_keys) currencies[key] = row?.[key] || null;
		return { values, currencies, mixed: {} };
	}

	_engine_totals(post, row) {
		const values = {};
		const currencies = {};
		const mixed = {};
		const column_of = new Map(this.normalized.columns.map((c) => [c.key, c]));
		for (const key of post.currency_keys) currencies[key] = row[key] || null;
		for (const key of post.measures) {
			const ck = column_of.get(key)?.currency?.kind === "row" ? column_of.get(key).currency.key : null;
			mixed[key] = Boolean(ck) && !currencies[ck] && (row[CURRENCY_COUNT_PREFIX + ck] || 0) > 1;
			values[key] = mixed[key] ? null : row[key] ?? null;
		}
		return { values, currencies, mixed };
	}

	/**
	 * Opens the main view of a view state.
	 * @returns {Promise<object|null>} null when a newer open() superseded this one.
	 */
	async open(view_state, mode = "grid") {
		const spec = to_view_config(view_state, this.normalized, mode, { quick_filters: this.quick_filters });
		const { post } = spec;
		const table = this.tables[spec.table];
		const view = await this.handles.latest_view(this.slot, table, spec.config, post.shape);
		if (!view) return null;
		try {
			if (post.depth !== null) await queries.set_depth(view, post, this.level_rids);
			const facts = this.tables.facts;
			const [body_rows, structure, totals, fact_rows, groups] = await Promise.all([
				queries.body_rows(view, post),
				queries.row_depths(view, post),
				this._totals(view, post),
				post.fact_filter.length
					? queries.count_rows(this.handles, facts, post.fact_filter, post.filter_expressions)
					: this.sizes.facts,
				this._groups(post),
			]);
			return {
				spec,
				post,
				view,
				body_rows,
				depths: structure.depths,
				paths: structure.paths,
				totals,
				// Rows = the facts of the report (leaves of a tree), everywhere: the status bar
				// and the badge of the grand total. "shown" are the facts that pass the browser
				// filters; folding a group or a parent hides rows but filters nothing.
				counts: { shown: fact_rows, total: this.sizes.facts, facts: fact_rows, groups },
				// What the server compares before it builds a file (§8أ.6): the facts that pass
				// the filters, and the grand total as shown (the report's reference row when it
				// is the one shown, else the engine's total).
				expected: { row_count: fact_rows, totals: numeric_totals(totals.values, totals.mixed) },
			};
		} catch (e) {
			if (this.handles.is_alive(view)) await this.handles.delete(view);
			throw e;
		}
	}

	async _totals(view, post) {
		const source = post.total.source;
		if (source === "row" || source === "frappe_total") return this._reference_totals(post);
		if (source === "row0") return this._engine_totals(post, await queries.read_total_row(view));
		const target = post.total.view;
		const row = await queries.totals(this.handles, this.tables[target.table], target.config);
		return this._engine_totals(post, row);
	}

	/**
	 * Totals of some measures for the summary cards, as the grand total shown has them: the
	 * report's own reference row when it is the grand total (ADR-008), else the engine's
	 * totals of the view; measures that are not columns of the view (hidden) are read from a
	 * temporary totals view of the facts under the same filter, deleted in `finally`.
	 * @returns {Promise<object>} {key: number|null}
	 */
	async summary_totals(opened, keys) {
		const { post } = opened;
		const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
		if (post.total.source === "row" || post.total.source === "frappe_total") {
			const row =
				post.total.source === "row" ? this.rows_by_rid.get(post.total.rid) : this.normalized.report_totals?.frappe_total;
			return Object.fromEntries(keys.map((k) => [k, num(row?.[k])]));
		}
		const shown = opened.totals.values;
		if (keys.every((k) => Object.hasOwn(shown, k))) return Object.fromEntries(keys.map((k) => [k, num(shown[k])]));
		const config = {
			group_by: [KIND],
			columns: keys,
			aggregates: Object.fromEntries(keys.map((k) => [k, "sum"])),
			filter: post.fact_filter,
			expressions: post.filter_expressions || {},
		};
		const row = await queries.totals(this.handles, this.tables.facts, config);
		return Object.fromEntries(keys.map((k) => [k, num(row[k])]));
	}

	async _groups(post) {
		if (!post.groups) return null;
		const table = this.tables[post.groups.table];
		if (post.groups.config) return queries.count_groups(this.handles, table, post.groups.config);
		return queries.count_rows(this.handles, table, post.groups.filter);
	}

	/**
	 * Unique values of a column of the facts with their count, under the browser filters of
	 * the view state other than the column's own (set filter, filter panel). A temporary
	 * view, deleted in `finally`.
	 * @param {object} opts {search, limit}
	 */
	async unique_values(view_state, key, opts = {}) {
		const others = { ...view_state, filters: (view_state.filters || []).filter((f) => f.key !== key) };
		const spec = to_view_config(others, this.normalized, "grid", { quick_filters: this.quick_filters });
		const column = this.normalized.columns.find((c) => c.key === key);
		const string = column ? perspective_type(column.fieldtype) === "string" : true;
		return queries.unique_values(this.handles, this.tables.facts, key, spec.post.fact_filter, {
			...opts,
			string,
			expressions: spec.post.filter_expressions,
		});
	}

	/**
	 * Opens or closes a group of a grouped view.
	 * @returns {Promise<{depths: number[], paths: Array[]}>} the rows of the view after it
	 */
	async toggle_group(opened, view_row, open) {
		await queries.toggle_group(opened.view, opened.post, view_row, open);
		return queries.row_depths(opened.view, opened.post);
	}

	async close_view(opened) {
		if (opened && this.handles.is_alive(opened.view)) await this.handles.delete(opened.view);
	}

	/** Views first, then the tables. */
	async close() {
		this.closed = true;
		for (const table of Object.values(this.tables)) {
			if (this.handles.is_alive(table)) await this.handles.delete(table);
		}
		this.tables = {};
	}
}
