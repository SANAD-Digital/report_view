// Small helpers about values and columns shared by the adapter, the engine configs and the
// views (one copy each: they had drifted apart).

/** A value that is there: not null, undefined or the empty string (0 and false are values). */
export function has_value(v) {
	return v !== null && v !== undefined && v !== "";
}

/** The opposite of has_value: null, undefined or "". */
export function is_empty(v) {
	return !has_value(v);
}

/** The column holding each row's currency of a money column (a per-row currency), else null. */
export function row_currency_key(column) {
	return column?.currency?.kind === "row" ? column.currency.key : null;
}
