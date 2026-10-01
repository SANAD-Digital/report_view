// Trial Balance fixture helpers shared by experiments 2 and 6.
export const MEASURES = ["opening_debit", "opening_credit", "debit", "credit", "closing_debit", "closing_credit"];

export async function fetch_fixture(name = "trial_balance_fy2026.json") {
	const r = await fetch(`/assets/report_view/experiments/data/${name}`);
	if (!r.ok) throw new Error(`fixture ${name}: HTTP ${r.status} (fixtures are only served by serve.mjs, never by the site)`);
	return r.json();
}

/**
 * Build the facts table input from normalized rows: leaves only, plus level_1..level_N from the parent chain.
 * rows: [{__rid, __parent, __is_leaf, __kind, account, ...measures}]
 * mode "pad_null": missing deeper levels stay null. mode "leaf_last": the leaf itself is NOT a level (separate `account` column).
 */
export function build_facts(rows, { measures = MEASURES } = {}) {
	const by_id = new Map(rows.map((r) => [r.__rid, r]));
	const leaves = rows.filter((r) => r.__kind === "data" && r.__is_leaf);
	let depth = 0;
	const facts = leaves.map((leaf) => {
		const chain = [];
		for (let p = by_id.get(leaf.__parent); p; p = by_id.get(p.__parent)) chain.unshift(p.account);
		depth = Math.max(depth, chain.length);
		return { leaf, chain };
	});
	const level_names = Array.from({ length: depth }, (_, i) => `level_${i + 1}`);
	const data = facts.map(({ leaf, chain }) => {
		const row = { rid: leaf.__rid, account: leaf.account, acc_number: leaf.acc_number || null, currency: leaf.currency || null };
		level_names.forEach((n, i) => (row[n] = chain[i] === undefined ? null : chain[i]));
		for (const m of measures) row[m] = leaf[m];
		return row;
	});
	const schema = { rid: "integer", account: "string", acc_number: "string", currency: "string" };
	for (const n of level_names) schema[n] = "string";
	for (const m of measures) schema[m] = "float";
	return { schema, data, level_names };
}

export function parents_of(rows) {
	return rows.filter((r) => r.__kind === "data" && !r.__is_leaf);
}
