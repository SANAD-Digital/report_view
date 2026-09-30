// Trial Balance (docs/architecture.md §3.5 b). Server settings (enrichment, balance pairs,
// filter_defs) live in report_view/defaults/trial_balance.json; this file only holds the
// browser-side presentation.

report_view.register("Trial Balance", {
	tree: { label_key: "account" },
	bands: [
		{ id: "opening", label: __("Opening") },
		{ id: "period", label: __("Movement") },
		{ id: "closing", label: __("Closing") },
	],
	columns: {
		opening_debit: { band: "opening", side: "dr" },
		opening_credit: { band: "opening", side: "cr" },
		debit: { band: "period", side: "dr" },
		credit: { band: "period", side: "cr" },
		closing_debit: { band: "closing", side: "dr" },
		closing_credit: { band: "closing", side: "cr" },
	},
	group_suggestions: ["account__root_type", "account__account_type"],
});
