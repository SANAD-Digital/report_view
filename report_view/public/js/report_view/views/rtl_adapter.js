// RTL for <regular-table> 0.9.1 (docs/architecture.md §9.2; perspective-experiments.md §2.2).
// The library has no RTL support: with dir="rtl" alone the horizontal scroll does nothing
// and the table leaves its frame. Two small adapters on our own element fix both. They rely
// on internals of 0.9.1 (the version is pinned; RTL is tested again on any upgrade):
//   1. regular-table reads and writes this.scrollLeft as 0..max, an RTL scroller reports
//      0..-max: the sign is flipped on the element instance.
//   2. the table is pinned inside the shadow DOM with `position: sticky; left: 0`; in an RTL
//      scroller the constraint has to be on the right.
//   3. WebKit does not keep a sticky box in place when the scroll area grows to the left
//      (an RTL scroller): the clip moves with the content. The first horizontal scroll
//      measures it once; when the clip moved, every scroll puts it back with a transform.
//   4. On Safari (`window.safari`) the library adds the wheel delta to scrollLeft itself,
//      next to the browser's own (passive) wheel scroll: in RTL the two have opposite signs
//      and cancel out, so only the first wheel moves. The library's handler is stopped in
//      RTL; the browser scrolls and the `scroll` event draws, as in every other browser.

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
		if (!STICKY_FIX.has(rt)) {
			STICKY_FIX.add(rt);
			rt.addEventListener("scroll", () => keep_clip(rt, clip), { passive: true });
			// a capture listener runs first at the target: the library's never sees the event
			if (Object.hasOwn(window, "safari")) rt.addEventListener("mousewheel", (e) => e.stopImmediatePropagation(), { capture: true, passive: true });
		}
	}
}

// the elements whose listeners of adapters 3 and 4 are in place
const STICKY_FIX = new WeakSet();
// rt -> true when its sticky clip moves with the content (adapter 3), false when it holds
const STICKY_BROKEN = new WeakMap();

function keep_clip(rt, clip) {
	const native = NATIVE_SCROLL_LEFT.get.call(rt);
	let broken = STICKY_BROKEN.get(rt);
	if (broken === undefined) {
		// decided once, on a scroll long enough to tell the two cases apart: a clip that holds
		// keeps its right edge on the scroller's (a scroll bar at most apart), a broken one is
		// the scroll distance away
		if (Math.abs(native) < 40) return;
		const drift = clip.getBoundingClientRect().right - rt.getBoundingClientRect().right;
		broken = Math.abs(drift + native) < 2;
		STICKY_BROKEN.set(rt, broken);
	}
	if (broken) clip.style.transform = native ? `translateX(${native}px)` : "";
}
