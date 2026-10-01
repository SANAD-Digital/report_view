// Experiment 7 (lifecycle follow-up): what happens after a wrong delete order, and how to recover.
export default async function ({ perspective }) {
	const out = {};
	const guarded = async (fn, ms = 3000) => {
		let timer;
		try {
			return await Promise.race([fn(), new Promise((_, rej) => (timer = setTimeout(() => rej(new Error(`TIMEOUT ${ms}ms: the call never settled`)), ms)))]);
		} catch (e) {
			return { ERROR: String(e).slice(0, 200) };
		} finally {
			clearTimeout(timer);
		}
	};
	// A. table.delete() rejected because a view is open -> can the table still be deleted afterwards?
	{
		const c = await perspective.worker();
		const t = await c.table({ a: "integer" }, { name: "rv_probe_a" });
		const v = await t.view();
		const r = {};
		r.delete_with_open_view = await guarded(async () => { await t.delete(); return "resolved"; });
		r.same_handle_still_usable = await guarded(async () => await t.size());
		await v.delete();
		r.hosted_before_recovery = await c.get_hosted_table_names();
		r.recover_with_open_table = await guarded(async () => { const again = await c.open_table("rv_probe_a"); await again.delete(); return "resolved"; });
		r.hosted_after_recovery = await c.get_hosted_table_names();
		out.failed_delete_then_recover = r;
		r.terminate = await guarded(async () => { c.terminate(); return "called"; });
	}
	// B. lazy delete: does the promise settle once the last view is deleted?
	{
		const c = await perspective.worker();
		const t = await c.table({ a: "integer" }, { name: "rv_probe_b" });
		const v = await t.view();
		const r = {};
		let settled = "pending";
		const p = t.delete({ lazy: true }).then(() => (settled = "resolved"), (e) => (settled = "rejected: " + String(e).slice(0, 80)));
		await new Promise((res) => setTimeout(res, 500));
		r.lazy_delete_state_while_view_open = settled;
		r.view_still_works = await guarded(async () => await v.num_rows());
		await v.delete();
		await Promise.race([p, new Promise((res) => setTimeout(res, 1500))]);
		r.lazy_delete_state_after_view_delete = settled;
		r.hosted_after = await c.get_hosted_table_names();
		out.lazy_delete = r;
		c.terminate();
	}
	// C. correct order, repeated: views then table; then terminate the worker and check a call on the dead client
	{
		const c = await perspective.worker();
		const t = await c.table({ a: "integer" });
		const v1 = await t.view();
		const v2 = await t.view({ group_by: ["a"] });
		const r = {};
		r.correct_order = await guarded(async () => { await v2.delete(); await v1.delete(); await t.delete(); return "resolved"; });
		r.hosted = await c.get_hosted_table_names();
		r.system_info = await guarded(async () => { const s = await c.system_info(); return { heap: Number(s.heap_size), used: Number(s.used_size) }; });
		c.terminate();
		r.call_after_terminate = await guarded(async () => await c.get_hosted_table_names());
		out.correct_order_and_terminate = r;
	}
	// D. a guard wrapper makes misuse reject instead of hanging
	{
		const c = await perspective.worker();
		const t = await c.table({ a: "integer" });
		const v = await t.view();
		let deleted = false;
		const safe_delete = async () => { if (deleted) return "skipped (already deleted)"; deleted = true; await v.delete(); return "deleted"; };
		out.guard_wrapper = { first: await safe_delete(), second: await safe_delete() };
		await t.delete();
		c.terminate();
	}
	return out;
}
