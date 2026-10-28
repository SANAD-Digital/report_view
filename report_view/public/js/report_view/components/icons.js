// Inline icons of the design (reference/design/Main.dc.html). Stroke/fill use currentColor,
// so their colour always comes from the CSS variables of the element that holds them.

const svg = (size, body, attrs = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"') =>
	`<svg width="${size}" height="${size}" viewBox="0 0 24 24" ${attrs} aria-hidden="true">${body}</svg>`;

export const icons = {
	crumb: () => svg(12, '<path d="m15 18-6-6 6-6"></path>', 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'),
	sun: () =>
		svg(17, '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path>'),
	moon: () => svg(17, '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"></path>'),
	sheet: () =>
		`<span class="ico-dr">${svg(16, '<rect x="4" y="3" width="16" height="18" rx="2"></rect><path d="M4 9h16M4 15h16M10 3v18"></path>')}</span>`,
	database: () =>
		svg(18, '<ellipse cx="12" cy="6" rx="8" ry="3"></ellipse><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"></path>'),
	alert: () =>
		svg(15, '<circle cx="12" cy="12" r="9"></circle><path d="M12 8v5M12 16.5v.5"></path>', 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'),
	check: () => svg(15, '<path d="m5 12 5 5 9-10"></path>', 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'),
	play: () => svg(14, '<path d="M17 5v14L5 12z"></path>', 'fill="currentColor"'),
	table: () => svg(15, '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 10h18M3 15h18M9 10v10"></path>'),
	pivot: () =>
		svg(15, '<rect x="3" y="3" width="18" height="18" rx="2"></rect><path d="M3 9h18M9 3v18"></path><path d="M13 14h4M15 12v4"></path>'),
	chart: () => svg(15, '<path d="M4 20V11M10 20V5M16 20v-6M21 20H3"></path>'),
	pages: () => svg(15, '<path d="M8 3h8l4 4v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"></path><path d="M16 3v4h4M9 12h6M9 16h6"></path>'),
	expand_all: () =>
		svg(16, '<rect x="3.5" y="3.5" width="17" height="17" rx="3"></rect><path d="M8 12h8M12 8v8"></path>', 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"'),
	collapse_all: () =>
		svg(16, '<rect x="3.5" y="3.5" width="17" height="17" rx="3"></rect><path d="M8 12h8"></path>', 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"'),
	close: () => svg(11, '<path d="M18 6 6 18M6 6l12 12"></path>', 'fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"'),
	group: () => svg(15, '<path d="M4 6h16M8 12h12M12 18h8"></path>', 'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"'),
	pdf: () => svg(16, '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5"></path>'),
	print: () => svg(16, '<path d="M6 9V3h12v6"></path><rect x="3" y="9" width="18" height="8" rx="2"></rect><path d="M7 14h10v7H7z"></path>'),
	calendar: (size = 16) => svg(size, '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M3 10h18M8 3v4M16 3v4"></path>'),
	fiscal: () => svg(14, '<path d="M4 20V10M9 20V6M14 20v-8M19 20V4"></path>', 'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"'),
	chevron_down: (size = 14) => svg(size, '<path d="m6 9 6 6 6-6"></path>', 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'),
	// Points to the inline end in RTL (the design's "next"); mirrored in LTR by CSS (.rv-flip).
	chevron_end: (size = 16) => svg(size, '<path d="m15 18-6-6 6-6"></path>', 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'),
	chevron_start: (size = 16) => svg(size, '<path d="m9 18 6-6-6-6"></path>', 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'),
	arrow_end: () => svg(16, '<path d="M19 12H5M11 6l-6 6 6 6"></path>', 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'),
	search: (size = 16) => svg(size, '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>', 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'),
	star: () => svg(16, '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"></path>', 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"'),
	funnel: (size = 14) => svg(size, '<path d="M3 5h18l-7 8.5V19l-4 2v-7.5z"></path>', 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'),
	funnel_solid: (size = 13) => svg(size, '<path d="M3 5h18l-7 8.5V19l-4 2v-7.5z"></path>', 'fill="currentColor"'),
	sigma: () => svg(14, '<path d="M18 5H6l6 7-6 7h12"></path>', 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'),
	pivot_cols: () => svg(14, '<path d="M6 4v16M12 8v12M18 12v8"></path>', 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"'),
	columns: () => svg(15, '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M9 4v16M15 4v16"></path>'),
	grip: () =>
		'<svg width="10" height="14" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.3"></circle><circle cx="7" cy="3" r="1.3"></circle><circle cx="3" cy="8" r="1.3"></circle><circle cx="7" cy="8" r="1.3"></circle><circle cx="3" cy="13" r="1.3"></circle><circle cx="7" cy="13" r="1.3"></circle></svg>',
	menu: () => svg(15, '<path d="M4 7h16M4 12h16M4 17h10"></path>', 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"'),
	sort_asc: (size = 13) => svg(size, '<path d="M12 19V5M6 11l6-6 6 6"></path>', 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"'),
	sort_desc: (size = 13) => svg(size, '<path d="M12 5v14M6 13l6 6 6-6"></path>', 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"'),
	pin: () => svg(15, '<path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z"></path>'),
	fit: () => svg(15, '<path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4"></path>'),
	hide: () =>
		svg(15, '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-2.4 3.4M6.6 6.6C4.3 8 2.7 10.2 2 12c1 2.5 5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"></path>'),
	refresh: () => svg(16, '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"></path><path d="M21 3v5h-5"></path>'),
	reset: () => svg(15, '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><path d="M3 3v5h5"></path>'),
	check_sm: () => svg(15, '<path d="m5 12 5 5 9-10"></path>', 'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"'),
	check_xs: () => svg(12, '<path d="m5 12 5 5 9-10"></path>', 'fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"'),
	alert_xs: () => svg(12, '<circle cx="12" cy="12" r="9"></circle><path d="M12 8v5M12 16.5v.5"></path>', 'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"'),
	x_sm: (size = 12) => svg(size, '<path d="M18 6 6 18M6 6l12 12"></path>', 'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"'),
	x_md: (size = 14) => svg(size, '<path d="M18 6 6 18M6 6l12 12"></path>', 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"'),
	// the context menu of a cell range (phase 5c/5d)
	copy: () => svg(16, '<rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path>'),
	download: () => svg(16, '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"></path>'),
	open: () => svg(16, '<path d="M14 4h6v6M20 4l-8 8M10 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4"></path>'),
	drill: () => svg(16, '<path d="M4 6h10M4 12h7M4 18h4M17 9v10M14 16l3 3 3-3"></path>'),
};
