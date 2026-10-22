// The words of the builder's interface for the parts of a layout: company fields, element
// types, slots, bands. Browser only (__ of Frappe).

export const token_label = (t) =>
	({
		company_name: __("Company name"),
		company_name_ar: __("Company name (Arabic)"),
		abbr: __("Abbreviation"),
		tax_id: __("Tax ID"),
		phone_no: __("Phone"),
		fax: __("Fax"),
		email: __("Email"),
		website: __("Website"),
		registration_details: __("Registration details"),
		country: __("Country"),
		address: __("Address (all lines)"),
		address_line1: __("Address line"),
		city: __("City"),
	})[t] || t;

export const type_label = (t) =>
	({
		text: __("Text", null, "Report View"),
		field: __("Company field"),
		logo: __("Logo"),
		image: __("Image", null, "Report View"),
		line: __("Line"),
		band: __("Colour band"),
		qr: __("QR code"),
		page: __("Page number"),
	})[t] || t;

export const slot_label = (s) => ({ right: __("Right (slot)"), center: __("Centre (slot)"), left: __("Left (slot)") })[s] || __("Free (element)");
export const band_label = (b) => (b === "header" ? __("Header band") : __("Footer band"));
export const color_label = (c) => ({ primary: __("Primary colour"), text: __("Text colour"), muted: __("Muted colour") })[c] || c;

/** A short name of an element for the layers, the inspector and its aria-label. */
export function element_name(el) {
	if (el.type === "field") return token_label(el.props.token);
	if (el.type === "text") {
		const t = (el.props.text || "").split("\n")[0].trim();
		return t ? (t.length > 28 ? `${t.slice(0, 27)}…` : t) : __("Text", null, "Report View");
	}
	return type_label(el.type);
}

/** What the canvas says of an element to a screen reader: its name and its place. */
export function element_aria(el) {
	const place = el.slot ? __("in the slot: {0}", [slot_label(el.slot)]) : __("free, {0} mm from the left and {1} mm from the top", [el.x, el.y]);
	return `${element_name(el)}, ${place}`;
}

/** The hint drawn in place of an element with nothing to show yet. */
export function element_hint(el) {
	if (el.type === "field") return __("{0}: empty, hidden in print", [token_label(el.props.token)]);
	if (el.type === "text") return __("Write a text");
	if (el.type === "logo") return __("The company has no logo");
	if (el.type === "image") return __("Choose an image");
	return type_label(el.type);
}
