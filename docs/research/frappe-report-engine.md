# محرك التقارير في Frappe (الخادم) — توثيق من الكود المثبَّت

> **ملاحظة (2026-10-27):** الأدلة الخام المذكورة هنا (`docs/research/artifacts/` و `tests/experiments/`) حُذفت من المستودع العام لأنها مخرجات تشغيل على موقع التطوير؛ هي باقية في تاريخ git قبل commit التنظيف.

**المحور أ من المرحلة 1 — مشروع report_view.**

| البند | القيمة |
|---|---|
| bench | `<bench>` |
| frappe | 16.28.0، فرع `version-16`، commit `be4728af84` (2026-07-21) |
| erpnext | 16.29.0، commit `a5de60c357` (2026-07-22) |
| Python | 3.14 |
| موقع التجربة | `$SITE` (التجارب عبر سكربت بايثون مباشر، قراءة فقط) |
| السكربتات والمخرجات الخام | `docs/research/artifacts/run_reports.py`، `run_reports_variants.py`، `query_report_run_tb_gl_ar.txt`، `query_report_run_variants_and_prepared.txt` |

كل رقم سطر أدناه يخص الملفات كما هي مثبَّتة في هذا الـ bench. المسارات مختصرة: `Q` = `apps/frappe/frappe/desk/query_report.py`، `R` = `apps/frappe/frappe/core/doctype/report/report.py`، `P` = `apps/frappe/frappe/core/doctype/prepared_report/prepared_report.py`، `JS` = `apps/frappe/frappe/public/js/frappe/views/reports/query_report.js`.

---

## 1. `frappe/desk/query_report.py`

### 1.1 خريطة الاستدعاء عند طلب تشغيل تقرير

```
run (Q:222)  ──►  _run (Q:247)
                    ├─ validate_filters_permissions (Q:1131)
                    ├─ get_report_doc (Q:24)
                    │     ├─ get_reference_report (Q:215)      [Custom Report فقط]
                    │     ├─ Report.is_permitted (R:140)
                    │     └─ frappe.has_permission(ref_doctype, "report")
                    ├─ [prepared]  get_prepared_report_result (Q:336)
                    │     └─ get_completed_prepared_report (P:249) → PreparedReport.get_prepared_data (P:89)
                    └─ [مباشر]     generate_report_result (Q:77)
                          ├─ get_report_result (Q:61) → Report.execute_query_report (R:175) / execute_script_report (R:186)
                          ├─ ljust_list (frappe/core/utils.py:71)
                          ├─ get_column_as_dict (Q:1094)
                          ├─ normalize_result (Q:162)
                          ├─ add_custom_column_data (Q:303)      [أعمدة مخصصة فقط]
                          ├─ get_filtered_data (Q:893)
                          │     ├─ get_linked_doctypes (Q:1042) → get_columns_dict (Q:1079)
                          │     ├─ get_user_match_filters (Q:1120) → reportview.build_match_conditions (reportview.py:870)
                          │     ├─ frappe.share.get_shared (frappe/share.py:152)
                          │     ├─ mask_field_value (frappe/model/utils/mask.py:5)
                          │     └─ has_match (Q:940) → has_unrestricted_read_access (Q:1016)
                          ├─ add_total_row (Q:732)
                          └─ translate_report_data (Q:1163)
```

### 1.2 `run` — Q:222-244

```python
@frappe.whitelist()
@frappe.read_only()
def run(report_name: str, filters: str | dict | None = None, user: str | None = None,
        ignore_prepared_report: bool = False, custom_columns: str | list | None = None,
        is_tree: bool = False, parent_field: str | None = None,
        are_default_filters: bool = True, js_filters: str | list | None = None) -> dict
```

- مُبيَّضة (whitelisted) بكل طرق HTTP الافتراضية (`frappe/__init__.py:454-455`: GET/POST/PUT/DELETE). واجهة Desk تستدعيها بـ `type: "GET"` (JS:741-743).
- `@frappe.read_only()` (`frappe/__init__.py:497-518`): يحوّل الاتصال إلى النسخة المقروءة فقط إذا كان `conf.read_from_replica` مفعّلاً؛ على هذا الموقع القيمة `None` (لا نسخة).
- **المعامل `user` يُتجاهَل**: `run` لا تمرّره إلى `_run` (Q:235-244)، فتستخدم `_run` دائماً `frappe.session.user` (Q:259-260). أي أن انتحال مستخدم آخر عبر واجهة HTTP غير ممكن.
- التحقق من أنواع المعاملات يتم بواسطة `validate_argument_types` داخل `whitelist` (`frappe/__init__.py:463`) بناءً على الـ type hints أعلاه.

### 1.3 `_run` — Q:247-300 (الفحوص بالترتيب)

| # | السطر | ما يحدث |
|---|---|---|
| 1 | Q:261 | `validate_filters_permissions(report_name, filters, user, js_filters)` — انظر 1.15 |
| 2 | Q:262 | `report = get_report_doc(report_name)` — يحمل الوثيقة ويجري فحوص الصلاحية (1.4) |
| 3 | Q:263-267 | فحص ثانٍ (مكرر) `frappe.has_permission(report.ref_doctype, "report")` وإلا `msgprint(raise_exception=True)` |
| 4 | Q:271-272 | إذا `are_default_filters` صحيحة والتقرير Custom Report له `custom_filters` محفوظة → تُستبدل الفلاتر المرسلة بالمحفوظة |
| 5 | Q:274 | `is_prepared_report = report.prepared_report and not sbool(ignore_prepared_report) and not custom_columns` |
| 6 | Q:277-287 | المسار المُعدّ مسبقاً: يحوّل `filters` من نص إلى dict، ينزع `prepared_report_name` منه (Q:282)، وإن وُجد يفحص `frappe.has_permission("Prepared Report", "read", dn, throw=True)` (Q:284)، ثم `get_prepared_report_result` |
| 7 | Q:288-290 | المسار المباشر: `generate_report_result(...)` ثم `add_data_to_monitor(report=...)` |
| 8 | Q:291-293 | أي استثناء يُسجَّل بـ `frappe.log_error("Report execution failed for: ...")` ثم يُعاد رفعه كما هو |
| 9 | Q:295 | `result["add_total_row"] = report.add_total_row and not result.get("skip_total_row", False)` |
| 10 | Q:297-298 | إذا كانت هناك `custom_filters` تُضاف للرد تحت المفتاح `custom_filters` |

ملاحظة على النوع في السطر 9: التعبير يعيد `int` (قيمة `report.add_total_row` وهي 0/1) عندما تكون `skip_total_row` كاذبة، ويعيد `bool` (`False`) عندما تكون صادقة. لوحظ فعلياً: Trial Balance → `add_total_row: 0` (int)، Accounts Receivable → `True` (bool)، وAR مع `group_by_party` → `False` (bool). انظر القسم 5.

### 1.4 `get_report_doc(report_name)` — Q:24-58

- `frappe.get_doc("Report", report_name)` ثم يهيّئ `doc.custom_columns = []` و`doc.custom_filters = []` (Q:26-27).
- إذا كان النوع `Custom Report`: يستبدل الوثيقة بالتقرير المرجعي عبر `get_reference_report` (Q:215-219، تتبع `reference_report` تكرارياً)، ويضع `doc.custom_report = report_name`، ويقرأ `columns` و`filters` من حقل `json` للتقرير المخصص إلى `custom_columns`/`custom_filters` (Q:33-37)، ويضع `doc.is_custom_report = True`، ويأخذ علم `prepared_report` من التقرير المخصص لا المرجعي (Q:41).
- الفحوص (بالترتيب):
  1. `doc.is_permitted()` (R:140-155) وإلا `PermissionError` «You don't have access to Report: {0}» (Q:43-47).
  2. `frappe.has_permission(doc.ref_doctype, "report")` وإلا `PermissionError` «You don't have permission to get a report on: {0}» (Q:49-53).
  3. `doc.disabled` → `frappe.throw("Report {0} is disabled")` (Q:55-56) — استثناء `ValidationError` عادي لا `PermissionError`.
