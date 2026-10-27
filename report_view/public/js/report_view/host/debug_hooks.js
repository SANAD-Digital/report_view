// Read-only views of the page's engine state for the Playwright harness and for a developer
// in the console (window.cur_page… / the tests' window.rv_page): totals, the pivot shown, the
// engine handles still open. Methods of ReportViewPage (installed by index.js).

import { dispose_engine, debug_handles } from "../engine/perspective_engine.js";

export class DebugHooks {
	// Raw values read by the Playwright test: totals of the current view.
	debug_totals() {
		return this.opened ? { mode: this.result.mode, totals: this.opened.expected.totals } : null;
	}

	// What the pivot shows (read by the Playwright tests).
	debug_pivot() {
		const o = this.pivot_opened;
		if (!o) return null;
		return {
			rows: o.post.rows,
			cols: o.post.cols,
			values: o.post.values.map((v) => ({ key: v.key, agg: v.agg, name: v.name })),
			column_paths: o.column_paths,
			body_rows: o.body_rows,
			total: o.total,
			blocked: o.post.blocked,
			shown: this.pivot.current === o && Boolean(this.pivot.rt),
		};
	}

	// Views and tables not deleted yet (development counter, §8أ.3).
	debug_handles() {
		return debug_handles();
	}

	// What the idle timer does a minute after the page was left: used by the tests.
	debug_dispose_engine() {
		return dispose_engine();
	}
}
