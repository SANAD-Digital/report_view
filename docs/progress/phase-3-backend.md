# المرحلة 3 — جزء الخادم (قيد العمل)

## شكل الحالات المشتركة `report_view/tests/fixtures/normalize/*.json`

(هذا القسم كُتب أولاً ليستخدمه وكيل الواجهة؛ بقية التقرير تُكمَّل في نهاية العمل.)

```json
{
  "name": "<اسم الحالة = اسم الملف>",
  "description": "<ما تختبره>",
  "input": {
    "raw": { "...": "رد frappe.desk.query_report.run بعد json (كما يصل عبر HTTP)، بلا execution_time" },
    "filters": { "...": "فلاتر التقرير المستخدمة" },
    "report_settings": { "tree", "name_field", "parent_field", "initial_depth", "export_hidden_cols": "من ملف JS للتقرير، أو {}" },
    "register": {}
  },
  "expected": "NormalizedReport (§3.1) كما يخرجه report_view/core/normalize.py"
}
```

- المفاتيح في الملفات مرتبة أبجدياً (`sort_keys`)، والقيم `null` لا `None`، والأرقام كما هي (`0.0` تُقرأ 0 في JS).
- `__rid` من 0 بترتيب صفوف الرد بعد حذف صف مجموع Frappe.
- التوليد: `scripts/build_normalize_fixtures.py` (تشغيل حقيقي على `acc.dev` بمستخدم Administrator، قراءة فقط ثم rollback، ولغة `en`).
- التعديلات على عقد التطبيع التي كشفتها البيانات الحقيقية مكتوبة في `docs/architecture.md` §3 (N3.1، N3.2، N3.3، N3.7، N4.7، «قيم N1 المحددة») و ADR-008.
