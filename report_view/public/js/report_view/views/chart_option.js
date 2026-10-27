// ECharts option of one card of the charts dashboard (views/charts_view.js). Pure module: no frappe, no DOM, no
// ECharts; every value, label, colour and text arrives already read or formatted, so the
// option only places them. Nothing is computed on the values here.
//
// RTL: the chart host is dir="ltr" (SVG text anchors flip under dir="rtl"), and the layout is
// mirrored instead: categories start on the right, the value axis stands on the right, and
// horizontal bars grow to the left. Each label keeps its own direction (Unicode bidi).

const FEW_LABELS = 12;
const MIN_LABEL_ROOM = 72;
const TURNED_MARGIN = 12;
const LINE_ROOM = 18;
// Under turned labels: ECharts sizes the grid from the text as the canvas measures it, and
// the SVG may draw it a few pixels longer (another rasteriser, hinting): room for that.
const TURNED_FOOT = 12;
// The last tick label of a horizontal value axis is centred on the edge of the plot.
const EDGE_MARGIN = 28;
// Opacity of the categories that are not the one a cross-filter picked.
const DIMMED = 0.3;

// Values as ECharts data items, the categories other than `selected` dimmed.
function dim(values, selected) {
	if (selected === null || selected === undefined) return values;
	return values.map((value, i) => (i === selected ? value : { value, itemStyle: { opacity: DIMMED } }));
}

/**
 * @param {object} p
 * @param {"bar"|"stacked"|"hbar"|"hstacked"|"line"|"area"|"donut"} p.type
 * @param {boolean} p.rtl
 * @param {string[]} p.labels category texts
 * @param {Array<{key: string, name: string, color: string, values: Array<number|null>}>} p.series
 * @param {string[]} p.palette colours of the categories of a donut (--c1..--c7)
 * @param {object} p.theme {text, text_2, text_3, line, line_2, line_3, surface, font, font_size}
 * @param {(v: number) => string} p.axis_text short number of an axis tick
 * @param {(key: string, index: number) => string} p.value_text formatted value of a cell
 * @param {(s: string) => string} p.esc HTML escape (tooltips are HTML)
 * @param {number} [p.width] width of the plot in px (room of the category labels)
 * @param {boolean} [p.animate]
 * @param {number} [p.label_width] room of a category label of horizontal bars in px
 * @param {number|null} [p.selected] the category of the cross-filter (the others are dimmed)
 * @returns {object} ECharts option
 */
export function chart_option(p) {
	const { type, rtl, labels, series, theme } = p;
	const base = {
		animation: p.animate !== false,
		animationDuration: 300,
		animationDurationUpdate: 300,
		backgroundColor: "transparent",
		textStyle: { fontFamily: theme.font, fontSize: theme.font_size, color: theme.text_2 },
		tooltip: tooltip(p),
	};
	if (type === "donut") return { ...base, series: [donut_series(p)] };
	if (type === "hbar" || type === "hstacked") return { ...base, ...hbar(p) };

	// Room of one category label: few labels that fit are shown whole (wrapped); otherwise
	// they stand upright and are cut at a length, the tooltip keeps the whole text.
	const n = labels.length;
	const room = Math.floor((p.width || 600) / Math.max(1, n)) - 8;
	const few = n <= FEW_LABELS && room >= MIN_LABEL_ROOM;
	// Turned upright, every label still has a line of its own while the room holds one.
	const all = few || room >= LINE_ROOM;
	return {
		...base,
		// Upright labels are centred on their category: a little room on both sides.
		grid: { left: few ? 8 : TURNED_MARGIN, right: few ? 8 : TURNED_MARGIN, top: 16, bottom: few ? 4 : TURNED_FOOT, containLabel: true },
		xAxis: {
			type: "category",
			data: labels,
			inverse: rtl,
			axisTick: { show: false },
			axisLine: { lineStyle: { color: theme.line_3 } },
			axisLabel: {
				color: theme.text_2,
				fontSize: theme.font_size,
				interval: all ? 0 : "auto",
				hideOverlap: !all,
				rotate: few ? 0 : 90,
				width: few ? room : 110,
				overflow: few ? "break" : "truncate",
				lineHeight: Math.round(theme.font_size * 1.4),
			},
		},
		yAxis: {
			type: "value",
			position: rtl ? "right" : "left",
			splitLine: { lineStyle: { color: theme.line, type: "dashed" } },
			axisLine: { show: false },
			axisTick: { show: false },
			axisLabel: { color: theme.text_3, fontSize: theme.font_size - 1, formatter: p.axis_text },
		},
		series: series.map((s) =>
			type === "line" || type === "area"
				? {
						type: "line",
						name: s.name,
						data: dim(s.values, p.selected),
						symbol: "circle",
						symbolSize: n > 40 ? 0 : 6,
						showSymbol: n <= 40,
						connectNulls: false,
						itemStyle: { color: s.color },
						lineStyle: { color: s.color, width: 2 },
						areaStyle: type === "area" ? { color: s.color, opacity: 0.14 } : undefined,
				  }
				: {
						type: "bar",
						name: s.name,
						data: dim(s.values, p.selected),
						stack: type === "stacked" ? "total" : undefined,
						barMaxWidth: type === "stacked" ? 30 : 22,
						barGap: "15%",
						itemStyle: { color: s.color, borderRadius: type === "stacked" ? 0 : [3, 3, 0, 0] },
				  }
		),
	};
}

