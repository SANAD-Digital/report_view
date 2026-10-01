// Scratch: what does group_by return for a ragged hierarchy?
import { fetch_fixture, build_facts, MEASURES } from "./tb.js";
export default async function ({ client }) {
	const fx = await fetch_fixture();
	const { schema, data, level_names } = build_facts(fx.expected.rows);
	const table = await client.table(schema);
	await table.update(data);
	const out = { level_names, n: data.length };
	const view = await table.view({ group_by: [...level_names, "account"], columns: ["closing_debit"], aggregates: { closing_debit: "sum" } });
	try {
		out.num_rows = await view.num_rows();
		out.paths = await view.column_paths();
		const cols = await view.to_columns();
		out.rows = cols.__ROW_PATH__.map((p, i) => [JSON.stringify(p), cols.closing_debit[i]]);
		out.dims = await view.dimensions();
	} finally {
		await view.delete();
	}
	await table.delete();
	return out;
}
