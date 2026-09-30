// N6: enrichment columns from api.enrich results (docs/architecture.md §3.2). Pure module.
// Adds `<source>__<field>` columns; original values are never changed.

// Unique non-empty values of the source column among the facts, in batches of 5,000.
export function enrich_batches(report, source_column, size = 5000) {
	const names = [...new Set(report.facts.map((r) => r[source_column]).filter(Boolean))];
	const out = [];
	for (let i = 0; i < names.length; i += size) out.push(names.slice(i, i + size));
	return out;
}

/**
 * @param {object} report NormalizedReport (mutated)
 * @param {object} rule {source_column, link_doctype, fields}
 * @param {object} values {name: {field: value}} merged from api.enrich responses
 * @param {Array<string>} fields fields actually returned (dropped_fields removed)
 * @param {Function} label_of (field) => label
 * @param {object} field_meta {field: {fieldtype, options, label}} from api.enrich
 */
export function apply_enrichment(report, rule, values, fields, label_of = (f) => f, field_meta = {}) {
	const source = report.columns.find((c) => c.key === rule.source_column);
	if (!source) return [];
	const added = [];
	fields.forEach((field, i) => {
		const key = `${rule.source_column}__${field}`;
		if (report.columns.some((c) => c.key === key)) return;
		// Select and Link keep their type so frappe.format translates or links the value;
		// everything else is shown as plain text.
		const fm = field_meta[field] || {};
		const fieldtype = ["Select", "Link"].includes(fm.fieldtype) ? fm.fieldtype : "Data";
		const options = fieldtype === "Data" ? null : fm.options || null;
		const label = fm.label || label_of(field);
		const column = {
			key,
			fieldname: key,
			label,
			fieldtype,
			options,
			width: 140,
			hidden: false,
			export_hidden: false,
			role: "dimension",
			agg: null,
			currency: null,
			link: null,
			date: false,
			source_index: report.columns.length + i,
			original: { fieldname: key, label, fieldtype, options },
			enriched: { source: rule.source_column, doctype: rule.link_doctype, field },
		};
		report.columns.push(column);
		for (const row of report.rows) {
			const name = row[rule.source_column];
			row[key] = (name && values[name]?.[field]) ?? null;
		}
		added.push(column);
	});
	return added;
}
