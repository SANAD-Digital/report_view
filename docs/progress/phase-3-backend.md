# المرحلة 3 — جزء الخادم

كتبه المنسّق من التقرير النهائي لوكيل `backend-dev`، لأن الكتابة النهائية للملف رُفضت أثناء عمل الوكيل.

## ما بُني
| الملف | المحتوى |
|---|---|
| `report_view/core/errors.py` | أصناف الأخطاء ورموزها (§2.0) |
| `core/guard.py` | `guard_report`، `guard_report_quiet`، `guard_export`، `guard_print` (بـ `ignore_share_permissions=True`)، و `can_export`/`can_print` بلا رمي |
| `core/runner.py` | `run`، `merge_js_filters` (الخادمي يغلب)، `check_prepared_report_name`، `count_rows` |
| `core/settings.py` | `load_settings` من `defaults/<report>.json`، `get_row_limit()` = `min(50000, System Settings.max_report_rows)` |
| `core/normalize.py` | `normalize(raw, filters, report_settings, register, translate)` |
| `core/engine.py` | `apply(nr, state, selection, layout_columns)` (الجدول فقط في هذه المرحلة) |
| `core/view_state.py` | `validate`، `migrate`، `check_against_columns` |
| `core/export/model.py`، `xlsx.py` | `parse`، `check_against_report`، `compare_expected` (`RVExportMismatch` + Error Log)، `xlsx.build` |
| `report_view/api/__init__.py` | `run` (POST)، `get_meta` (GET)، `enrich` (POST)، `export_xlsx` (POST)؛ كلها تبدأ بـ `guard_report` |
| `defaults/trial_balance.json` | `enrich_rules` (account ← Account ← root_type, account_type)، `filter_defs` (company، fiscal_year)، `balance_pairs`، ونسخة خادمية من `report_settings` |
| `locale/ar.po` | ترجمة كل `_()` في الخادم (66)، وأضاف المنسّق نصوص الواجهة (34) |
| `report_view/tests/` | 7 ملفات اختبار + `utils.py` + 11 حالة مشتركة |
| `scripts/build_normalize_fixtures.py` | مولّد الحالات (تطوير فقط) |
| `docs/research/artifacts/phase3-trial-balance-{tree,grouped}-ar.xlsx` | ملفا Excel للفحص اليدوي |

`hooks.py` بلا تغيير.

## الاختبارات
```
bench --site acc.dev.sanad.digital run-tests --app report_view
Ran 12 tests ... OK      (normalize, engine)
Ran 37 tests in 7.852s OK (guard, api_run, get_meta, enrich, export)
```
- 49 اختباراً بلا تخطٍّ. `ruff check` و `ruff format --check` نظيفان.
- المستخدمون: `rv_t_{admin,accountant,restricted,auditor,none}@rvtest.invalid` يُنشؤون داخل `IntegrationTestCase` ويُتراجع عنهم. يُنشؤون **معطّلين** لأن `site_quota` يحد المستخدمين النشطين بعشرة. لا يبقى أي `rv_t_%` بعد التشغيل.
- لكل دالة whitelisted حالة مسموحة ومرفوضة، منها: `js_filters` مزوّرة أو غائبة لمستخدم مقيّد ⇒ `ValidationError`؛ `prepared_report_name` لمالك آخر ⇒ رفض؛ `too_large`؛ إثراء خارج قائمة السماح وأكثر من 5,000 اسم؛ `RVNoExport` لـ AR؛ `RVExportMismatch`؛ Auditor بلا `print`.

## مطابقة الإجماليات (المحرك بايثون مقابل الصف المرجعي من `query_report.run`، SND Accounting)

**Trial Balance** (المرجع صف `'Total'` الداخلي): الأعمدة الستة متطابقة.

| الفترة | افتتاحي مدين / دائن | حركة مدين / دائن | ختامي مدين / دائن |
|---|---|---|---|
| السنة 2026 | 0 / 0 | 30,303,624 / 30,303,624 | 7,553,469 / 7,553,469 |
| الربع الأول 2026 | 0 / 0 | 469 / 469 | 0 / 0 |
| أغسطس 2026 | 2,454,539 / 2,454,539 | 16,355,216 / 16,355,216 | 7,543,469 / 7,543,469 |
| السنة 2026، `show_group_accounts=0` | 0 / 0 | 30,303,624 / 30,303,624 | 24,653,599 / 24,653,599 |

- **General Ledger** (يناير-سبتمبر): المدين والدائن متطابقان (30,303,624). `balance` غير متطابق (9,943,760 مقابل 0) لأنه رصيد متراكم؛ يحتاج `column_rules` بلا تجميع في المرحلة 4 (ADR-008).
- **Accounts Receivable** (2026-09-30، المرجع صف مجموع Frappe): الأعمدة الرقمية الأحد عشر متطابقة.
- **Stock Balance**: `api.run` بلا `prepared_report_name` يعيد `prepared_missing`. بمالك النتيجة المعدّة كل الأعمدة متطابقة (bal_qty 3,008، bal_val 7,500,062).
- الشركة الثانية بلا قيود على `acc.dev`، فلم تُختبر.

## تعديلات العقد
مكتوبة في `docs/architecture.md` §3 و ADR-008 وقبلها المنسّق: N3.1 (الفاصل)، N3.2/N3.3 (البحث في كل الأبعاد)، N3.7 (المجاميع العريضة في AR)، N4.7 (إجمالي الشجرة = مجموع الجذور)، «قيم N1 المحددة»، والمرجع = آخر `internal_total`.

## ما لم يكتمل
- فتح ملف Excel في Excel و LibreOffice: غير مثبتين على الخادم.
- اختبار الردود عبر HTTP (403/409 و `exc_type`): الاختبارات تستدعي الدوال مباشرة.
- خارج المرحلة: `export_pdf`، `get_entry_state`، العروض المحفوظة، التصدير في الخلفية، Access Log، التحليل، الفرز داخل الشجرة.

## آثار على الموقع المشترك
- تشغيلات مبكرة تركت 4 سجلات Error Log (تُكتب مؤجلة فلا يمحوها التراجع)؛ حذفها الوكيل، واختبار الاختلاف صار يستبدل `log_error`.
- نُفّذ `bench compile-po-to-mo --app report_view --locale ar` و `bench --site acc.dev.sanad.digital clear-cache`.

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
