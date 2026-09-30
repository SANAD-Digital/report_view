// report_view.register(report_name, config) (docs/architecture.md §5.1).
// Repeated registration merges (the latest wins, key by key).

const registry = new Map();

export function register(report_name, config = {}) {
	const prev = registry.get(report_name) || {};
	registry.set(report_name, {
		...prev,
		...config,
		tree: { ...(prev.tree || {}), ...(config.tree || {}) },
		columns: { ...(prev.columns || {}), ...(config.columns || {}) },
	});
}

export function get_config(report_name) {
	return registry.get(report_name) || {};
}
