// The rules of a Custom print address (ADR-019) the browser checks before the server does:
// the staged print's token, a whitelisted method's dotted path, the options a print takes.
// One copy for custom_print.js and doc_print.js; tests/js/custom_print_rules.test.mjs checks
// them against core/custom_print.py (_TOKEN, _METHOD, _OPTION_KEYS). Pure: no Frappe here.

export const CUSTOM = "Custom";
export const TABLE_FORMAT = "Report View Table";
export const TOKEN = /^[a-f0-9]{24}$/;
export const METHOD = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/;
export const OPTION_KEYS = Object.freeze(["letter_head", "lang", "heading", "signature"]);
