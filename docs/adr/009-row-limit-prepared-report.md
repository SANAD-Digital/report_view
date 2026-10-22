# ADR-009: الحد الأقصى للصفوف ومعاملة Prepared Report

- الحالة: مقبول
- التاريخ: 2026-09-30

## السياق
- الموجز (الأصل): 50,000 صف في المتصفح، وما فوقه «يُحال إلى Prepared Report». صار 100,000 (قرار صاحب المشروع C21، 2026-10-22).
- لا يمكن تحويل تقرير إلى Prepared Report من تطبيقنا: `_run` لا يقرأ النتائج المعدّة إلا إذا `Report.prepared_report=1` (`query_report.py:274`)، ورفع هذا العلم كتابة على تقرير قياسي (`report.py:436-446`).
- Frappe يفعّل Prepared Report تلقائياً بعد 15 ثانية بكتابة من خيط جانبي (`report.py:188-198,504-509`) ما لم يكن `disable_prepared_report_automation`.
- قراءة نتيجة معدّة تتطلب تطابق المالك ونص الفلاتر (`prepared_report.py:249-258`)، وقد يأتي الرد `{"prepared_report": True, "doc": None}` بلا `result` ولا `columns`.
- حد Frappe `System Settings.max_report_rows` = 100,000 (`query_report.js:1091`).

## القرار
- الحد = `min(Report View Global Settings.max_rows (افتراضي 100,000), System Settings.max_report_rows)`.
- `api.run` يحسب عدد الصفوف بعد `run`. فوق الحد: لا يعيد الصفوف، ويعيد `{"status": "too_large", "row_count": n, "limit": l}`، والواجهة تعرض حالة «أكبر من الحد» بخيارات: تضييق الفلاتر، أو فتح التقرير في query-report الأصلية، أو (إن كان `prepared_report=1` أصلاً) توليد نتيجة معدّة.
- التقارير المعدّة أصلاً (`prepared_report=1`، مثل Stock Balance): `api.run` يمرّر `prepared_report_name` إن وُجد، ويحوّل الرد بلا نتيجة إلى `{"status": "prepared_pending" | "prepared_missing", ...}`. زر «توليد» يستدعي `frappe.core.doctype.prepared_report.prepared_report.make_prepared_report` كما تفعل الصفحة الأصلية، ويستطلع الحالة بـ `frappe.realtime` (`prepared_report_update`).
- `prepared_report_name` القادم من المتصفح يُقبل فقط إن كانت النتيجة لنفس التقرير **ويملكها المستخدم الحالي** (`frappe.get_list` على Prepared Report). Frappe لا يقارن التقرير ولا المالك (`Q:282-284,360`)، و hook الـ Prepared Report يسمح بقراءة نتيجة أي مالك لنفس التقرير، فقد يرى مستخدم مقيّد نتيجة صُفّيت بصلاحيات مستخدم غير مقيّد. هذا أشد من الأصل عن قصد.
- لا نكتب على مستند Report أبداً. التفعيل التلقائي بعد 15 ث سلوك Frappe، ويُوثَّق ولا يُمنع.

## العواقب
- تعديل صياغة الموجز: «يُحال إلى Prepared Report» تصبح «رسالة واضحة بخيارات فعلية». مذكور في `docs/progress/phase-2.md`.
- اختبار الحد بصفوف حقيقية يحتاج بيانات مولّدة (قرار معلّق من المرحلة 0).

## تعديل (التحول إلى Perspective، 2026-10-01؛ ADR-012)
- (2026-10-22، قرار صاحب المشروع C21: 100,000 رسمي. الافتراضي في الكود `core/settings.DEFAULT_MAX_ROWS` والـ DocType **100,000**، وكذلك القيمة المحفوظة على acc.dev.) الحد الافتراضي 100,000 صف والسقف الصلب 200,000 (`Report View Global Settings.max_rows`)، من قياسات `docs/research/perspective-experiments.md` §3. يبقى مقيَّداً بـ `System Settings.max_report_rows` (100,000 على `acc.dev`)؛ رفعه فوق ذلك يحتاج تعديل إعداد النظام.
- لا `worker_threshold`: المحرك في Web Worker دائماً.