- تعيد وثيقة `Report` (التقرير المرجعي في حالة Custom Report) مع الخصائص الإضافية المذكورة.

### 1.5 `get_report_result(report, filters)` — Q:61-74

- `Query Report` → `report.execute_query_report(filters)` (R:175-184).
- `Script Report` → `report.execute_script_report(filters)` (R:186-216).
- `Custom Report` → يعيد `get_report_doc(report.report_name)` ثم يستدعي نفسه (تكرار).
- `Report Builder` → لا فرع له، تعيد `None` (ومن ثم `[]` في Q:92). تقارير Report Builder لا تُشغَّل عبر `query_report.run` في Desk أصلاً؛ مسارها `Report.run_standard_report` (R:299-328) عبر `Report.get_data`.

### 1.6 `generate_report_result(report, filters=None, user=None, custom_columns=None, is_tree=False, parent_field=None)` — Q:77-159

مزيّنة بـ `@frappe.read_only()` أيضاً (Q:77). الخطوات:

| السطر | العملية |
|---|---|
| Q:86-90 | `user = user or session.user`؛ `filters` نصية → `json.loads` |
| Q:92 | `res = get_report_result(report, filters) or []` |
| Q:94 | `columns, result, message, chart, report_summary, skip_total_row = ljust_list(res, 6)` — يُكمل القائمة بـ `None` حتى 6 عناصر (`frappe/core/utils.py:71-85`). أي أن دالة `execute` قد تعيد من عنصر واحد حتى ستة |
| Q:95 | `columns = [get_column_as_dict(col) for col in (columns or [])]` — **هنا تُحوَّل الأعمدة النصية إلى قواميس** (1.9) |
| Q:96 | `report_column_names = [col["fieldname"] ...]` |
| Q:99 | `result = normalize_result(result, columns)` — **هنا تُطبَّع الصفوف** (1.7) |
| Q:101-108 | Custom Report محفوظ: تُستبدل الأعمدة بالمحفوظة مع إسقاط ما لم يعد يعيده التقرير (إلا `link_field`) |
| Q:111-113 | أعمدة مخصصة غير محفوظة (`custom_columns` من الطلب) تُدرج عند `insert_after_index + 1` |
| Q:116-119 | أعمدة ليست من التقرير الأصلي → `add_custom_column_data` (Q:303-333) يجلب قيمها بـ `get_data_for_custom_field` (Q:813-824، مبيَّضة، تفحص `read` على الـ DocType وتستخدم `frappe.get_list`) |
| Q:121-122 | إذا كانت النتيجة غير فارغة: `result = get_filtered_data(report.ref_doctype, columns, result, user)` (1.13) |
| Q:124 | `has_total_row = cint(report.add_total_row) and result and not skip_total_row` |
| Q:126-127 | `result = add_total_row(result, columns, is_tree=is_tree, parent_field=parent_field)` (1.11) |
| Q:129-130 | إذا `filters` قاموس وفيه `translate_data` صادق → `translate_report_data` (Q:1163-1168): يترجم كل قيمة نصية في كل صف عدا صف المجموع |
| Q:132-141 | بناء الرد (انظر القسم 4) |
| Q:143-157 | إذا `report.snapshot_report` و`doctype_to_sync`: يضيف `snapshot_report: True` و`snapshot_at` من آخر `DuckDB Sync` |

القيمة المعادة (Q:132-141):

```python
{
  "result": result, "columns": columns, "message": message, "chart": chart,
  "report_summary": report_summary, "skip_total_row": skip_total_row or 0,
  "status": None,
  "execution_time": frappe.cache.hget("report_execution_time", report.name) or 0,
}
```

`execution_time` يُقرأ من كاش Redis الذي كتبته `execute_script_report` في R:214 قبل لحظات (نفس التشغيل)؛ لتقارير Query Report لا يُكتب هذا الكاش فتكون القيمة 0.

### 1.7 `normalize_result(result, columns)` — Q:162-175

- يُفحص **الصف الأول فقط**: إذا كان `list | tuple` تُحوَّل كل الصفوف إلى قواميس بمفاتيح `fieldname` حسب ترتيب الأعمدة (`row[idx]` — يرفع `IndexError` إن كان الصف أقصر من الأعمدة).
- وإلا (الصف الأول dict أو النتيجة فارغة) تُعاد النتيجة كما هي. لا يوجد تطبيع لصفوف مختلطة.

### 1.8 `get_columns_dict(columns)` — Q:1079-1091

يعيد `frappe._dict` مفاتيحه الفهرس الرقمي **و** `fieldname` معاً، قيمته ناتج `get_column_as_dict`. تُستخدم في `get_linked_doctypes` و`get_filtered_data`/`has_match`.

### 1.9 `get_column_as_dict(col)` — Q:1094-1117

- نص بصيغة `"Label:Fieldtype/Options:Width"`: يُقسم على `:`؛ الجزء الثاني يُقسم على `/` إلى `fieldtype` و`options`؛ `width` فقط إذا كان عدد الأجزاء 3؛ `label = col[0]`؛ **`fieldname = frappe.scrub(label)`** (Q:1109). نص بلا `:` → `label` و`fieldname` فقط بلا `fieldtype`.
- قاموس: يُنسخ كما هو، وإن غاب `fieldname` يُشتق بـ `scrub(label)` (Q:1113-1115). لا يُضاف `fieldtype` افتراضي — لذلك تصل أعمدة بلا مفتاح `fieldtype` إلى الواجهة (لوحظ في General Ledger: `voucher_type`, `against`, `party_type`, `party`, `project`, `cost_center`, `against_voucher_type`؛ انظر 5.2).
- المقابل في الواجهة `frappe.report_utils.prepare_field_from_column` (`apps/frappe/frappe/public/js/frappe/views/reports/report_utils.js:93-119`) يختلف: يضع `fieldname = label` بلا scrub ويضع `fieldtype: "Data"` للنص بلا `:`. لكن الواجهة لا ترى النص أصلاً لأن الخادم حوّله في Q:95؛ كما أن ملف التقرير المُعدّ يحوي قواميس (5.4).

### 1.10 `get_script(report_name)` — Q:178-212

```python
@frappe.whitelist()
def get_script(report_name)
```
- يستدعي `get_report_doc` (كل فحوصه). يحدد المسار `<module>/report/<scrub(name)>/<scrub(name)>.js` و`.html` (Q:181-189)؛ الوحدات المخصصة (`Module Def.custom`) لا مسار لها على القرص (Q:183-186).
- أولوية السكربت: ملف `.js` على القرص (Q:192-195) ← وإلا `report.javascript` (Q:199-201) ← وإلا `frappe.query_reports['<name>']={}` (Q:203-204). يضيف `//# sourceURL`.
- `html_format` من ملف `.html` عبر `get_html_format` (`frappe/utils/__init__.py:649-661`) مع دعم `{% include %}`.
- يعيد `{"script": render_include(script), "html_format", "execution_time" (من الكاش), "filters": report.filters (جدول Report Filter), "custom_report_name"}`. `render_include` (`frappe/model/utils/__init__.py:58-78`) يحل `{% include "app/path" %}` حتى 5 مستويات ويمنع الخروج من مجلد التطبيق.

