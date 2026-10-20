// A large Excel export runs as a job on the server (report_view.api.export_xlsx answers
// {status: "queued", job, row_count}): the page asks for its state every POLL_MS until it is
// done, then downloads the file once. Pure module: the calls, the clock and the wait are
// injected, so the loop is tested in node.

export const POLL_MS = 1500;
// The page stops waiting after this long; the job itself is the server's.
export const LIMIT_MS = 10 * 60 * 1000;

export class ExportJobError extends Error {
	constructor(reason, message) {
		super(message || reason);
		this.name = "ExportJobError";
		// "failed" (the server's error), "timeout" (the page's limit), "cancelled" (the user)
		this.reason = reason;
	}
}

/**
 * Waits for an export job to finish.
 * @param {string} job the id the server gave
 * @param {object} o
 * @param {(job: string) => Promise<{state: string, row_count?: number, error?: string}>} o.status
 * @param {() => boolean} [o.cancelled] true once the user stopped waiting
 * @param {(state: object) => void} [o.on_state] every state read
 * @param {(ms: number) => Promise<void>} [o.sleep]
 * @param {() => number} [o.now]
 * @returns {Promise<object>} the last state ("done")
 */
export async function wait_for_export(job, { status, cancelled = () => false, on_state = () => {}, sleep, now = () => Date.now(), interval_ms = POLL_MS, limit_ms = LIMIT_MS }) {
	const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
	const start = now();
	for (;;) {
		if (cancelled()) throw new ExportJobError("cancelled");
		const state = await status(job);
		if (cancelled()) throw new ExportJobError("cancelled");
		on_state(state || {});
		if (state?.state === "done") return state;
		if (state?.state === "failed") throw new ExportJobError("failed", state.error || "");
		if (now() - start >= limit_ms) throw new ExportJobError("timeout");
		await wait(interval_ms);
	}
}
