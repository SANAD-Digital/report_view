// The language of the Pages view (views/pages_view.js): the pages in another language than the
// session's (the report run again with `_lang`, the page's own words from a translation pack),
// titles and summary rows in that language. Methods of PagesView.

import { session_lang } from "../../util.js";
import { PAGE_MESSAGES, RTL_LANGS } from "./settings.js";
import { format_msg } from "./support.js";

export class PagesLang {
	lang() {
		return this.settings.lang || this.options?.lang || session_lang();
	}

	lang_rtl() {
		return RTL_LANGS.has(String(this.lang()).split("-")[0]);
	}

	// The translation of the pages' own words: the session's, or the pack of the language.
	t(msgid, args, context = null) {
		const lang = this.settings.lang;
		if (!lang || lang === session_lang()) return __(msgid, args, context);
		const pack = this.lang_packs.peek(this.lang_key(lang))?.pack;
		const text = (context && pack?.[`${msgid}:${context}`]) || pack?.[msgid] || msgid;
		return format_msg(text, args);
	}

	// A language's entry is the report run again with these filters (a document: rendered again).
	lang_key(lang) {
		const ctx = this.ctx || {};
		return `${lang}|${ctx.report_name || ""}|${this.doc_mode ? "" : JSON.stringify(ctx.filters || {})}`;
	}

	// The msgid of a text the session translated (the register's labels are translated at
	// load): what the pack of another language is asked for.
	msgid_of(text) {
		if (!this._reverse) {
			this._reverse = new Map();
			for (const [k, v] of Object.entries(frappe._messages || {})) if (typeof v === "string" && !this._reverse.has(v)) this._reverse.set(v, k.split(":")[0]);
		}
		return this._reverse.get(text) || text;
	}

	// Translation pack and report of another language, once per language.
	async load_lang(lang) {
		if (!lang || lang === session_lang()) return null;
		const key = this.lang_key(lang);
		if (this.lang_packs.has(key)) return this.lang_packs.get(key);
		if (this.doc_mode) {
			// a document is rendered by the server in the language; the page's own words here
			const pack = (await this.host.pages_translations(lang, [...PAGE_MESSAGES, ...this.signature_labels().map((x) => this.msgid_of(x))])) || {};
			const entry = { pack, report: undefined };
			this.lang_packs.set(key, entry);
			return entry;
		}
		const model = this.rows.model;
		const labels = [...model.pinned, ...model.data, { title: model.label_title }].map((d) => this.msgid_of(d.title));
		const bands = [...(model.bands?.values() || [])].map((b) => this.msgid_of(b.label));
		const filters = (this.ctx.defs || []).map((df) => df.label && this.msgid_of(df.label)).filter(Boolean);
		const signatures = this.signature_labels().map((s) => this.msgid_of(s));
		const messages = [...new Set([...PAGE_MESSAGES, this.ctx.report_name, ...labels, ...bands, ...filters, ...signatures])];
		// The pack is fetched while the report runs again; the run's classification waits
		// for it (the captions it recognises are the language's).
		const pack_p = this.host.pages_translations(lang, messages).then((p) => p || {});
		const [pack, report] = await Promise.all([pack_p, this.host.pages_run_lang(lang, pack_p)]);
		const entry = { pack, report };
		// (a request that failed threw: nothing is kept, the next layout asks again)
		this.lang_packs.set(key, entry);
		return entry;
	}

	signature_labels() {
		const own = this.config?.signatures;
		return Array.isArray(own) && own.length ? own.map(String) : [__("Accountant"), __("Finance Manager"), __("General Manager")];
	}

	// A word of the session's language in the language of the pages: the pack's text for
	// its msgid, else the msgid itself (English, the language of the msgids).
	in_lang(text) {
		const pack = this.lang_entry?.pack;
		if (!pack) return text;
		const msgid = this.msgid_of(text);
		return pack[msgid] || msgid;
	}

	// Titles in the language of the pages: the register's through the pack, the report's
	// own from the re-run.
	title_of(d) {
		const entry = this.lang_entry;
		if (!entry) return d.title;
		const own = this.config?.columns?.[d.column.fieldname]?.label;
		if (own && d.title === own) return this.in_lang(d.title);
		const col = entry.report?.columns?.find((c) => c.key === d.column.key);
		return col?.label || this.in_lang(d.title);
	}

	band_title(id) {
		return this.in_lang(this.rows.model.bands.get(id)?.label || "");
	}

	// A summary row of the report in the language of the pages: the row of the re-run with
	// the same __rid (the rows and their order are the view's).
	lang_row(row) {
		const report = this.lang_entry?.report;
		if (!report || !row) return row;
		const other = report.rows[row.__rid];
		return other && other.__kind === row.__kind ? other : row;
	}
}
