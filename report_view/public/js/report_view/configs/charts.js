// Default charts dashboards of known reports (register key `charts`, engine/chart_config.js
// default_cards). report_view.register merges keys, so these only add `charts` to the
// report's other settings. A card names a dimension and measures of the report; a card
// whose own filter names a column the report does not have (an enrichment that did not
// load) is left out. Every number comes from the card's Perspective view.

// Trial Balance (design: reference/design/screens/charts.png): closing balances of the
// top-level groups, the expense accounts, and the accounts that moved the most.
report_view.register("Trial Balance", {
	charts: {
		cards: [
			{
				id: "closing",
				type: "bar",
				x: "level_1",
				series: ["closing_debit", "closing_credit"],
				title: __("Closing balances by account type"),
			},
			{
				id: "expenses",
				type: "donut",
				x: "account",
				series: ["closing_debit"],
				filter: [{ key: "account__root_type", values: ["Expense"] }],
				title: __("Expenses distribution"),
			},
			{
				id: "moving",
				type: "hstacked",
				x: "account",
				series: ["debit", "credit"],
				top: 10,
				size: "full",
				title: __("Accounts with the most movement in the period"),
			},
		],
	},
});

// Receivables and payables: the outstanding of the largest parties, and by ageing range.
for (const name of ["Accounts Receivable", "Accounts Payable"]) {
	report_view.register(name, {
		charts: {
			cards: [
				{ id: "parties", type: "hbar", x: "party", series: ["outstanding"], top: 10, title: __("Outstanding by party") },
				{
					id: "ageing",
					type: "bar",
					x: null,
					series: ["range0", "range1", "range2", "range3", "range4", "range5"],
					title: __("Outstanding by ageing range"),
				},
				{ id: "dates", type: "area", x: "posting_date", series: ["invoiced", "paid"], sort: "label", size: "full" },
			],
		},
	});
}

// General Ledger: debit and credit of the busiest accounts, the voucher types, and in time.
report_view.register("General Ledger", {
	charts: {
		cards: [
			{ id: "accounts", type: "hbar", x: "account", series: ["debit", "credit"], top: 10 },
			{ id: "vouchers", type: "donut", x: "voucher_type", series: ["debit"] },
			{ id: "dates", type: "area", x: "posting_date", series: ["debit", "credit"], sort: "label", size: "full" },
		],
	},
});