### 1.11 `add_total_row(result, columns, meta=None, is_tree=False, parent_field=None)` — Q:732-810

- `total_row = [""] * len(columns)` (Q:739) — **صف المجموع دائماً قائمة (list)** حتى لو كانت الصفوف قواميس. يُلحق في نهاية `result` (Q:809) بلا أي علامة مميزة؛ تمييزه الوحيد أنه العنصر الأخير عندما `add_total_row` في الرد صادق.
- نوع الصفوف يُقرَّر من الصف الأول فقط (Q:743).
- لكل عمود (Q:745-792): يُستخرج `fieldtype/fieldname/options` من القاموس أو من النص (`meta` غير مُمرَّر من `generate_report_result` ولا من `_export_query`).
  - إن كان `fieldtype` غير محدد يُستنتج من أول خلية: `int` → Int، `float` → Float (Q:774-778).
  - تُجمع الأنواع `Currency, Int, Float, Percent, Duration` عندما `flt(cell)` صادق (Q:779-781) **إلا** إذا `is_tree` و`row.get(parent_field)` صادق — أي في وضع الشجرة تُجمع الجذور فقط (Q:780). لاحظ أن `row.get` تفترض قاموساً؛ مع صفوف قوائم و`is_tree=True` سيرفع `AttributeError` (لم يُختبر).
  - `Percent` → متوسط على عدد الصفوف (Q:794-795). `Time` → جمع `timedelta` (Q:786-789). عمود `Link` بخيار `Currency` → يُنسخ من الصف الأول (Q:791-792).
  - الأنواع `Data, Date, Datetime, Link, Dynamic Link, Check, Select...` تبقى `""`.
- الخلية الأولى تصبح `_("Total")` ما لم يكن نوع العمود الأول من `("Currency","Int","Float","Percent","Date","Datetime","Time")` (Q:797-807).
- في الواجهة: `render_datatable` (JS:1101-1104) يحذف الصف الأخير قبل التمرير للـ DataTable إذا `raw_data.add_total_row` وليس تقرير شجرة، ويترك DataTable يحسب صف المجموع بنفسه (`showTotalRow`, JS:1124) عبر `frappe.utils.report_column_total` (`frappe/public/js/frappe/utils/utils.js:969-985`: Percent → متوسط، Int → cint، الأعداد → flt، غير ذلك null، و`disable_total` على العمود يعطّله). أي أن **المجموع المعروض في Desk يُحسب في المتصفح على الصفوف الظاهرة**، ومجموع الخادم يُستخدم في التصدير والطباعة.

### 1.12 `export_query()` / `_export_query` / `build_xlsx_data` — Q:373-712

- `export_query()` (Q:373-407، مبيَّضة، بلا معاملات؛ تقرأ `frappe.local.form_dict`): `pop_csv_params` (`frappe/desk/utils.py:36-46`: `csv_delimiter`, `csv_quoting`, `csv_decimal_sep`)، `clean_params` (`reportview.py:251-254`)، `parse_json` (`reportview.py:257-269`). **الفحص الوحيد المباشر**: `frappe.permissions.can_export(ref_doctype, raise_exception=True)` (Q:383-386؛ `permissions.py:644-652`: System Manager يمر دائماً، وإلا صلاحية `export` أو `if_owner.export`). إذا `export_in_background` → `frappe.enqueue(run_export_query_job, queue="long")` (Q:388-405) ويُرسل الملف بالبريد (`send_report_email`, `frappe/desk/utils.py:87`). وإلا `_export_query`.
- `_export_query(form_params, csv_params, populate_response=True)` (Q:419-514): يقرأ `report_name, file_format_type, custom_columns, include_indentation, include_filters, visible_idx, ignore_visible_idx, include_hidden_columns`، ثم **يستدعي `run(...)` نفسها** (Q:434-439) بـ `are_default_filters=False` — فتُعاد كل فحوص الصلاحية. لا أعمدة → صفحة «No data to export» (Q:447-452). إذا أرسلت الواجهة `visible_idx` أقل من عدد الصفوف (بعد استثناء صف المجموع) تُرشَّح الصفوف ويُعاد حساب `add_total_row` على المرشَّح (Q:455-468). ثم `format_fields` (Q:523-550: Duration → `format_duration`، Currency مع `precision` → `round`، Date/Datetime → نص بـ `formatdate/format_datetime` إلا في Excel). ثم `build_xlsx_data`. CSV → `get_csv_bytes` مع `handle_html`؛ Excel → `make_xlsx`؛ غير ذلك `frappe.throw` (Q:480-498). `include_filters` يلحق قيم الفلاتر باسم الملف (Q:500-509). الإخراج عبر `provide_binary_file` (`frappe/desk/utils.py:78-84`).
- `build_xlsx_data(data, visible_idx=None, include_indentation=False, include_filters=False, ignore_visible_idx=False, include_hidden_columns=False, *, build_styles=False)` (Q:557-712): يعيد `(rows, column_widths, styles)`. `visible_idx/ignore_visible_idx` مُهملة (تحذير إهمال v17، Q:598-606). صفوف الفلاتر المطبقة أولاً (Q:636-653)، ثم رأس الأعمدة بالتسميات المترجمة `_()` مع تخطي `hidden` ما لم `include_hidden_columns` (Q:656-672)، عرض العمود ÷ 10. لكل صف: يقرأ الخلية بـ `row.get(fieldname, row.get(label, ""))` للقواميس أو `row[col_idx]` للقوائم (Q:700)؛ القيم غير `EXCEL_TYPES` تُحوَّل بـ `cstr`؛ الإزاحة `indent` تتحول إلى 4 مسافات في العمود الأول فقط عندما `include_indentation` وليس `build_styles` (Q:675, 705-706). الأنماط عبر `get_xlsx_styles` (Q:715-729) التي تستدعي `Report.get_xlsx_styles_from_module` (R:455-465، دالة `get_xlsx_styles` اختيارية في وحدة التقرير) وإلا `XLSXStyleBuilder`.

### 1.13 `get_filtered_data(ref_doctype, columns, data, user)` — Q:893-937

- `linked_doctypes = get_linked_doctypes(columns, data)` (Q:1042-1076): لكل عمود `fieldtype == "Link"` يسجّل `options → idx` (للقوائم) أو `options → fieldname` (للقواميس)، ثم يحذف الـ DocTypes التي عمودها فارغ في كل الصفوف.
- `match_filters_per_doctype = get_user_match_filters(linked_doctypes, user)` (Q:1120-1128): لكل DocType مرتبط يستدعي `frappe.desk.reportview.build_match_conditions(dt, user, False)` (`reportview.py:870-878`، محرّك `frappe.database.query.Engine`) — أي شروط User Permissions.
- `shared = frappe.share.get_shared(ref_doctype, user)` (`frappe/share.py:152`).
- **التقنيع (masking)** (Q:905-912): إن كان لـ `ref_doctype` حقول `mask` لا يملك المستخدم صلاحية `mask` عليها (`frappe/model/meta.py:199-220`، ولا شيء للـ Administrator) تُستبدل قيمها في كل صف بـ `mask_field_value` (`frappe/model/utils/mask.py:5-40`: هاتف/بريد/تاريخ/وقت/افتراضي `XXXXXXXX`). يُطبَّق على المفتاح `row[field.fieldname]` مباشرة — على القواميس فقط عملياً.
- إن كانت هناك شروط user permission: يُبقي الصف إذا كانت قيمته في عمود `ref_doctype` ضمن المشاركات، أو إذا `has_match(...)` (Q:914-933). وإلا تُعاد كل الصفوف (Q:934-935).

