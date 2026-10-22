// The wait for an Excel export job (export_job.js): a job the server cancelled ends the wait
// as a cancel, a lost job as a failure with the server's words.
import { test } from "node:test";
import assert from "node:assert/strict";

import { wait_for_export, ExportJobError } from "../../report_view/public/js/report_view/export_job.js";

const clock = { sleep: async () => {}, now: () => 0 };

test("a job the server cancelled ends the wait as cancelled", async () => {
	for (const state of [{ state: "cancelled", error_code: "cancelled" }, { state: "failed", error_code: "cancelled" }]) {
		await assert.rejects(wait_for_export("j", { ...clock, status: async () => state }), (e) => e instanceof ExportJobError && e.reason === "cancelled");
	}
});

test("a lost job fails with the server's message", async () => {
	await assert.rejects(
		wait_for_export("j", { ...clock, status: async () => ({ state: "failed", error_code: "lost", error: "The worker stopped" }) }),
		(e) => e.reason === "failed" && e.message === "The worker stopped"
	);
});
