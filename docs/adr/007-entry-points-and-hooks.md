# ADR-007: نقاط الدخول وسجل الـ hooks

- الحالة: مقبول
- التاريخ: 2026-09-30

## السياق
- لا يوجد hook للتقارير في Frappe (`frappe.get_hooks()` بلا مفتاح يحوي `report`، `frontend-query-report.md` §8). `page_js` يعمل لمستندات `Page` فقط (`core/doctype/page/page.py:194`)، و query-report صفحة قياسية `frappe.standard_pages["query-report"]` (`query_report.js:12`).
- `CLAUDE.md`: الربط عبر `hooks.py` فقط، وكل hook يُوثَّق في ADR.

## القرار
الـ hooks التي يسجّلها التطبيق (هذه القائمة كاملة، وأي إضافة تحتاج تعديل هذا الملف):

| المفتاح في `hooks.py` | القيمة | السبب | المرحلة |
|---|---|---|---|
| `app_include_js` | `["report_view_entry.bundle.js"]` | زر «Report View» في صفحة query-report. ملف صغير بلا مكتبات يستمع لـ `frappe.router.on("change")`، وإذا كان المسار `query-report/<name>` يطلب `report_view.api.get_entry_state` (مخزّن مؤقتاً في الجلسة) ويضيف زراً بـ `frappe.query_report.page.add_inner_button` (يمنع التكرار بـ `data-label`، `ui/page.js:622-660`) ويعيد إضافته بعد كل `load_report` لأن `clear_inner_toolbar` يُستدعى فيه (`query_report.js:163`) | 6 |
| `app_include_css` | لا شيء | CSS الصفحة يُحمَّل مع bundle الصفحة | — |
| `permission_query_conditions` | `{"Report View Saved View": "report_view.report_view.doctype.report_view_saved_view.report_view_saved_view.get_permission_query_conditions"}` | الخاص لا يظهر في أي قائمة لغير مالكه | 4 |
| `has_permission` | `{"Report View Saved View": "...report_view_saved_view.has_permission"}` | الخاص لا يُقرأ ولا يُعدَّل من غير مالكه، بالرابط المباشر وعبر REST القياسي؛ القيم لكل ptype في `docs/architecture.md` §6 | 4 |
| `after_install` | `report_view.install.after_install` | تحميل الإعدادات الافتراضية المشحونة (ميزان المراجعة) | 4 |
| `report_view_include_js` (مفتاح خاص بنا) | قائمة bundles من أي تطبيق | يسمح للتطبيقات الأخرى بتسجيل `report_view.register` لتقاريرها؛ يُقرأ في `get_meta` ويُحمَّل بـ `frappe.require` | 4 |

## العواقب
- `report_view_entry.bundle.js` يُحمَّل في كل صفحة Desk. حجمه المستهدف أقل من 3 KB مضغوطاً، ولا يستورد أي مكتبة.
- على `acc.dev` تطبيقان يعيدان تعريف `frappe.views.QueryReport` (`snd_accounting/public/js/snd_query_report.js:2`، `snd_print/public/js/report_extend.bundle.js:38`). الزر لا يعتمد على الصنف بل على `frappe.query_report.page` بعد التحميل، فيعمل مع النسختين. يُختبر في المرحلة 6.
- روابط مساحات العمل: رابط عادي من نوع URL إلى `/desk/report-view/<name>`، يضيفه المدير يدوياً أو يشحنه تطبيق.