### 1.14 `has_match(row, linked_doctypes, doctype_match_filters, ref_doctype, if_owner, columns_dict, user)` — Q:940-1013

- الصف الفارغ يمرّ دائماً (Q:962-964).
- لكل DocType له شروط: إن كان هو `ref_doctype` و`if_owner` (صلاحية `report` مقيّدة بالمالك) → تطابق المالك إذا وُجد عمود `User` يساوي `columns_dict["owner"]` وقيمته `user` (Q:969-973).
- وإلا لكل مجموعة شروط: لكل DocType مرتبط تُقرأ الخلية (dict بـ `row.get(idx)`، list بـ `row[idx]`)، وإن كانت القيمة خارج المسموح **وموجودة فعلاً** (`frappe.db.exists`) يفشل التطابق (Q:989-995). عند النجاح يُشترط أيضاً `has_unrestricted_read_access(ref_doctype, frappe.session.user)` (Q:997-998؛ يستخدم مستخدم الجلسة لا المعامل `user`) — أي وجود صلاحية `read` بلا `if_owner` على `ref_doctype` في `DocPerm` أو `Custom DocPerm` (Q:1016-1039، مع `request_cache`).
- المنطق: OR بين مجموعات الشروط لنفس الـ DocType، وAND بين الـ DocTypes.

### 1.15 `validate_filters_permissions(report_name, filters=None, user=None, js_filters=None)` — Q:1131-1160

- لا شيء إن لم تُرسل فلاتر. يجمع `report.filters` (جدول الوثيقة) + `js_filters` (تُرسلها الواجهة من `frappe.query_reports[...].filters` لكل فلتر `Link` له قيمة، JS:735-739).
- لكل فلتر `Link` موجود في `filters`: يجب `has_permission(options, "read", doc=value)` أو `"select"` وإلا `frappe.throw` «You do not have permission to access {0}: {1}.» (ValidationError، ليس PermissionError).
- ملاحظة: يحمّل الوثيقة بـ `frappe.get_doc("Report", report_name)` مباشرة قبل أي فحص صلاحية على التقرير نفسه.

### 1.16 دوال أخرى في الملف

- `get_reference_report(report)` Q:215-219.
- `get_prepared_report_result` — القسم 3.4.
- `save_report(reference_report, report_name, columns, filters)` Q:854-890 (مبيَّضة): تحفظ/تحدّث Custom Report؛ الإدراج بـ `insert(ignore_permissions=True)` (Q:888) — هذا داخل Frappe نفسه.
- `get_data_for_custom_field(doctype, field, names=None)` Q:813-824 (مبيَّضة، `frappe.get_list`).
- `translate_report_data(data, total_row)` Q:1163-1168.
- `valid_report_name` Q:517-520، `format_filter_value` Q:553-554، `run_export_query_job` Q:410-416.

---

## 2. DocType `Report`

### 2.1 الحقول (`apps/frappe/frappe/core/doctype/report/report.json`)

| الحقل | النوع | ملاحظات |
|---|---|---|
| `report_name` | Data، إلزامي | التسمية `autoname: field:report_name` |
| `ref_doctype` | Link → DocType، إلزامي | مرجع الصلاحيات (`report`, `export`, `print`) |
| `reference_report` | Data | للـ Custom Report |
| `is_standard` | Select `No/Yes`، إلزامي | |
| `module` | Link → Module Def | يُملأ تلقائياً من `ref_doctype` (R:61-62) |
| `add_total_row` | Check | يظهر لغير Report Builder |
| `report_type` | Select `Report Builder / Query Report / Script Report / Custom Report`، إلزامي | |
| `disabled` | Check | |
| `letter_head` | Link → Letter Head | غير القياسية فقط؛ يُصفَّر للقياسية (R:83-85) |
| `query` | Code (SQL) | Query Report |
| `javascript` | Code (JS) | Script Report غير قياسي |
| `json` | Code | Report Builder / Custom Report |
| `roles` | Table → Has Role (`role`) | |
| `prepared_report` | Check | |
| `report_script` | Code (Python) | Script Report غير قياسي؛ الوصف: «Send output as `result = [result]`, or for old style `data = [columns], [result]`» |
| `filters` | Table → Report Filter | حقول: `fieldname, label, fieldtype (Check/Currency/Data/Date/Datetime/Dynamic Link/Float/Fold/Int/Link/Select/Time), mandatory, options, wildcard_filter, default` |
| `columns` | Table → Report Column | حقول: `fieldname, label, fieldtype (+Duration), options, width` |
| `timeout` | Int | «Specify a custom timeout, default timeout is 1500 seconds»؛ يظهر مع `prepared_report` |
| `add_translate_data` | Check | يضيف للواجهة فلتر `translate_data` (JS:2423-2432) |
| `disable_prepared_report_automation` | Check | Script Report فقط |
| `snapshot_report` | Check | + جدول `doctype_to_sync` (DuckDB) |

صلاحيات الوثيقة (report.json `permissions`): Administrator / System Manager / Report Manager كاملة؛ **Desk User**: `read, report, print, email` فقط.

### 2.2 قواعد `validate` (R:59-88)

- بلا `is_standard` → `No`، إلا إذا كان المستخدم Administrator و`developer_mode=1` → `Yes` (R:64-70).
- غير القياسي: Query/Script Report يتطلبان دور `Script Manager` (R:74-75)؛ لا يمكن تعديل تقرير كان قياسياً (R:77-78).
- القياسي: `validate_standard_report` (R:436-446): Administrator فقط + developer_mode.
- `on_trash` (R:100-112): منع حذف القياسي خارج developer_mode.

### 2.3 `is_permitted()` — R:140-155

```python
allowed = [d.role for d in frappe.get_all("Has Role", fields=["role"], filters={"parent": self.name})]
custom_roles = get_custom_allowed_roles("report", self.name)   # custom_role.py:34-41
if custom_roles: allowed = custom_roles
if not allowed: return True
if has_common(frappe.get_roles(), allowed): return True
```
- إن وُجد `Custom Role` للتقرير فهو يستبدل أدوار `Has Role` كلياً.
- **بلا أدوار = مسموح للجميع** (R:151-152).
- عند عدم التطابق تعيد `None` ضمنياً (كاذبة).
- يُستخدم `frappe.get_roles()` (مستخدم الجلسة) لا معامل مستخدم.
- عند الإنشاء، `set_doctype_roles` (R:132-138) ينسخ أدوار `permlevel == 0` من الـ DocType المرجعي إذا لم تُحدد أدوار (غير القياسي فقط).

### 2.4 التنفيذ

