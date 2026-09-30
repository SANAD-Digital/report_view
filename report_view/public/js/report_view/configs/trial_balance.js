// Trial Balance (docs/architecture.md §3.5 b). Server settings (enrichment, balance pairs,
// filter_defs) live in report_view/defaults/trial_balance.json; this file only holds the
// browser-side presentation: bands of the grouped header, debit/credit sides (colours of the
// design) and the "number + name" account label.

report_view.register("Trial Balance", {
	tree: { label_key: "account", number_key: "acc_number", name_key: "acc_name" },
	bands: [
		{ id: "opening", label: __("Opening Balance") },
		{ id: "period", label: __("Period Movement") },
		{ id: "closing", label: __("Closing Balance") },
	],
	columns: {
		opening_debit: { band: "opening", side: "dr", label: __("Debit") },
		opening_credit: { band: "opening", side: "cr", label: __("Credit") },
		debit: { band: "period", side: "dr", label: __("Debit") },
		credit: { band: "period", side: "cr", label: __("Credit") },
		closing_debit: { band: "closing", side: "dr", label: __("Debit") },
		closing_credit: { band: "closing", side: "cr", label: __("Credit") },
	},
	group_suggestions: ["account__root_type", "account__account_type"],
});
