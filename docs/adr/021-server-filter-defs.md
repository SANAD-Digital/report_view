# ADR-021: تعريفات فلاتر خادمية لكل تقارير الكتالوج

- الحالة: مقبول (قرار صاحب المشروع C2، الخيار ب، 2026-10-22)
- التاريخ: 2026-10-22

## السياق
- `validate_filters_permissions` (`query_report.py:1131-1160`) يفحص قيمة الفلتر فقط إن كان تعريفه `fieldtype == "Link"` في `Report.filters` أو في `js_filters`. تقارير Script تعرّف فلاترها في `.js` فقط، فتعريفاتها تأتي من المتصفح، والمتصفح يستطيع حذف تعريف أو إرساله `Data` فيسقط الفحص (`docs/research/risks.md` C2).
- قبل هذا القرار كان ميزان المراجعة وحده يشحن `filter_defs` (`company`, `fiscal_year`).
- الخيار (أ) اشتقاق التعريفات على الخادم بتحليل `.js` عند كل تشغيل هش مع الفلاتر التي تُبنى ديناميكياً؛ الخيار (ب) شحن تعريفات صريحة لكل تقرير في الكتالوج.

## القرار
- لكل تقرير في `docs/research/report-catalog.md` (31 تقريراً) ملف `report_view/defaults/<scrub(report)>.json` فيه `filter_defs`: كل فلتر `Link` و `Dynamic Link` و `MultiSelectList` مع `options`. المصدر سكربت التقرير نفسه في erpnext/hrms المثبتين، يستخرجه `scripts/extract_filter_defs.py` (أداة تطوير؛ `--check` يفشل إن تغيّر المصدر)، والناتج روجع يدوياً:
  - `Dynamic Link` قيمته `options` = اسم الفلتر الذي يحمل الـ DocType (مثل `party` ← `party_type` في Trial Balance for Party)؛ مسجّل في `REVIEWED` داخل السكربت.
  - `MultiSelectList` بقيم ثابتة (`status` في Sales/Purchase Order Analysis) ليس رابطاً فلا يُشحن.
  - أبعاد المحاسبة والمخزون (`erpnext.utils.add_dimensions` / `add_inventory_dimensions`) تُضاف وقت التشغيل وتختلف بين المواقع، وهي `MultiSelectList` لا يفحصها Frappe أصلاً: لا تُشحن.
- `core/runner.py`: `js_filters` = اتحاد تعريفات المتصفح والخادم، **والخادمية تغلب** على نفس `fieldname` (`merge_js_filters`). فالمتصفح الذي يحذف تعريف Link أو يعيد تصنيفه لا يُسقط فحص Frappe.
- `Dynamic Link` خادمي يُسلَّم لـ Frappe كـ `Link` بالـ DocType الذي يحمله فلتر النوع إن كان نصاً و DocType موجوداً (`resolve_dynamic_links`)، فيفحصه `validate_filters_permissions` نفسه. غير ذلك يبقى كما هو (Frappe يتخطاه، كالصفحة الأصلية).
- تقرير بلا تعريفات مشحونة يبقى على سلوك Frappe (تعريفات المتصفح فقط)، ويُسجَّل ذلك مرة واحدة لكل عملية بمستوى debug (`frappe.logger("report_view")`).
- لا إعادة تنفيذ للصلاحيات: الفحص يبقى `validate_filters_permissions` داخل `query_report.run` (ADR-002).

## العواقب
- فلاتر Link في تقارير الكتالوج لم تعد قابلة للإسقاط من المتصفح. الاختبارات: `test_api_run.py::test_shipped_link_defs_cannot_be_dropped_or_retyped` (كل تعريف Link لكل تقرير مثبت، محذوفاً ومرسلاً `Data`: يُسأل `has_permission` عن الـ DocType والقيمة ويُرفض التشغيل)، `test_shipped_dynamic_link_is_checked_as_its_doctype`، و `test_restricted_user_other_company_refused_in_shipped_reports` (بلا mock: مستخدم مقيّد بـ User Permission على الشركة يُرفض شركة أخرى في كل تقرير مشحون يستطيع فتحه).
- `MultiSelectList` يبقى بلا فحص قيمة كما في Frappe (تُشحن تعريفاته كي لا يعيد المتصفح تصنيفها فقط). تصفية الصفوف بـ User Permissions تبقى طبقة Frappe الأخرى.
- تحديث erpnext/hrms قد يضيف فلاتر: `python3 scripts/extract_filter_defs.py --check` بعد كل تحديث، ثم التوليد والمراجعة.
- تقرير جديد خارج الكتالوج يعمل بلا تغيير (سلوك Frappe) حتى يُشحن له ملف.