- `execute_query_report(filters)` (R:175-184): يرفض الفراغ؛ `check_safe_sql_query` (`frappe/utils/safe_exec.py:731-756`: `select`/`explain` فقط أو `with` على MariaDB، ويرفض `into outfile/dumpfile`)؛ `frappe.db.sql(self.query, filters)` — الفلاتر تُمرَّر كمعاملات `%(name)s`؛ الصفوف **قوائم**؛ الأعمدة من جدول `columns` (`get_columns` R:129-130 يعيد قواميس) وإلا **أسماء أعمدة الاستعلام كنصوص** من `frappe.db.get_description()` (R:182). يعيد `[columns, result]`.
- `execute_script_report(filters)` (R:186-216):
  - `threshold = 15` ثانية (R:188). إن لم يكن `prepared_report` ولا `disable_prepared_report_automation`، يُشغَّل `threading.Timer(15, enable_prepared_report, kwargs={report, site})` (R:192-198) ويُلغى في `finally` (R:210). `enable_prepared_report` (R:504-509) يفتح اتصالاً جديداً في الخيط ويكتب `prepared_report=1` ويعمل `commit`. أي أن **أي تشغيل يتجاوز 15 ثانية يحوّل التقرير إلى Prepared Report نهائياً**، ولو كان الطلب داخل `@read_only`.
  - القياسي: `execute_snapshot_report` إن `snapshot_report` (R:236-241) وإلا `execute_module` (R:223-225): `frappe.get_attr("<app>.<module>.report.<scrub>.<scrub>.execute")(frappe._dict(filters))` عبر `get_report_module_dotted_path` (R:472-481).
  - غير القياسي: `execute_script` (R:227-234): `safe_exec(self.report_script, None, loc={"filters", "data", "result"})`؛ يعيد `loc["data"]` إن وُجد وإلا `(self.get_columns(), loc["result"])`.
  - يكتب زمن التنفيذ في `frappe.cache.hset("report_execution_time", self.name, seconds)` (R:214).
- `get_data(...)`/`run_query_report` (R:243-297): غلاف يستدعي `_run` ويعيد `(columns, result)`؛ يحوّل الأعمدة النصية بطريقته الخاصة (`fieldname = label` بلا scrub، R:283-293). يُستخدم مثلاً في Auto Email Report.
- `run_standard_report` (R:299-328): Report Builder عبر `frappe.get_list(... user=user)` مع `append_totals_row` (`reportview.py:517-534`).

---

## 3. Prepared Report

### 3.1 الوثيقة (`apps/frappe/frappe/core/doctype/prepared_report/prepared_report.json` و P)

- التسمية `hash`. الحقول: `report_name` (Data)، `status` (Select: `Error / Queued / Completed / Started`)، `report_end_time`، `error_message`، `filters` (Small Text — JSON مُطبَّع)، `job_id`، `queued_by`، `queued_at`، `peak_memory_usage`. الخاصيتان `queued_by/queued_at` تعيدان `owner/creation` (P:48-54).
- الكود يكتب أيضاً الحالتين `Cancelled` (P:218) و`Failed` (P:269) عبر `frappe.db.set_value` رغم أنهما ليستا ضمن خيارات الـ Select.
- الصلاحيات: `System Manager` كاملة، `Prepared Report User` قراءة/تصدير/طباعة/مشاركة. إضافة إلى hooks (`apps/frappe/frappe/hooks.py:119, 137`): `get_permission_query_condition` (P:320-335) و`has_permission` (P:338-351): Administrator/System Manager دائماً؛ غيرهما فقط إذا كان `report_name` ضمن تقارير المستخدم المسموحة (`UserPermissions.get_all_reports` → `DeskViews.get_allowed_reports`، `apps/frappe/frappe/desk/desk_views.py:107-108, 149-262`: أدوار Has Role/Custom Role، التقارير بلا أدوار، `disabled == 0`، ثم `frappe.get_list("Report", user=user)`).

### 3.2 متى يُفعَّل

1. يدوياً: حقل `Report.prepared_report` = 1. (Custom Report يتبع علم التقرير المخصص نفسه، Q:41.)
2. تلقائياً: عند تجاوز تشغيل Script Report **15 ثانية** (R:188-198، 504-509) ما لم يكن `disable_prepared_report_automation` مفعّلاً. لا يوجد إعداد نظام لهذه العتبة في هذا الإصدار؛ هي ثابت في الكود.
3. `Report.timeout` (ثوانٍ) هو مهلة مهمة الخلفية، والافتراضي `REPORT_TIMEOUT = 25 * 60` (P:25، 84). `FAILURE_THRESHOLD = 6 * 60 * 60` (P:24) تستخدمه `expire_stalled_report` (P:261-273) المجدولة في `hourly_maintenance` (`hooks.py:252`) لتحويل `Started` القديمة إلى `Failed`.
4. `clear_old_logs(days=30)` (P:56-64) لحذف القديم عبر Log Settings.

عند التفعيل، `_run` لا ينفّذ التقرير؛ يبحث عن نتيجة مكتملة أو يعيد رداً فارغاً (3.4). وإن مُرّر `ignore_prepared_report=1` أو `custom_columns` يُنفَّذ مباشرة (Q:274).

### 3.3 دورة التوليد في الخلفية

1. الواجهة: زر «Generate New Report» → `show_warning_or_generate_report` (JS:967-1002) يفحص المُنتظر عبر `get_reports_in_queued_state` (P:236-246) ثم `generate_background_report` (JS:1045-1072) يستدعي `make_prepared_report(report_name, filters)` (P:186-200).
2. `make_prepared_report`: يستدعي `get_report_doc` (كل فحوص الصلاحية) ثم يدرج وثيقة بـ `insert(ignore_permissions=True)` مع `filters = process_filters_for_prepared_report(filters)` (P:225-233: `frappe.as_json(..., indent=None, separators=(",", ":"))` — مفاتيح مرتبة بلا مسافات، لتطابق نصي لاحقاً).
3. `before_insert` → `status = "Queued"` (P:66-67). `after_insert` → `enqueue(generate_report, queue="long", timeout=Report.timeout or 1500, enqueue_after_commit=True, at_front_when_starved=True)` (P:78-87).
4. `generate_report(prepared_report)` (P:107-160) في العامل: `update_job_id` → `Started` + `commit` (P:171-183)؛ Custom Report → التقرير المرجعي + `custom_columns` (P:118-125)؛ **`generate_report_result(report=report, filters=instance.filters, user=instance.owner)`** (P:127) — أي نفس مسار التوليد المباشر لكن بمستخدم المالك (`frappe.session.user` في العامل هو Administrator عادةً، وهو ما تستخدمه بعض الفحوص مثل `has_unrestricted_read_access` Q:998 و`get_masked_fields` meta.py:202 — انظر الأسئلة المفتوحة)؛ ثم `create_json_gz_file` (P:285-305)؛ ثم `Notification Log` برابط `/desk/query-report/<report>?prepared_report_name=<name>` (P:132-142)؛ الحالة `Completed` مع `report_end_time` و`peak_memory_usage` (P:149-154)؛ `publish_realtime("report_generated", {report_name, name}, user=frappe.session.user)` (P:156-160). الخطأ → `_save_error` → `Error` مع traceback (P:144-147, 163-168).
5. الملف: `File` خاص (`is_private: 1`) باسم `<scrub(report_name)>_<Y-m-d-H-M>.json.gz`، محتواه `gzip.compress(frappe.as_json(result_dict), compresslevel=5)` حيث `result_dict` هو **كامل القاموس** الذي تعيده `generate_report_result` (P:288-292). تحقق فعلي على الموقع: الوثيقة `fgmec8i05u` (Stock Balance) لها ملف `/private/files/stock_balance_2026-1-28-2-9.json.gz` (927 بايت) وفكّه يعطي قاموساً بالمفاتيح `chart, columns, execution_time, message, report_summary, result, skip_total_row, status` (5.4).

### 3.4 القراءة: `get_prepared_report_result(report, filters, dn="", user=None)` — Q:336-370

