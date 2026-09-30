// Inline icons of the design (reference/prototype/Main.dc.html). Stroke/fill use currentColor,
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
	group: () => svg(15, '<path d="M4 6h16M8 12h12M12 18h8"></path>', 'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"'),
};
