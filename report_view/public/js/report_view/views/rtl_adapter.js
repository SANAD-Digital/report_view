// RTL for <regular-table> 0.9.1 (docs/architecture.md §9.2; perspective-experiments.md §2.2).
// The library has no RTL support: with dir="rtl" alone the horizontal scroll does nothing
// and the table leaves its frame. Two small adapters on our own element fix both. They rely
// on internals of 0.9.1 (the version is pinned; RTL is tested again on any upgrade):
//   1. regular-table reads and writes this.scrollLeft as 0..max, an RTL scroller reports
//      0..-max: the sign is flipped on the element instance.
//   2. the table is pinned inside the shadow DOM with `position: sticky; left: 0`; in an RTL
//      scroller the constraint has to be on the right.

const NATIVE_SCROLL_LEFT = Object.getOwnPropertyDescriptor(Element.prototype, "scrollLeft");

/**
 * Apply both adapters. Call after setDataListener(): its first call writes `left: 0` on
 * the sticky clip again.
 */
export function apply_rtl(rt) {
	if (!Object.hasOwn(rt, "scrollLeft")) {
		Object.defineProperty(rt, "scrollLeft", {
			configurable: true,
			get() {
				return 0 - NATIVE_SCROLL_LEFT.get.call(this);
			},
			set(value) {
				NATIVE_SCROLL_LEFT.set.call(this, 0 - value);
			},
		});
	}
	const clip = rt.shadowRoot?.querySelector(".rt-scroll-table-clip");
	if (clip) {
		clip.style.right = "0px";
		clip.style.removeProperty("left");
	}
}