- إن لم يُمرَّر `dn`: `get_completed_prepared_report(filters, user, report.custom_report or report.report_name)` (P:249-258) = `frappe.db.get_value("Prepared Report", {status: "Completed", filters: <نفس التطبيع>, owner: user, report_name})` — أي **تطابق نصي تام للفلاتر، وللمالك نفسه**. لاحظ أن `filters` هنا هي ما وصل لـ `_run` بعد نزع `prepared_report_name`.
- إن وُجدت الوثيقة: `doc.get_prepared_data()` (P:89-104: أول مرفق ينتهي بـ `.gz` ثم `gzip.decompress`) → `json.loads` → `get_report_data` (Q:339-352): توافق قديم إن كان للوثيقة حقل `columns` أو كانت البيانات قائمة؛ وإلا يأخذ `data["columns"]`، ويترجم `label` كل عمود بـ `_()` (Q:348-350). أي فشل → `log_error` + `msgprint("Prepared report render failed")` و`doc = None` (Q:365-368).
- يعيد `report_data | {"prepared_report": True, "doc": doc}`. عند عدم وجود وثيقة يكون الرد **`{"prepared_report": True, "doc": None}`** فقط (+ `add_total_row` من `_run`) — بلا `result` ولا `columns` (تحقق فعلي 5.4).

### 3.5 كيف تطلبه الواجهة

- `prepared_report_name` يأتي من route options / query string (JS:671-678) ويُصفَّر عند كل `refresh_report` (JS:399). في `refresh` يُضاف إلى `filters` (JS:730-732) ويُنزع في الخادم (Q:282) بعد فحص قراءة الوثيقة (Q:284).
- الرد: إن `data.prepared_report` → تُعطَّل حقول الفلاتر وتُملأ من `doc.filters` (JS:816-831)، وتُضاف أزرار «Download» (عبر `download_attachment` P:308-317) و«Rebuild/Edit/New» (JS:897-960). يستمع لحدث `report_generated` (JS:115-126). `data.message` لا يُعرض للتقارير المُعدّة (JS:841).
- التصدير مع تقرير مُعدّ: تضع الواجهة `prepared_report_name` في الفلاتر (JS:1810-1812) و`_export_query` يستدعي `run` فيقرأ الملف نفسه.

---

## 4. أشكال الرد الممكنة من `run`

### 4.1 ما تعيده دالة `execute` في التقرير

قائمة/tuple حتى 6 عناصر، تُكمَّل بـ `None` (Q:94):

| الفهرس | المفتاح في الرد | الأشكال المسموحة |
|---|---|---|
| 0 | `columns` | قائمة قواميس أو نصوص `"Label:Fieldtype/Options:Width"`؛ تُحوَّل كلها إلى قواميس في Q:95 (1.9). مفاتيح القاموس التي تفهمها الواجهة: `label, fieldname, fieldtype, options, width, hidden, sticky, precision, disable_total, editable` (JS:1085, 1374-1447، utils.js:970) |
| 1 | `result` | قائمة صفوف: قوائم/tuples (تُطبَّع إلى قواميس إذا كان الصف الأول قائمة، Q:166) أو قواميس (تبقى). قد تحتوي `{}`/`[]` فارغة (تمر من `has_match` Q:962-964؛ تُهمل في `get_linked_doctypes` Q:1059). قد تختلط بعد `add_total_row` (قواميس + صف مجموع قائمة) |
| 2 | `message` | نص/HTML؛ تعرضه الواجهة بـ `show_report_message` إلا للمُعدّ (JS:841) |
| 3 | `chart` | قاموس إعدادات frappe-charts (`{"data": {"labels": [...], "datasets": [{"values": [...]}]}, "type": ...}` + اختيارياً `fieldtype/options` للتلميحات، JS:1177-1200) |
| 4 | `report_summary` | قائمة عناصر `{"value", "label", "datatype", "currency", "indicator"/"color"}` أو `{"type": "separator", "value"}` (`utils.js:1676-1702`) |
| 5 | `skip_total_row` | صادق/كاذب؛ في الرد `skip_total_row or 0` (Q:138) |

### 4.2 مفاتيح الرد النهائي

| المفتاح | المصدر | النوع الملاحَظ |
|---|---|---|
| `result` | Q:133 | list |
| `columns` | Q:134 | list[dict] |
| `message` | Q:135 | None / str |
| `chart` | Q:136 | None / dict |
| `report_summary` | Q:137 | None / list |
| `skip_total_row` | Q:138 | int (0) أو ما أعاده التقرير (1) |
| `status` | Q:139 | دائماً `None` |
| `execution_time` | Q:140 | float ثوانٍ |
| `add_total_row` | Q:295 | int 0/1 أو bool False |
| `custom_filters` | Q:298 | Custom Report فقط |
| `snapshot_report`, `snapshot_at` | Q:152-157 | تقارير DuckDB فقط |
| `prepared_report` (True), `doc` (وثيقة أو None) | Q:370 | المسار المُعدّ فقط؛ وعندها قد تغيب `result/columns` كلياً |

`is_tree` و`parent_field` **مدخلات** لا مخرجات: ترسلهما الواجهة من `frappe.query_reports[name].tree/.parent_field` (JS:748-749) ويستخدمهما الخادم فقط في `add_total_row` (Q:127, 780). الرد لا يحوي أي مفتاح باسمهما. الواجهة تقرر أن التقرير شجري إذا وُجد المفتاح `indent` في أي صف: `this.tree_report = this.data.some(d => "indent" in d)` (JS:1080)، وتضبط `treeView` و`initial_depth` (JS:1121, 1137-1139). أسماء الأب/الابن (`parent_account`, `is_group_account`, `has_value`, `bold`...) خاصة بكل تقرير وليست جزءاً من عقد Frappe.

القيم: التواريخ تصل داخل بايثون كـ `datetime.date`/`datetime` والمبالغ `float`؛ عند الإرسال عبر HTTP تُحوَّل بـ `json_handler` (`frappe/utils/response.py:233-237`: `str(obj)` → `"YYYY-MM-DD"`، `timedelta` → `format_timedelta`). ملف التقرير المُعدّ يمر بالمحوّل نفسه عبر `frappe.as_json` (`frappe/__init__.py:1423-1435`، مع `sort_keys=True`).

### 4.3 صف المجموع: ملخص

- **مجموع Frappe** (Q:732-810): يُضاف فقط إذا `Report.add_total_row=1` و`result` غير فارغة و`skip_total_row` كاذب؛ قائمة بطول الأعمدة؛ آخر عنصر؛ بلا علامة. الحقول المجموعة: `Currency, Int, Float, Percent(متوسط), Duration, Time`؛ في الشجرة تُجمع الصفوف التي `parent_field` فيها فارغ فقط.
- **مجاميع يصنعها التقرير نفسه** (ليست من Frappe): Trial Balance يضيف صفاً `account = "'Total'"` بعلامتي اقتباس مفردتين (`erpnext/accounts/report/trial_balance/trial_balance.py:396`)؛ General Ledger يضيف `'Opening'`, `'Total'`, `'Closing (Opening + Total)'` (`general_ledger.py:398-406`)؛ Accounts Receivable مع `group_by_party` يضيف صفوفاً `bold: 1` وصفوفاً فارغة `{}` ويرفع `skip_total_row = 1` (`accounts_receivable.py:96-108`). الاقتباسات المفردة هي اصطلاح ERPNext لكي يميّزها الـ formatter في الواجهة (`erpnext/public/js/financial_statements.js:227-252`).

---

## 5. التجربة الفعلية على `$SITE` (Administrator، قراءة فقط)

