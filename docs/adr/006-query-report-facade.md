# ADR-006: كائن واجهة في `frappe.query_report` أثناء عرض صفحتنا فقط

- الحالة: مقبول (استثناء واعٍ من قاعدة «لا monkey-patching»)
- التاريخ: 2026-09-30

## السياق
- سكربتات فلاتر ERPNext تستدعي المتغير العام مباشرة، لا المعامل الممرّر: `frappe.query_report.get_filter_value/set_filter_value/get_values/toggle_filter_display/refresh` (`trial_balance.js:21-33,51-57`، `general_ledger.js:78-85`، `public/js/financial_statements.js:400-417`).
- بدون هذا المتغير تنكسر `on_change` و `get_data` لفلاتر التقارير المالية في صفحتنا.
- `CLAUDE.md` يمنع monkey-patching، والهدف من المنع ألا نغيّر سلوك Frappe أو التطبيقات الأخرى.

## الخيارات
1. عدم لمس المتغير، وإعادة كتابة فلاتر كل تقرير في `register`.
2. وضع كائن واجهة (facade) من صنعنا في `frappe.query_report` عند إظهار صفحتنا، وإعادة القيمة السابقة عند إخفائها.

## القرار
الخيار 2، بقيود:
- الكائن من صنفنا `ReportViewQueryReportFacade`، لا يرث من `frappe.views.QueryReport` ولا يعدّل أي prototype.
- يُعيَّن في `on_page_show` لصفحة `report-view` فقط، وتُحفظ القيمة السابقة وتُعاد في `on_page_hide`.
- الواجهة المدعومة محصورة ومعلنة: `report_name`، `filters`، `page`، `get_filter`، `get_filter_value`، `get_filter_values`، `get_values`، `set_filter_value`، `toggle_filter_display`، `refresh`، `trigger_refresh`، `datatable` (= `null`)، `raw_data`، `report_settings`. قراءة عضو خارجها تعيد `undefined` كما في أي كائن (تعديل 2026-10-05: كان يرمي خطأً في وضع التطوير، فكسر تقارير تفحص وجود دالة اختيارية مثل `typeof qr.get_snd_filter_values === "function"` في `snd_accounting`؛ استدعاء دالة غير موجودة يفشل بـ TypeError المعتاد).

## العواقب
- صفحة query-report الأصلية لا تتأثر لأنها تعيد تعيين المتغير في `load` الخاص بها (`query_report.js:21`)، ولأننا نعيد القيمة عند مغادرة صفحتنا.
- اختبار Playwright في المرحلة 3: التنقل query-report ← report-view ← query-report يُبقي الأصلية سليمة.
