// Report View Global Settings (ADR-015): a print signature of a report only; the PDF
// engine's Chromium (ADR-016): what PDFs print with, and its install.

frappe.ui.form.on("Report View Global Settings", {
	refresh(frm) {
		frm.set_query("print_signature", () => ({ filters: { disabled: 0, signature_for: "Report" } }));
		if (frappe.user.has_role("System Manager")) show_engine(frm);
	},
});

async function show_engine(frm) {
	const wrap = frm.get_field("pdf_engine_status")?.$wrapper;
	if (!wrap) return;
	const s = await frappe.xcall("report_view.api.chromium.engine_status", {}, "GET").catch(() => null);
	if (!s) return wrap.empty();
	const esc = frappe.utils.escape_html;
	// installed but not runnable here: most often a system library the server lacks
	const broken = s.installed && !s.runs && !s.installing;
	const state = s.installing
		? ["blue", __("Installing… this takes a few minutes")]
		: broken
		? ["red", __("Report View's Chromium is installed but cannot run on this server: PDFs fail")]
		: s.current
		? ["green", __("Report View's Chromium {0} is installed: PDFs print as the browser does", [s.version])]
		: s.installed
		? ["orange", __("Chromium {0} is installed; Report View pins {1}", [s.version || "?", s.pinned])]
		: ["red", __("Report View's Chromium is not installed: PDFs use Frappe's Chromium and may differ slightly from the browser's print")];
	// Chromium's own sandbox (C36): on once the AppArmor profile lets it start
	const sandbox = !s.installed
		? ""
		: s.sandbox
		? `<p class="text-muted small">${esc(__("Chromium sandbox: on"))}</p>`
		: `<p class="text-muted small">${esc(__("Chromium sandbox: off (the server forbids it; PDFs print with --no-sandbox). To turn it on, run once as root:"))}</p>
			<pre class="small" dir="ltr">${esc(s.apparmor_command || "")}</pre>`;
	const why = broken
		? `<p class="text-muted small">${esc(__("What Chromium said:"))}</p><pre class="small" dir="ltr">${esc(s.run_error || "?")}</pre>
			<p class="text-muted small">${esc(__("Install its system libraries once, as root:"))}</p><pre class="small" dir="ltr">${esc(s.apt_command || "")}</pre>`
		: "";
	const last = s.last && !s.last.ok ? `<p class="text-muted small">${esc(__("Last install failed: {0}", [s.last.output.split("\n").slice(-3).join(" ")]))}</p>` : "";
	wrap.html(`<div class="rv-engine">
		<p><span class="indicator-pill ${state[0]}">${esc(state[1])}</span></p>
		<p class="text-muted small">${esc(__("Folder: {0}", [s.path]))}</p>${why}${sandbox}${last}
		${s.supported && !s.current && !s.installing ? `<button type="button" class="btn btn-sm btn-default" data-action="install">${esc(s.installed ? __("Install version {0}", [s.pinned]) : __("Install Chromium"))}</button>` : ""}
		${s.supported ? "" : `<p class="text-muted small">${esc(__("Chrome for Testing has no build for this server's system"))}</p>`}
		<p class="text-muted small">${esc(__("From a terminal: bench report-view-install-chromium"))}</p>
	</div>`);
	wrap.find('[data-action="install"]').on("click", async () => {
		await frappe.xcall("report_view.api.chromium.engine_install", { force: s.installed ? 1 : 0 });
		frappe.show_alert({ message: __("The install started in the background"), indicator: "blue" });
		show_engine(frm);
		// the job may wait for a worker: the poll stops once it ran (or after a minute of waiting)
		let seen = false, waits = 0;
		const poll = setInterval(async () => {
			const n = await frappe.xcall("report_view.api.chromium.engine_status", {}, "GET").catch(() => null);
			if (n?.installing) seen = true;
			else waits++;
			if (!n || (!n.installing && (seen || waits > 12))) {
				clearInterval(poll);
				show_engine(frm);
			}
		}, 5000);
	});
}