بيانات الموقع المكتشفة بالاستعلام: شركة `SND Accounting` (عملة YER)، سنة مالية واحدة `2026` (2026-01-01 → 2026-12-31)، 538 قيد GL كلها لهذه الشركة بين 2026-03-18 و2026-09-29، 22 فاتورة مبيعات مرحّلة. إعدادات التقارير الثلاثة في قاعدة البيانات مطابقة لملفات JSON في erpnext: كلها `Script Report`، `is_standard=Yes`، `prepared_report=0`، `timeout=0`؛ `add_total_row` = 0 لـ Trial Balance وGeneral Ledger و**1** لـ Accounts Receivable؛ `ref_doctype` = `GL Entry` للأولين و`Sales Invoice` للثالث؛ الأدوار: Accounts User/Accounts Manager/Auditor (TB, GL) وAccounts User/Accounts Manager (AR).

الاستدعاء: `frappe.desk.query_report.run(name, filters=dict, is_tree=..., parent_field=...)` بعد `frappe.set_user("Administrator")` داخل السكربت. المخرجات الخام الكاملة في `docs/research/artifacts/query_report_run_tb_gl_ar.txt`.

### 5.1 Trial Balance

فلاتر: `{"company": "SND Accounting", "fiscal_year": "2026", "from_date": "2026-01-01", "to_date": "2026-12-31", "with_period_closing_entry_for_opening": 1, "with_period_closing_entry_for_current_period": 1, "show_zero_values": 0, "include_default_book_entries": 1}` مع `is_tree=True, parent_field="parent_account"` (كما ترسل الواجهة من `trial_balance.js:123-127`: `tree: true, name_field: "account", parent_field: "parent_account", initial_depth: 3`).

- مفاتيح الرد: `['result', 'columns', 'message', 'chart', 'report_summary', 'skip_total_row', 'status', 'execution_time', 'add_total_row']`.
- 10 أعمدة، 17 صفاً. الصفوف كلها `dict`.
- `columns[0]`: `{"fieldname": "account", "label": "Account", "fieldtype": "Link", "options": "Account", "width": 300}`
- `columns[1]`: `{"fieldname": "acc_name", "label": "Account Name", "fieldtype": "Data", "hidden": 1, "width": 250}`
- `result[0]`: `{"account": "1110 - نقد - SA", "parent_account": "1100 - النقدية الحاضرة - SA", "indent": 0, "from_date": "2026-01-01", "to_date": "2026-12-31", "currency": "YER", "is_group_account": 0, "acc_name": "نقد", "acc_number": "1110", "account_name": "1110 - نقد", "opening_debit": 0.0, "opening_credit": 0.0, "debit": 519611.0, "credit": 208725.0, "closing_debit": 519611.0, "closing_credit": 208725.0, "has_value": true}`
- `result[1]`: `{"account": "نقد دولار - SA", "parent_account": "1100 - النقدية الحاضرة - SA", "indent": 0, ... "debit": 583000.0, "credit": 27570.0, ...}`
- الصف الأخير من التقرير نفسه: `{"account": "'Total'", "account_name": "'Total'", "warn_if_negative": true, "debit": 30223624.0, "credit": 30223624.0, ..., "parent_account": null, "indent": 0, "has_value": true, "currency": "YER"}`.
- `indent` موجود في كل الصفوف (17/17)؛ بهذه الفلاتر (بلا `show_group_accounts`) كل القيم 0، لأن `hide_group_accounts` يصفّرها (`trial_balance.py:567-572`). عند إضافة `"show_group_accounts": 1, "show_net_values": 1` (افتراضيات الواجهة): 32 صفاً وقيم `indent` = `{0,1,2,3}`، مثال: `1000 - استخدام الاموال (الأصول) - SA` (indent 0, parent None, is_group 1) ← `1100-1600 - أصول متداولة - SA` (indent 1) ← `1100 - النقدية الحاضرة - SA` (indent 2).
- لا صفوف فارغة. `add_total_row: 0` (int)، `skip_total_row: 0`، `message/chart/report_summary: None`، `status: None`، `execution_time: 0.596`.
- أنواع القيم داخل بايثون: `from_date/to_date` → `datetime.date`، المبالغ `float`، `has_value` → `bool`.
- **لا يُضاف صف مجموع من Frappe** لأن `add_total_row=0`؛ صف `'Total'` من التقرير نفسه.

### 5.2 General Ledger

فلاتر: `{"company": "SND Accounting", "from_date": "2026-01-01", "to_date": "2026-12-31", "categorize_by": "Categorize by Voucher (Consolidated)", "include_default_book_entries": 1, ...}` بلا `is_tree`.

- نفس مفاتيح الرد. 17 عموداً، 523 صفاً. الصفوف كلها `frappe._dict`.
- `columns[0]`: `{"label": "GL Entry", "fieldname": "gl_entry", "fieldtype": "Link", "options": "GL Entry", "hidden": 1}`
- `columns[1]`: `{"label": "Posting Date", "fieldname": "posting_date", "fieldtype": "Date", "width": 120, "sticky": true}`
- **7 أعمدة بلا مفتاح `fieldtype` إطلاقاً**: مثال `{"label": "Voucher Type", "fieldname": "voucher_type", "width": 120}`، وكذلك `against`, `party_type`, `party`, `project` (له `options: "Project"` بلا نوع), `cost_center` (`options: "Cost Center"`), `against_voucher_type`. عمودا `voucher_no`/`against_voucher` من نوع `Dynamic Link`.
- `result[0]` (صف الافتتاح): `{"debit": 0.0, "credit": 0.0, "debit_in_account_currency": 0.0, "credit_in_account_currency": 0.0, "debit_in_transaction_currency": null, "credit_in_transaction_currency": null, "account": "'Opening'", "balance": 0.0, "account_currency": null, "presentation_currency": "YER"}` — مفاتيحه أقل من مفاتيح الصفوف العادية.
- `result[1]`: `{"gl_entry": "ACC-GLE-2026-00039", "posting_date": "2026-03-18", "account": "1310 - مدينون - SA", "party_type": "Customer", "party": "SND", "voucher_type": "Payment Entry", "voucher_subtype": "Receive", "voucher_no": "ACC-PAY-2026-00007", "cost_center": "رئيسي - SA", ..., "debit": 0.0, "credit": 100.0, "balance": -100.0, "presentation_currency": "YER", "creation": "2026-04-18T15:43:58.195333", ...}`.
- الصف الأخير: `account = "'Closing (Opening + Total)'"` مع `debit = credit = 30223624.0`. صفوف الملخص الثلاثة: `'Opening'`, `'Total'`, `'Closing (Opening + Total)'`.
- لا `indent`، لا صفوف فارغة، `add_total_row: 0`، `skip_total_row: 0`، `chart: None`، `execution_time: 0.30`.

### 5.3 Accounts Receivable

فلاتر: `{"company": "SND Accounting", "report_date": "2026-12-31", "ageing_based_on": "Due Date", "range": "30, 60, 90, 120", "party_type": "Customer"}`.

