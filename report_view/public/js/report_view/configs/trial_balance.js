// Trial Balance (docs/architecture.md §3.5 b). Server settings (enrichment, balance pairs,
// filter_defs) live in report_view/defaults/trial_balance.json; this file only holds the
// browser-side presentation: bands of the grouped header, debit/credit sides (colours of the
// design), the "number + name" account label, the summary cards (debit = credit of each
// band), the quick filters of the search box (engine expressions, docs/architecture.md
// §8أ.2), the root type as the values offered in it, and the default chart.

// A value is "not zero" above half a cent: abs() also leaves empty cells out.
const NOT_ZERO = (key) => `abs("${key}") > 0.005`;

report_view.register("Trial Balance", {
	tree: { label_key: "account", number_key: "acc_number", name_key: "acc_name" },
	bands: [
		{ id: "opening", label: __("Opening Balance") },
		{ id: "period", label: __("Period Movement") },
		{ id: "closing", label: __("Closing Balance") },
	],
	columns: {
		account: { label: __("Account", null, "Report View") },
		opening_debit: { band: "opening", side: "dr", label: __("Debit") },
		opening_credit: { band: "opening", side: "cr", label: __("Credit") },
		debit: { band: "period", side: "dr", label: __("Debit") },
		credit: { band: "period", side: "cr", label: __("Credit") },
		closing_debit: { band: "closing", side: "dr", label: __("Debit") },
		closing_credit: { band: "closing", side: "cr", label: __("Credit") },
	},
	group_suggestions: ["account__root_type", "account__account_type"],
	// The root type repeats the top level of the tree: hidden by default, still in the panels.
	default_hidden: ["account__root_type"],
	rows_label: __("Accounts"),
	summary: {
		kind: "balance_pairs",
		pairs: [
			{ label: __("Opening Balance"), debit: "opening_debit", credit: "opening_credit" },
			{ label: __("Period Movement"), debit: "debit", credit: "credit" },
			{ label: __("Closing Balance"), debit: "closing_debit", credit: "closing_credit" },
		],
	},
	quick_filters: [
		{ id: "moving", label: __("Accounts with movement"), expression: `${NOT_ZERO("debit")} or ${NOT_ZERO("credit")}` },
		{
			id: "non_zero",
			label: __("Hide zero accounts"),
			expression: ["opening_debit", "opening_credit", "debit", "credit", "closing_debit", "closing_credit"].map(NOT_ZERO).join(" or "),
		},
		{ id: "debit_closing", label: __("Debit closing balances"), expression: NOT_ZERO("closing_debit"), exclusive: "closing_side" },
		{ id: "credit_closing", label: __("Credit closing balances"), expression: NOT_ZERO("closing_credit"), exclusive: "closing_side" },
	],
	search_facet: "account__root_type",
	// Charts view (design: reference/design/screens/charts.png): closing debit and credit of
	// the top-level groups of the tree.
	chart: { type: "bar", x: "level_1", series: ["closing_debit", "closing_credit"] },
});
