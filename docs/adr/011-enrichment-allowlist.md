# ADR-011: الإثراء بقائمة سماح خادمية

- الحالة: مقبول
- التاريخ: 2026-09-30

## السياق
- الإثراء يضيف حقولاً من المستندات المرتبطة (مثل `root_type` و `account_type` للحساب في ميزان المراجعة).
- User Permissions في Frappe تفحص أعمدة Link فقط، ولا تفحص شيئاً إن لم يكن للمستخدم أي User Permission (`query_report.py:934-935,1049`). الإثراء قد يكشف حقولاً لم يقصد التقرير إظهارها.

## القرار
- `api.enrich` يقبل فقط ثلاثيات (عمود المصدر، الـ DocType، الحقول) الموجودة في `Report View Settings.enrich_rules` للتقرير، أو في الإعدادات الافتراضية المشحونة.
- الحقول تُقاطع مع `frappe.get_meta(doctype).get_permitted_fieldnames(user=...)` (`frappe/model/meta.py:684`)، أي أن permlevel يُحترم.
- القراءة بـ `frappe.get_list(doctype, filters={"name": ["in", names]}, fields=["name", *fields])`، فتُطبَّق صلاحية read و User Permissions على المستندات المرتبطة.
- حد 5,000 اسم لكل استدعاء؛ الواجهة تقسّم.
- الأسماء التي لا يعيدها `get_list` (لا صلاحية) تبقى بلا إثراء وتظهر قيمها فارغة، ولا يُذكر سبب لكل صف.

## العواقب
- لا إثراء بلا إعداد صريح. ميزان المراجعة يُشحن بقاعدة واحدة: `account` ← Account ← `root_type`, `account_type`.