- نفس المفاتيح؛ 25 عموداً، 194 صفاً. **أنواع الصفوف مختلطة: `{'list', '_dict'}`** — 193 صف `_dict` + صف مجموع Frappe الأخير `list`.
- `columns[0]`: `{"label": "Posting Date", "fieldname": "posting_date", "fieldtype": "Date", "options": null, "width": 90, "sticky": false}`
- `columns[1]`: `{"label": "Party Type", "fieldname": "party_type", "fieldtype": "Data", "options": null, "width": 100, "sticky": false}`
- `result[0]`: `{"voucher_type": "Payment Entry", "voucher_no": "ACC-PAY-2026-00007", "party": "SND", "party_account": "1310 - مدينون - SA", "posting_date": "2026-03-18", "invoiced": 0.0, "paid": 100.0, "outstanding": -100.0, ..., "currency": "YER", "range0": 0.0, ..., "range5": -100.0, "age": 196, "total_due": -100.0}` (32 مفتاحاً؛ أكثر من الأعمدة الـ 25).
- `result[-1]` (صف مجموع Frappe، قائمة بطول 25): `["", "", "", "", "", "", "", "", "", "", 649.0, 885468.0, "", -884819.0, 18469.0, "", -345.0, -817013.0, -701.0, -681.0, -66079.0, "YER", "", "", ""]`. لاحظ: الخلية الأولى `""` لا `"Total"` لأن العمود الأول `Date` (Q:805-807)؛ `credit_note` (فهرس 12) و`range0` (15) بقيتا `""` لأن كل قيمهما صفر (`flt(cell)` كاذب في Q:779)؛ `currency` (فهرس 21، `Link/Currency`) نُسخت من الصف الأول = `YER` (Q:791-792)؛ `age` (Int) جُمع = 18469.
- `add_total_row: True` (bool)، `skip_total_row: 0`، `chart` قاموس: `{"data": {"labels": ["<0", "0-30", "31-60", "61-90", "91-120", "121-Above"], "datasets": [{"values": [...]}, ...]}, "type": "percentage"}`، `report_summary: None`، `execution_time: 0.15`.
- المتغير `group_by_party=1`: `skip_total_row: 1`، `add_total_row: False`، لا صف مجموع Frappe؛ 14 صفاً بـ `bold: 1` (آخرها `{"party": "Total", "bold": 1, "invoiced": 649.0, ...}`) و**13 صفاً فارغاً `{}`** كفواصل.

### 5.4 التقرير المُعدّ مسبقاً (Stock Balance، الوثيقة الموجودة `fgmec8i05u`)

- `Report.prepared_report` لـ Stock Balance = 1 على الموقع (ومطابق لـ `erpnext/stock/report/stock_balance/stock_balance.json`).
- `run("Stock Balance", {"company": "SND Accounting"})` → `{'prepared_report': True, 'doc': None, 'add_total_row': 1}` **بلا `result` ولا `columns`** رغم وجود وثيقة مكتملة بنفس الفلاتر، لأن مالكها ليس مستخدم الجلسة (`owner` شرط في P:249-258).
- `run("Stock Balance", {"company": "SND Accounting", "prepared_report_name": "fgmec8i05u"})` → مفاتيح `['chart', 'columns', 'execution_time', 'message', 'report_summary', 'result', 'skip_total_row', 'status', 'prepared_report', 'doc', 'add_total_row']` مع 6 صفوف.
- محتوى الملف بعد `gzip.decompress` + `json.loads`: قاموس بمفاتيح `chart, columns, execution_time (0.168771), message, report_summary, result, skip_total_row (0), status (None)`؛ `columns[0] = {'fieldname': 'item_code', 'fieldtype': 'Link', 'label': 'الصنف', 'options': 'Item', 'width': 100}` — التسمية مخزنة **مترجمة بلغة من ولّد التقرير** (ثم تُترجم مرة أخرى في Q:348-350 عند القراءة). `pr.get("columns")` = `None` (الحقل القديم غير موجود).

---

## 6. ملاحظات مهمة لتصميم report_view

1. المرور عبر `frappe.desk.query_report.run` يضمن: أدوار التقرير، صلاحية `report` على `ref_doctype`، user permissions على الأعمدة المرتبطة (`get_filtered_data`)، المشاركات، التقنيع، وصلاحيات قيم الفلاتر (`validate_filters_permissions`). لا شيء من هذا يحدث لو استُدعيت `execute` مباشرة.
2. الرد قد يخلو من `result/columns` (تقرير مُعدّ بلا نتيجة جاهزة). يجب التعامل مع `prepared_report: True, doc: None`.
3. الصفوف: قواميس عادةً، لكن صف مجموع Frappe قائمة، وقد توجد صفوف `{}` فارغة، وصفوف بمفاتيح أقل/أكثر من الأعمدة، وأعمدة بلا `fieldtype`.
4. الشجرة: العلامة الوحيدة العامة هي `indent`؛ `parent_field/name_field/initial_depth` تأتي من سكربت التقرير في المتصفح (`frappe.query_reports[name]`) لا من الخادم. للحصول عليها في الخادم يلزم `get_script` ثم تنفيذ/تحليل الـ JS — غير متاح كبيانات منظمة.
5. `add_total_row` في الرد قد يكون `0/1` أو `True/False`.
6. أي Script Report يتجاوز 15 ثانية يتحول تلقائياً إلى Prepared Report (كتابة في قاعدة البيانات من خيط جانبي)، ما لم يُفعَّل `disable_prepared_report_automation`.
7. التصدير الرسمي (`export_query`) يقرأ من `form_dict` فقط ويفحص `can_export` على `ref_doctype`، ثم يعيد تشغيل `run` كاملاً.

---

## 7. أسئلة مفتوحة

1. **الأعمدة بلا `fieldtype`** (General Ledger): كيف تنسّقها `frappe.format` في الواجهة وكيف يعاملها DataTable في الفرز/المجموع؟ لم يُتتبَّع في هذا المحور (يخص محور الواجهة).
2. **`is_tree=True` مع صفوف قوائم**: `row.get(parent_field)` في Q:780 سيرفع `AttributeError` على القوائم. لم يُختبر لعدم وجود تقرير شجري يعيد قوائم مع `add_total_row=1` على الموقع.
3. **مستخدم الفحوص داخل مهمة الخلفية**: `generate_report` يمرّر `user=instance.owner` إلى `generate_report_result`، لكن `has_unrestricted_read_access` (Q:998) و`Meta.get_masked_fields` (meta.py:202) و`Report.is_permitted` (R:154) تعتمد على `frappe.session.user`. ما هو `session.user` فعلياً داخل عامل RQ لهذه المهمة (Administrator أم المالك)؟ لم يُتحقق منه تجريبياً (يتطلب كتابة/إدراج وثيقة).
4. **تطابق فلاتر التقرير المُعدّ**: البحث في P:249-258 تطابق نصي تام؛ لم يُختبر ما إذا كانت الواجهة تُرسل دائماً نفس مجموعة المفاتيح عند العرض والتوليد (مثلاً فلاتر `Check` بقيمة 0 تُحذف في `get_filter_values` JS:1490 `f.get_value?.()`). السلوك عند اختلاف المفاتيح = لا نتيجة (`doc: None`).
5. **`Custom Report` مع Prepared Report**: `get_completed_prepared_report` يبحث باسم `report.custom_report` (Q:357) بينما `generate_report` يخزّن `instance.report_name` كما أُرسل من الواجهة؛ لم يُختبر التطابق لعدم وجود Custom Report على الموقع (`frappe.get_all("Report", {"report_type": "Custom Report"})` أعاد قائمة فارغة).
6. **خادم الويب يعيد 500** على `$SITE`؛ كل التجارب هنا عبر سكربت بايثون مباشر، فلم يُتحقق من الشكل الفعلي للرد بعد المرور بـ `json_handler` عبر HTTP (مثلاً تمثيل `timedelta` لعمود `Time`).
7. **`Report.timeout`** يظهر في النموذج بشرط `prepared_report`، لكنه يُقرأ في P:79 لأي وثيقة Prepared Report؛ هل يُطبَّق على التنفيذ المباشر (غير المُعدّ) بأي شكل؟ لم أجد استخداماً آخر له في `query_report.py` أو `report.py`.
8. **`Report Builder` عبر `run`**: `get_report_result` تعيد `None` (Q:61-74) فالرد `result: [], columns: []` بلا خطأ؛ لم يُختبر فعلياً.
