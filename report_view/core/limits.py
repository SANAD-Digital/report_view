"""The per-user rate limit of Report View's endpoints."""

from functools import wraps

import frappe
from frappe import _


def rate_limit(limit: int, seconds: int = 60):
	"""At most ``limit`` calls of the function per user in ``seconds`` (a web request only).

	``frappe.rate_limiter.rate_limit`` counts per IP address or per a form field, never per
	user: the users of an office share one address. The count and the refusal are Frappe's
	(``RateLimitExceededError``, HTTP 429, its translated message). The counter is per user
	and per function (its module and qualified name).

	The window's key is made with its expiry (``SET NX EX``) before it is counted, in one
	round trip, so a key never lives without one."""

	def decorator(fn):
		# module and name: ``save`` of two modules are two counters
		name = f"{fn.__module__}.{fn.__qualname__}"

		@wraps(fn)
		def wrapper(*args, **kwargs):
			if getattr(frappe.local, "request", None):
				key = frappe.cache.make_key(f"report_view:rl:{name}:{frappe.session.user}:{seconds}")
				pipe = frappe.cache.pipeline()
				pipe.set(key, 0, ex=seconds, nx=True)
				pipe.incr(key)
				count = pipe.execute()[-1]
				if count > limit:
					frappe.throw(
						_("You hit the rate limit because of too many requests. Please try after sometime."),
						frappe.RateLimitExceededError,
					)
			return fn(*args, **kwargs)

		return wrapper

	return decorator
