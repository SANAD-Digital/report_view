// Classic (non-module) script: mimics what frappe.require does with a built bundle.
// ?bundle=/assets/report_view/dist/js/rv_perspective_probe.bundle.<hash>.js
(async function () {
	var out = document.getElementById("out");
	var result = { ok: false };
	try {
		var src = new URLSearchParams(location.search).get("bundle");
		await new Promise(function (resolve, reject) {
			var s = document.createElement("script");
			s.type = "text/javascript";
			s.src = src;
			s.onload = resolve;
			s.onerror = function () { reject(new Error("bundle failed to load")); };
			document.head.appendChild(s);
		});
		var perspective = window.__rv_psp_probe;
		var base = "/assets/report_view/node_modules/@finos/perspective/dist";
		perspective.init_server(fetch(base + "/wasm/perspective-server.wasm"));
		perspective.init_client(fetch(base + "/wasm/perspective-js.wasm"));
		var client = await perspective.worker();
		var table = await client.table({ a: "string", x: "float" });
		await table.update([{ a: "نقد", x: 1 }, { a: "مدينون", x: 2 }]);
		var view = await table.view();
		result.regular_table_defined = !!customElements.get("regular-table");
		var rt = document.createElement("regular-table");
		rt.style.cssText = "position:relative;display:block;width:400px;height:120px";
		document.body.appendChild(rt);
		var names = await view.column_paths();
		rt.setDataListener(async function (x0, y0, x1, y1) {
			var cols = await view.to_columns({ start_row: y0, end_row: y1, start_col: x0, end_col: x1 });
			return {
				num_rows: await view.num_rows(),
				num_columns: names.length,
				column_headers: names.slice(x0, x1).map(function (n) { return [n]; }),
				data: names.slice(x0, x1).map(function (n) { return cols[n]; }),
			};
		});
		await rt.draw();
		result.rendered_cells = rt.querySelectorAll("td").length;
		result.first_cell = rt.querySelector("td").textContent;
		try {
			var mod = await window.__rv_dynamic_import("/assets/report_view/experiments/lib/load.js");
			result.dynamic_import = typeof mod.load_perspective;
		} catch (e) {
			result.dynamic_import = "FAILED: " + e;
		}
		rt.remove();
		await view.delete();
		await table.delete();
		result.ok = result.regular_table_defined && result.rendered_cells === 4;
	} catch (e) {
		result.error = String((e && e.stack) || e);
	}
	window.__result = result;
	out.textContent = JSON.stringify(result, null, 2);
})();