function hbar(p) {
	const { rtl, labels, series, theme } = p;
	return {
		grid: { left: EDGE_MARGIN, right: EDGE_MARGIN, top: 8, bottom: 4, containLabel: true },
		xAxis: {
			type: "value",
			inverse: rtl,
			splitLine: { lineStyle: { color: theme.line, type: "dashed" } },
			axisLabel: { color: theme.text_3, fontSize: theme.font_size - 1, formatter: p.axis_text, hideOverlap: true },
		},
		yAxis: {
			type: "category",
			data: labels,
			// The first (largest) category on top.
			inverse: true,
			position: rtl ? "right" : "left",
			axisTick: { show: false },
			axisLine: { lineStyle: { color: theme.line_3 } },
			axisLabel: { color: theme.text, fontSize: theme.font_size, width: p.label_width || 180, overflow: "truncate" },
		},
		series: series.map((s, i) => ({
			type: "bar",
			name: s.name,
			data: dim(s.values, p.selected),
			stack: p.type === "hstacked" ? "total" : undefined,
			barMaxWidth: 16,
			barGap: "20%",
			// Stacked: only the outer end of the last bar is rounded.
			itemStyle: {
				color: s.color,
				borderRadius: p.type === "hstacked" && i < series.length - 1 ? 0 : rtl ? [3, 0, 0, 3] : [0, 3, 3, 0],
			},
		})),
	};
}

function donut_series(p) {
	const { labels, theme, palette } = p;
	const s = p.series[0];
	return {
		type: "pie",
		name: s.name,
		radius: ["58%", "82%"],
		center: ["50%", "50%"],
		label: { show: false },
		labelLine: { show: false },
		itemStyle: { borderColor: theme.surface, borderWidth: 2 },
		emphasis: { scale: true, scaleSize: 4 },
		data: labels.map((name, i) => ({
			name,
			value: s.values[i],
			itemStyle: { color: palette[i % palette.length], opacity: p.selected === null || p.selected === undefined || p.selected === i ? 1 : DIMMED },
		})),
	};
}

function tooltip(p) {
	const { theme, rtl, esc } = p;
	const item = p.type === "donut";
	return {
		trigger: item ? "item" : "axis",
		confine: true,
		axisPointer: p.type === "line" || p.type === "area" ? { type: "line", lineStyle: { color: theme.line_3 } } : { type: "shadow", shadowStyle: { color: theme.hover } },
		backgroundColor: theme.surface,
		borderColor: theme.line_2,
		borderWidth: 1,
		padding: [8, 10],
		textStyle: { color: theme.text, fontFamily: theme.font, fontSize: theme.font_size },
		extraCssText: `direction:${rtl ? "rtl" : "ltr"};text-align:start;box-shadow:${theme.shadow || "none"};border-radius:${theme.radius || "6px"}`,
		formatter: (params) => {
			const rows = Array.isArray(params) ? params : [params];
			if (!rows.length) return "";
			const index = rows[0].dataIndex;
			const head = `<div class="rv-ctip-hd">${esc(p.labels[index] ?? "")}</div>`;
			const lines = (item ? [p.series[0]] : rows.map((r) => p.series[r.seriesIndex]))
				.filter(Boolean)
				.map((s) => {
					const color = item ? p.palette[index % p.palette.length] : s.color;
					const pct = item && Number.isFinite(rows[0].percent) ? ` <span class="rv-ctip-p">${esc(rows[0].percent)}%</span>` : "";
					return `<div class="rv-ctip-row"><i style="background:${esc(color)}"></i><span class="nm">${esc(s.name)}</span><bdi class="v">${esc(p.value_text(s.key, index))}</bdi>${pct}</div>`;
				});
			return head + lines.join("");
		},
	};
}
