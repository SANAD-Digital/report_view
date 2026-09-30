# ADR-002: تغليف `frappe.desk.query_report.run` بدل استدعاء التقارير مباشرة

- الحالة: مقبول
- التاريخ: 2026-09-30

## السياق
- `run` يجمع طبقات الصلاحية كلها: `validate_filters_permissions` (`query_report.py:261`، يعمل فقط مع `js_filters`)، `get_report_doc` مع `is_permitted` و `has_permission(ref_doctype, "report")` و `disabled` (`:24-55`)، ثم `get_filtered_data` لـ User Permissions على الصفوف (`:893-937`)، ودعم Prepared Report (`:274-287`).
- `run` يتجاهل معامل `user` ويستخدم `frappe.session.user` (`:235-244`).
- `CLAUDE.md`: كل تشغيل يمر عبر `run` ولا نعيد تنفيذ منطق الصلاحيات.

## الخيارات
1. استدعاء `execute()` لكل تقرير مباشرة، أو `generate_report_result`.
2. استدعاء `run` من دالتنا مع تمرير المعاملات كما هي.
3. توجيه المتصفح لاستدعاء `frappe.desk.query_report.run` مباشرة.

## القرار
الخيار 2: `report_view.api.run` يستدعي `frappe.desk.query_report.run` حصراً، ويمرّر دائماً:
- `filters` كما وصلت،
- `js_filters` = وصف الفلاتر كما حمّلها المتصفح من سكربت التقرير (لكي لا تسقط طبقة التحقق من قيم فلاتر Link، `permissions.md` §4)،
- `are_default_filters=False`، ولا يمرّر `user` (لأنه مُهمل ولكيلا يوهم أنه مستخدم).
الخيار 3 مرفوض لأننا نحتاج نقطة واحدة تضيف الحد الأقصى للصفوف، وتطبيع أخطاء Prepared Report، و `js_filters` إلزامياً.

## العواقب
- لا نحصل على صلاحيات أكثر ولا أقل من صفحة query-report الأصلية.
- حدود Frappe نفسها تبقى كما هي (أعمدة Link فقط، لا فحص عند غياب User Permissions): موثّقة في `docs/research/risks.md`، ولا «نصلحها» بإعادة تنفيذ. الإثراء (§2.3) لا يوسّع ما يراه المستخدم لأنه يمر بـ `frappe.get_list`.
- أي تغيير في توقيع `run` في إصدار لاحق من Frappe يُكتشف باختبار العقد في `report_view/tests/test_api_run.py`.
