// Inline icons of the letter head builder. Stroke and fill use currentColor, so their colour
// always comes from the CSS variables of the element that holds them.

const svg = (size, body, attrs = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"') =>
	`<svg width="${size}" height="${size}" viewBox="0 0 24 24" ${attrs} aria-hidden="true">${body}</svg>`;

export const icons = {
	undo: () => svg(16, '<path d="M9 14 4 9l5-5"></path><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"></path>'),
	redo: () => svg(16, '<path d="m15 14 5-5-5-5"></path><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"></path>'),
	minus: () => svg(15, '<path d="M5 12h14"></path>'),
	plus: () => svg(15, '<path d="M12 5v14M5 12h14"></path>'),
	eye: () => svg(16, '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle>'),
	save: () => svg(16, '<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"></path><path d="M7 3v5h8M7 21v-7h10v7"></path>'),
	trash: () => svg(15, '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"></path>'),
	copy: () => svg(15, '<rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h8"></path>'),
	up: () => svg(14, '<path d="m6 15 6-6 6 6"></path>', 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"'),
	down: () => svg(14, '<path d="m6 9 6 6 6-6"></path>', 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"'),
	grid: () => svg(15, '<path d="M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"></path>', 'fill="none" stroke="currentColor" stroke-width="1.5"'),
	guides: () => svg(15, '<path d="M12 3v18M3 12h18"></path><rect x="6" y="6" width="5" height="5" rx="1"></rect>'),
	check: () => svg(14, '<path d="m5 12 5 5 9-10"></path>', 'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"'),
	alert: () => svg(16, '<circle cx="12" cy="12" r="9"></circle><path d="M12 8v5M12 16.5v.5"></path>', 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"'),
	grip: () =>
		'<svg width="8" height="14" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.3"></circle><circle cx="7" cy="3" r="1.3"></circle><circle cx="3" cy="8" r="1.3"></circle><circle cx="7" cy="8" r="1.3"></circle><circle cx="3" cy="13" r="1.3"></circle><circle cx="7" cy="13" r="1.3"></circle></svg>',
	search: () => svg(15, '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>', 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"'),
	elements: () => svg(18, '<rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect><path d="M17.5 14v7M14 17.5h7"></path>'),
	page: () => svg(18, '<path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"></path><path d="M14 3v5h5M8 13h8M8 17h5"></path>'),
	sliders: () => svg(18, '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"></path><circle cx="16" cy="6" r="2"></circle><circle cx="10" cy="12" r="2"></circle><circle cx="18" cy="18" r="2"></circle>'),
	close: () => svg(14, '<path d="M18 6 6 18M6 6l12 12"></path>', 'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"'),
	upload: () => svg(15, '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"></path>'),
	// the glyphs of the design elements in the library
	t_text: () => '<span class="rvlb-glyph g-text" aria-hidden="true">T</span>',
	t_image: () => svg(20, '<rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="9" cy="10" r="1.6"></circle><path d="m21 16-5-5-8 8"></path>', 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"'),
	t_logo: () => svg(20, '<rect x="4" y="4" width="16" height="16" rx="4"></rect><path d="M9 15V9l3 3 3-3v6"></path>', 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"'),
	t_line: () => svg(20, '<path d="M3 12h18"></path>', 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"'),
	t_band: () => '<span class="rvlb-glyph g-band" aria-hidden="true"></span>',
	t_qr: () => svg(20, '<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect><path d="M14 14h3v3h-3zM18 18h3v3h-3zM18 14h3M14 18v3"></path>', 'fill="none" stroke="currentColor" stroke-width="1.6"'),
	t_page: () => '<span class="rvlb-glyph g-page" aria-hidden="true">1/3</span>',
};
