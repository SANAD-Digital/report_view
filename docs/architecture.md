# معمارية report_view

- الإصدار: 2 (المرحلة 2، معدَّل للتحول إلى Perspective في 2026-10-01؛ ADR-012)
- التاريخ: 2026-09-30
- الإصدارات المستهدفة: frappe 16.28.0، erpnext 16.29.0 (`docs/progress/phase-0.md`)
- المراجع: `docs/brief.md`، `docs/research/*.md`، `docs/adr/*.md`، `reference/design/` (تصدير Claude Design؛ انظر §11.0)

الرموز المختصرة للإحالات: `Q` = `frappe/desk/query_report.py`، `QJ` = `frappe/public/js/frappe/views/reports/query_report.js`، `R` = `frappe/core/doctype/report/report.py`، `P` = `frappe/core/doctype/prepared_report/prepared_report.py`.

---

## 1. هيكل التطبيق

```
apps/report_view/
├── CLAUDE.md  START.md  README.md  package.json  yarn.lock  # مكتبات وقت التشغيل فقط
├── docs/                      # التوثيق (عربي). لا يُنشر كأصول.
├── reference/                 # التصميم والنموذج (لا يُنشر)
├── scripts/                   # سكربتات تطوير (setup_test_users.py، توليد بيانات)
├── tests/
│   ├── package.json           # أدوات الاختبار (Playwright) بإصدار مثبّت ولها قفلها؛ لا تدخل node_modules التطبيق
│   ├── playwright.config.js   # e2e على موقع
│   ├── e2e/                   # Playwright
│   └── js/                    # اختبارات node:test للمحوّل والمحرك (بلا مكتبة إضافية)
└── report_view/               # حزمة بايثون
    ├── hooks.py               # السجل الكامل في ADR-007
    ├── install.py             # after_install: الدور Report View Manager + الإعدادات المشحونة
    ├── api/
    │   ├── __init__.py        # run, get_meta, enrich, export_xlsx(+status/cancel/download), get_entry_state، وضع «صفحات» (§2.10)
    │   ├── document.py  pdf.py  letterhead.py  custom_print.py  print_presets.py  chromium.py   # ADR-016..020 (§2.10)
    │   └── views.py           # «لم يُبنَ» (ADR-010)
    ├── core/
    │   ├── errors.py          # أصناف الأخطاء ورموزها (§2.0)
    │   ├── guard.py           # guard_report / guard_export / guard_print (§2.0)
    │   ├── runner.py          # غلاف query_report.run (ADR-002)
    │   ├── normalize.py       # المحوّل بايثون (§3)، توأم adapter/*.js
    │   ├── engine.py          # تطبيق حالة العرض للتصدير (§4.3)
    │   ├── expressions.py     # قواعد تعابير الفلاتر السريعة المغلقة للتصدير (ADR-013)
    │   ├── view_state.py      # المخطط والتحقق والترحيل (§7)
    │   ├── settings.py        # دمج الإعدادات (§5.3)
    │   ├── enrich.py          # «لم يُبنَ»: الإثراء في api.enrich نفسه (ADR-011)
    │   ├── jobs.py  limits.py  # حالة الوظائف الخلفية (Excel و PDF) وحد الطلبات لكل مستخدم
    │   ├── printing.py  pdf.py  chromium.py  letterhead.py  custom_print.py  print_presets.py  fonts.py   # الطباعة (ADR-014..020)
    │   └── export/
    │       ├── model.py       # التحقق من نموذج التصدير (§4)
    │       ├── xlsx.py        # openpyxl
    │       ├── jobs.py        # التصدير في الخلفية (§2.4)
    │       └── pdf.py         # «لم يُبنَ»: PDF من صفحات المتصفح بمحرك الخادم (ADR-016)
    ├── defaults/
    │   └── trial_balance.json # إعدادات ميزان المراجعة المشحونة
    ├── templates/report_view/
    │   └── print.html         # قالب PDF — «لم يُبنَ» (ADR-016)
    ├── locale/ar.po           # الترجمة العربية (نظام .po في frappe 16)
    ├── report_view/           # وحدة Frappe
    │   ├── page/report_view/  # مستند Page "report-view" (ADR-005): report_view.json، report_view.js
    │   └── doctype/
    │       ├── report_view_global_settings/   # Single
    │       ├── report_view_settings/          # سجل لكل تقرير — «لم يُبنَ» (§5.2)
    │       ├── report_view_column_rule/       # جدول فرعي — «لم يُبنَ»
    │       ├── report_view_enrich_rule/       # جدول فرعي — «لم يُبنَ»
    │       ├── report_view_drilldown/         # جدول فرعي — «لم يُبنَ»
    │       ├── report_view_balance_pair/      # جدول فرعي — «لم يُبنَ»
    │       ├── report_view_signature/         # جدول فرعي — «لم يُبنَ»
    │       ├── report_view_saved_view/        # «لم يُبنَ» (§6)
    │       ├── report_view_saved_view_role/   # جدول فرعي (Table MultiSelect) — «لم يُبنَ»
    │       ├── report_view_filter_def/        # جدول فرعي: تعريفات فلاتر خادمية (§2.1) — «لم يُبنَ»: filter_defs في defaults/*.json
    │       ├── print_signature/ print_signature_item/   # ADR-015
    │       ├── letter_head_layout/            # ADR-018
    │       └── print_preset/                  # ADR-020
    ├── tests/                 # اختبارات بايثون (bench run-tests --app report_view)
    │   ├── fixtures/normalize/*.json   # حالات مشتركة مع tests/js
    │   ├── test_guard.py  test_api_run.py  test_get_meta.py  test_enrich.py
    │   ├── test_normalize.py  test_engine.py  test_export.py  (test_saved_views.py «لم يُبنَ»)
    │   ├── test_api_pages.py  test_api_document.py  test_pdf.py  test_letterhead.py  test_custom_print.py  test_print_presets.py  test_chromium.py  test_hooks.py
    └── public/
        ├── fonts/<slug>/              # مكتبة خطوط ورق الشركة بتراخيصها (ADR-018)؛ NotoNaskhArabic لـ ADR-004 «لم يُبنَ»
        ├── css/
        │   ├── rv_tokens.css          # رموز التصميم فقط (من rv.css: .rv / .rv.compact / .rv.dark)
        │   ├── rv_components.css      # بقية rv.css
        │   ├── rv_page.css            # تخطيط الصفحة وعناصر Frappe
        │   └── rv_table.css           # ربط rv.css بعناصر regular-table (th/td وأصناف نضبطها في addStyleListener)
        └── js/
            ├── report_view.bundle.js          # يستورد كل ما تحت report_view/ + @finos/perspective (JS فقط) + regular-table + CSS
            ├── report_view_charts.bundle.js   # ECharts وعرض الرسوم؛ يُحمَّل عند فتح عرض الرسوم فقط
            │                                  # ملفا WASM وملف الـ worker أصول ثابتة من node_modules (§8أ.1)، لا bundle
            ├── report_view_entry.bundle.js    # زر الدخول في query-report (< 3 KB، بلا مكتبات)
            └── report_view/
                ├── index.js            # نقطة البداية: ReportViewPage
                ├── register.js         # report_view.register (§5.1)
                ├── api.js              # نداءات الخادم الموحّدة ومعالجة الأخطاء (§2.0)
                ├── format.js           # غلاف frappe.format (§9)
                ├── adapter/            # المحوّل: normalize.js، classify.js، columns.js، currency.js، tree.js
                ├── engine/             # perspective_engine.js (التحميل ودورة الحياة)، schema.js، view_config.js، tree_nodes.js، queries.js (قيم فريدة، نطاق، إجماليات)
                ├── state/              # view_state.js، migrate.js، url.js
                ├── filters/            # report_filters.js، facade.js (ADR-006)، period_picker.js
                ├── views/              # grid_view.js، pivot_view.js، charts_view.js (عرض فقط، بلا حساب)
                ├── components/         # انظر خريطة المكونات §11
                └── configs/
                    └── trial_balance.js
```

قواعد الهيكل:
- `adapter/` و `engine/view_config.js` و `engine/schema.js` و `engine/tree_nodes.js` وحدات ES خالصة: لا `frappe` ولا DOM ولا Perspective. تُختبر في `node --test`. `engine/perspective_engine.js` و `queries.js` وحدهما يلمسان Perspective، ويُختبران في المتصفح (Playwright) وفي node عبر `@finos/perspective` لـ node.
- `views/` و `components/` لا تحسب شيئاً؛ تستهلك مخرجات `view` فقط (قاعدة `frontend-dev`).
- المكتبات عبر npm في `package.json` بإصدار مثبّت بالضبط: `@finos/perspective@3.8.0`، `regular-table@0.9.1`، `echarts@5.6.0`، و `yarn.lock` (bench يثبّت بـ yarn) بالإصدارات نفسها التي في `package-lock.json`. `node_modules` التطبيق يُنشر تحت `/assets/report_view/node_modules`، فلا تدخله أدوات الاختبار: `@playwright/test` و `playwright` في `tests/package.json` بقفلها (`npm --prefix tests ci`). `http-server` و `zx` يبقيان لأنهما من اعتماديات `@finos/perspective` نفسها (`pro_self_extracting_wasm`). ممنوع `perspective-viewer` وإضافاته (ADR-012).
- لا منطق حساب خارج محرك Perspective في المتصفح: `views/` و `components/` تبني `view config` وتعرض ما يعيده `view`.

---

## 2. عقود الواجهات البرمجية

### 2.0 قواعد مشتركة

**الأخطاء.** كل خطأ متوقع صنف في `report_view/core/errors.py` يرث من صنف Frappe المناسب، واسم الصنف هو الرمز الذي تقرؤه الواجهة من `exc_type`:

| الرمز (`exc_type`) | يرث من | HTTP | متى |
|---|---|---|---|
| `PermissionError` (من Frappe) | — | 403 | رفض من `get_report_doc` نفسه (أدوار التقرير، `report` على `ref_doctype`) |
| `DoesNotExistError` (من Frappe) | — | 404 | التقرير غير موجود |
| `RVUnsupportedReport` | `frappe.ValidationError` | 417 | Report Builder أو نوع غير مدعوم |
| `ValidationError` (من Frappe) | — | 417 | التقرير معطّل: يرميه `get_report_doc` نفسه برسالته (`Q:55-56`)، ولا نغلّفه |
| `RVNoExport` | `frappe.PermissionError` | 403 | `can_export` فشل |
| `RVNoPrint` | `frappe.PermissionError` | 403 | لا صلاحية `print` على `ref_doctype` |
| `RVInvalidInput` | `frappe.ValidationError` | 417 | مدخل غير صالح (JSON، نوع، حجم) |
| `RVInvalidViewState` | `frappe.ValidationError` | 417 | حالة عرض لا تطابق المخطط أو تشير لأعمدة غير موجودة |
| `RVEnrichNotAllowed` | `frappe.PermissionError` | 403 | ثلاثية إثراء خارج قائمة السماح |
| `RVLimitExceeded` | `frappe.ValidationError` | 417 | تجاوز حد (أسماء الإثراء، حجم النموذج) |
| `RVExportMismatch` | `frappe.ValidationError` + `http_status_code=409` | 409 | إجماليات الخادم ≠ `expected_totals` (ADR-001) |
| `RVViewNotFound` | `frappe.DoesNotExistError` | 404 | عرض غير موجود، **أو** غير مرئي للمستخدم، **أو** لتقرير آخر. `get_view` يحوّل `PermissionError` الصادر من `check_permission('read')` إلى هذا الرمز حتى لا يكشف الوجود |
| `RVNotOwner` | `frappe.PermissionError` | 403 | تعديل/حذف عرض لست مالكه وتستطيع رؤيته (عام أو أدوار) |
| `RVReportError` | `frappe.ValidationError` | 417 | استثناء من كود التقرير نفسه؛ الرسالة الأصلية تُمرَّر، و Error Log يُسجَّل |

الحالات غير الاستثنائية (`too_large`، `prepared_pending`، `prepared_missing`) تُعاد كحقل `status` في رد ناجح.

**فحوص الصلاحية المشتركة** (`report_view/core/guard.py`)، تُستدعى في **أول سطر** من كل دالة whitelisted:

```
guard_report(report_name) -> Report
  1. report = frappe.desk.query_report.get_report_doc(report_name)
       # إعادة استخدام فحص Frappe نفسه (Q:24-55): is_permitted بالأدوار/Custom Role (R:140-155)،
       # has_permission(ref_doctype, "report")، disabled. لا نعيد تنفيذ شيء.
  2. if report.report_type not in ("Script Report", "Query Report"): raise RVUnsupportedReport
       # get_report_doc يحوّل Custom Report إلى تقريره المرجعي (Q:28-41)، فهو مدعوم ضمنياً.
  3. return report
  # ref_doctype إلزامي في Report (reqd=1)؛ تقرير بلا ref_doctype يفشل داخل get_report_doc نفسه
  # (has_permission(None) ⇒ DoesNotExistError) قبل أي فحص لاحق. لا نضيف فحصاً لا يُبلغ.

guard_export(report) : frappe.permissions.can_export(report.ref_doctype, raise_exception=False) or raise RVNoExport
guard_print(report)  : frappe.has_permission(report.ref_doctype, "print", ignore_share_permissions=True) or raise RVNoPrint
  # ignore_share_permissions ضروري: بدونه ينجح الفحص لأي مستخدم شُورك معه مستند واحد من ref_doctype
  # (permissions.py:178-209؛ ثبت على acc.dev لعشرة مستخدمين، docs/progress/phase-2-review.md ع1)

guard_report_quiet(report_name) -> Report | None
  # لـ get_entry_state فقط: guard_report داخل try، ثم مسح ما أضافه الفشل إلى
  # frappe.local.message_log حتى لا تصل رسائل الرفض إلى _server_messages.
```

- كل الدوال `@frappe.whitelist(methods=[...])` بلا `allow_guest`. GET للقراءة، POST لما يغيّر حالة أو يرسل نموذجاً كبيراً.
- المدخلات النصية JSON تُحلَّل بـ `frappe.parse_json` داخل `try` وترمي `RVInvalidInput`. حد حجم لكل معامل JSON: 256 KB.
- لا `ignore_permissions`، ولا `frappe.flags.ignore_permissions`، ولا `frappe.set_user`، ولا `frappe.db.sql` أو `frappe.get_all` أو `frappe.db.get_all` في أي مسار يعيد بيانات. القراءة بـ `frappe.get_list` أو `frappe.get_doc` متبوعاً بـ `doc.check_permission("read")`.

### 2.1 `report_view.api.run(report_name, filters, js_filters=None, prepared_report_name=None)`

| البند | المواصفة |
|---|---|
| الطريقة | POST (الفلاتر قد تكون كبيرة) |
| المدخلات | `report_name: str`؛ `filters: dict \| str(JSON)`؛ `js_filters: list[dict] \| str(JSON) \| None` = تعريفات فلاتر سكربت التقرير كما حمّلتها الواجهة (`fieldname`, `fieldtype`, `options`)؛ `prepared_report_name: str \| None` |
| الفحوص بالترتيب | (1) `guard_report`؛ (2) تحقق شكل `filters` (قاموس، مفاتيح نصية، قيم بدائية أو قوائم)؛ (3) `js_filters` = **اتحاد** ما يرسله المتصفح مع `Report View Settings.filter_defs` الخادمية (الخادمية تغلب عند تعارض نفس `fieldname`). للصدق: `Report.filters` يُفحص في Frappe أصلاً (`Q:1146`)، وتعريفات المتصفح قابلة للتزوير (`fieldtype: Data` يعطّل فحص الحقل)، فهي تساوي حماية الصفحة الأصلية لا أكثر. الحماية التي لا يستطيع المستخدم إسقاطها هي `filter_defs` الخادمية فقط، ويُشحن منها لميزان المراجعة `company` و `fiscal_year`؛ (4) `prepared_report_name` إن وُجد: `frappe.get_list("Prepared Report", filters={"name": n, "report_name": report.get("custom_report") or report.name, "owner": frappe.session.user}, limit=1)` وإلا `RVInvalidInput`، لأن Frappe لا يقارنه بالتقرير ولا بالمالك (`Q:282-284,360`) وقد يكشف نتيجة ولّدها مستخدم غير مقيّد (ADR-009)؛ (5) استدعاء `frappe.desk.query_report.run(report_name, filters=filters, js_filters=js_filters, are_default_filters=False)` مع `prepared_report_name` داخل `filters` كما تفعل الواجهة الأصلية (`Q:282`)؛ فيه تحدث طبقات Frappe: `validate_filters_permissions` (`Q:261`)، `get_report_doc` مرة ثانية، `get_filtered_data` (`Q:122`) |
| المخرجات | `{"status": "ok", "raw": <رد run كما هو>, "row_count": int, "limit": int, "execution_time": float}`؛ أو `{"status": "too_large", "row_count", "limit"}` بلا `raw` (ADR-009)؛ أو `{"status": "prepared_pending" \| "prepared_missing", "prepared_report_name": str \| None, "doc": {...} \| None}` حين يأتي رد Prepared بلا `result` (`Q:370`) |
| الأخطاء | `PermissionError`، `DoesNotExistError`، `ValidationError` (معطّل)، `RVUnsupportedReport`، `RVInvalidInput`، `frappe.ValidationError` من `validate_filters_permissions` أو من الفلاتر الإلزامية، `RVReportError` (يغلّف أي استثناء آخر من كود التقرير مع الرسالة) |
| ملاحظات | لا يطبّع الخادم الرد هنا: التطبيع في المتصفح (ADR-001). `row_count` = طول `result` بعد استبعاد صف مجموع Frappe. الرسائل في `frappe.local.message_log` تمر كما هي في `_server_messages`. |

### 2.2 `report_view.api.get_meta(report_name)`

| البند | المواصفة |
|---|---|
| الطريقة | GET |
| الفحوص بالترتيب | (1) `guard_report`؛ (2) الإعدادات من `report_view/defaults/<scrub(report)>.json` وحدها (`core/settings.load_settings`)؛ قراءة `Report View Settings` «لم يُبنَ»؛ (3) حساب `perms` بـ `can_export` و `has_permission(..., "print", ignore_share_permissions=True)` دون رمي |
| المخرجات | ```{"report": {"name", "report_type", "ref_doctype", "module", "is_standard", "prepared_report", "add_total_row", "reference_report"}, "script": <مخرج frappe.desk.query_report.get_script(report_name) كما هو: script, html_format, filters, custom_report_name, execution_time>, "perms": {"can_export": bool, "can_print": bool}, "settings": <الإعدادات الخادمية المدمجة §5.3>, "include_js": [bundle...] (من hook report_view_include_js), "limits": {"max_rows": int}, "defaults": {"saved_view": name \| null, "source": "user" \| "global" \| null}}``` — الافتراضي يُعاد فقط إن كان العرض مرئياً للمستخدم الآن (§6)، وإلا `null`. اليوم `defaults` دائماً `{saved_view: null, source: null}` لأن العروض المحفوظة «لم يُبنَ» |
| الأخطاء | كما `guard_report` |
| ملاحظات | `perms` للعرض فقط (إخفاء الأزرار). الفحص الحقيقي يتكرر في `export_xlsx` و `export_pdf`. `script` يُنفَّذ في المتصفح بـ `frappe.dom.eval` كما في الأصل (`QJ:425-427`). |

### 2.3 `report_view.api.enrich(report_name, doctype, names, fields, source_column)`

| البند | المواصفة |
|---|---|
| الطريقة | POST |
| المدخلات | `report_name: str`، `source_column: str` (fieldname العمود في التقرير)، `doctype: str`، `names: list[str]` (≤ 5,000)، `fields: list[str]` |
| الفحوص بالترتيب | (1) `guard_report`؛ (2) الثلاثية (`source_column`, `doctype`, كل حقل) موجودة في `enrich_rules` المدمجة للتقرير، وإلا `RVEnrichNotAllowed`؛ أي حقل بصيغة `link.field` أو فيه أقواس أو مسافات يُرفض؛ (3) `len(names) <= 5000` وإلا `RVLimitExceeded`؛ (4) `fields ∩ frappe.get_meta(doctype).get_permitted_fieldnames(user=frappe.session.user)` (`frappe/model/meta.py:684`)؛ الحقول المحذوفة تُذكر في `dropped_fields`؛ (5) `frappe.get_list(doctype, filters={"name": ["in", names]}, fields=["name", *permitted], limit_page_length=0)`؛ في v16 يطبّق `get_list` صلاحيات الحقول و User Permissions بنفسه (`frappe/database/query.py:352-353,1376`)، فالخطوة (4) دفاع إضافي |
| المخرجات | `{"doctype", "rows": {name: {field: value}}, "dropped_fields": [..], "missing": int}` (`missing` = أسماء لم يعدها `get_list` لغياب الصلاحية أو الوجود؛ بلا تفاصيل) |
| الأخطاء | `RVEnrichNotAllowed`، `RVLimitExceeded`، `RVInvalidInput` + أخطاء `guard_report` |

### 2.4 `report_view.api.export_xlsx(report_name, export_model)`

| البند | المواصفة |
|---|---|
| الطريقة | POST |
| الفحوص بالترتيب | (1) `guard_report`؛ (2) `guard_export`؛ (3) التحقق من `export_model` (§4.2)؛ (4) `runner.run(...)` بنفس مسار §2.1 (يعيد تشغيل التقرير)؛ (5) `normalize` ← `engine.apply(view_state)`؛ (6) مقارنة `expected_totals` (ADR-001)؛ (7) بناء الملف |
| المخرجات | ملف ثنائي عبر `frappe.response.filename/filecontent/type="binary"`؛ أو فوق `ASYNC_ROWS` (20,000) صف: `{"status": "queued", "job", "row_count"}` (`core/export/jobs.py`). الوظيفة على الطابور `report_view_export_queue` من إعداد الموقع (افتراضي `long`)، ووظيفة واحدة لكل مستخدم. المتصفح يسأل `export_xlsx_status(job)` (`{state, row_count, error, error_code, cancellable}`؛ عامل قُتل أو طابور بلا عامل يُقرأ `failed` بـ `error_code` = `lost` / `no_worker`)، ويلغي بـ `export_xlsx_cancel(job)`، وينزّل بـ `export_xlsx_download(job)` مرة واحدة (الملف خاص في `private/rv_xlsx` ويُحذف عند التنزيل أو بعد ساعة). حالة الوظيفة ومنطق الحياة مشتركان مع PDF في `core/jobs.py`. `publish_realtime` و File «لم يُبنَ» |
| الأخطاء | `RVNoExport`، `RVInvalidInput`، `RVInvalidViewState`، `RVExportMismatch`، `RVLimitExceeded` (`too_large`) + أخطاء §2.1 |

### 2.5 `report_view.api.export_pdf(report_name, export_model)` — «لم يُبنَ»

> لم يُبنَ بهذا الشكل: PDF يُطبع من صفحات وضع «صفحات» في المتصفح بمحرك Chromium على الخادم (`report_view.api.pdf.pages_pdf_report/document/custom`، ADR-016، §2.10)، و ADR-004 مستبدَل. المواصفة أدناه الخطة الأصلية.

مثل §2.4 تماماً، مع استبدال (2) بـ `guard_print` وحده. القرار: PDF طباعة، فيحتاج `print` فقط كما في الأصل (زرا الطباعة و PDF في query-report مشروطان بـ `can_print` وحده، `QJ:1956,1974`)؛ اشتراط `export` أيضاً أشد من الأصل بلا سبب. Excel و CSV تصدير ويحتاجان `export`. المخرجات ملف PDF بقالب `templates/report_view/print.html` و `frappe.utils.pdf.get_pdf` أو chrome حسب `settings.pdf_generator` (ADR-004). حقول إضافية في النموذج: `orientation`، `signatures: bool`، `page_size`.

### 2.6 `report_view.api.get_entry_state(report_name)`

للزر في query-report (ADR-007). GET. الفحوص: `guard_report_quiet` (أي فشل ⇒ `{"show": false}` بلا رسائل في `_server_messages`). لا يكشف أكثر من الأصل: من يرى الزر فتح query-report للتقرير نفسه. المخرجات: `{"show": true, "route": ["report-view", <name>]}` أو `{"show": false}`. لاحقاً (المرحلة 4) يُقيَّد بـ `Global Settings.entry_button_scope` و `Report View Settings.show_entry_button`؛ إلى أن توجد هذه الإعدادات يظهر الزر لكل من يملك صلاحية التقرير.

### 2.7 العروض المحفوظة: `report_view.api.views.*` — «لم يُبنَ»

> لم يُبنَ (ADR-010 مقبول ولم يُنفَّذ). المواصفة أدناه الخطة.

كل الدوال تأخذ `report_name` أولاً وتبدأ بـ `guard_report(report_name)`، لأن رؤية العرض مشروطة برؤية التقرير (ADR-010).

| الدالة | الطريقة | المدخلات | الفحوص بعد `guard_report` | المخرجات | الأخطاء |
|---|---|---|---|---|---|
| `list_views(report_name)` | GET | — | `frappe.get_list("Report View Saved View", filters={"report": report_name}, fields=[...])`؛ الـ pqc (§6) يحصر النتائج، ثم يُطبَّق `is_visible` صراحة على النتيجة (Administrator يتجاوز hook القراءة) | `[{name, title, visibility, owner, is_owner, is_global_default, is_user_default, modified}]`؛ `is_global_default` محسوب من `Report View Settings.default_saved_view`، و `is_user_default` من `frappe.defaults` | — |
| `get_view(report_name, name)` | GET | `name` | `frappe.get_doc` ثم `check_permission("read")` (hook `has_permission`)، ثم `is_visible` صراحة، ثم `doc.report == report_name`. `PermissionError` و `DoesNotExistError` ⇒ `RVViewNotFound` | `{name, title, visibility, roles, state (بعد الترحيل §7.3), is_owner}` | `RVViewNotFound` |
| `save_view(report_name, title, state, visibility="Private", roles=None, name=None)` | POST | `state: dict` | التحقق كله في `validate` المتحكم (§6) ليشمل REST؛ الدالة تبني المستند فقط؛ جديد: `insert()` بصلاحيات افتراضية؛ تعديل: `get_doc` + `check_permission("write")` (المالك فقط) ثم `save()` | `{name, modified}` | `RVInvalidViewState`، `RVInvalidInput`، `RVViewNotFound`، `RVNotOwner` |
| `delete_view(report_name, name)` | POST | `name` | `get_doc` + `check_permission("delete")` (المالك فقط) ثم `delete()`. لا حقول Link تشير إليه (افتراضي المستخدم في `frappe.defaults`، والعام حقل Data)، فلا `LinkExistsError` (§5.2، §6) | `{"ok": true}` | `RVViewNotFound`، `RVNotOwner` |
| `set_default(report_name, name=None)` | POST | `name` أو `None` للإلغاء | العرض مرئي للمستخدم (`get_view`)، ثم `frappe.defaults.set_user_default("report_view_default::" + report_name, name)` للمستخدم الحالي فقط (أو `clear_user_default` عند `None`). لا مسار لضبط افتراضي مستخدم آخر. الافتراضي العام في `Report View Settings.default_saved_view` بصلاحيات ذلك النوع (§5.2) | `{"ok": true}` | `RVViewNotFound` |

**واجهات Frappe القياسية.** `/api/resource/Report View Saved View` و `frappe.client.get_list/get` و `frappe.desk.reportview.get` لا تمر بـ `guard_report`. لذلك قاعدة «رؤية العرض مشروطة برؤية التقرير» تُنفَّذ أيضاً في الـ pqc و hook القراءة (§6)، لا في الـ API وحده.


### 2.8 وضع «صفحات»: `get_print_options`، `get_print_format` (ADR-014)

| الدالة | الطريقة | الفحوص | المخرجات |
|---|---|---|---|
| `get_print_options(report_name, company=None)` | GET | `guard_report` ثم `guard_print`؛ الترويسات بـ `frappe.get_list("Letter Head", disabled=0)` إن كان للمستخدم قراءتها (وإلا لا شيء، كما في boot)؛ الترويسة الافتراضية من `Company.default_letter_head` (بصلاحية الشركة) ثم `is_default`؛ قوالب التقرير بـ `frappe.get_list("Print Format", print_format_for=Report, report in [report_name, الاسم المحلول], print_format_type=JS, disabled=0)`؛ اللغات المفعّلة | `{letter_heads: [{name, is_default}], default_letter_head, print_formats: [name], languages: [{name, label}], lang}` |
| `get_print_format(report_name, name)` | GET | `guard_report` ثم `guard_print`، ثم وجود القالب بالفلاتر نفسها (`DoesNotExistError`)، ثم `frappe.get_doc` لقراءة `html` و`css` كما تقرؤها `frappe.www.printview` لمن يملك طباعة المستند | `{name, html, css}` |

### 2.8أ رأس الطباعة والتوقيع: `render_print_heading`، `render_print_signature` (ADR-015)
POST. `(report_name, name, filters, filter_meta?)`. الفحوص: `guard_report` ثم `guard_print`، ثم `frappe.get_list` على `Print Heading` / `Print Signature` (مفعّل، نوع Report، لهذا التقرير أو للكل). المخرجات: `{name, title, html}` للرأس و `{name, type, html, css}` للتوقيع (`css` مضمَّن في `.rv-signature`). `get_print_options` يعيد أيضاً `print_headings` و `print_signatures` و `defaults` (الإعدادات القياسية من `Report View Global Settings`) و `limits.print_max_pages`.

### 2.9 الترجمة: `get_translations(report_name, lang, messages)` (ADR-014)

POST. `guard_report` أولاً. `lang` من `frappe.translate.get_all_languages()` وإلا `RVInvalidInput`؛ `messages` قائمة نصوص (حد 2,000). المخرجات: `{msgid: ترجمة}` لما له ترجمة في `get_all_translations(lang)` (المفاتيح ذات السياق كما يخزّنها Frappe: `"<msgid>:<context>"`). الاستعمال: كلمات الصفحة وتسميات السجل والفلاتر حين تُطبع الصفحات بلغة غير لغة الجلسة؛ تسميات التقرير نفسه تأتي من `api.run` بمعامل `_lang` (Frappe يقرأه قبل الطلب).

### 2.10 كل الدوال المتاحة (الموجودة فعلاً، 2026-10-22)

46 دالة `@frappe.whitelist()`. «الحد» = طلبات لكل مستخدم في الدقيقة (`core/limits.rate_limit`، داخل طلب ويب فقط؛ الرفض `RateLimitExceededError` من Frappe). كل دالة تبدأ بالحارس المذكور. القسمان §2.5 و §2.7 خطة لم تُبنَ.

| الدالة | الطريقة | الحارس الأول | الحد | المرجع |
|---|---|---|---|---|
| `report_view.api.run` | POST | `guard_report` | 30 | §2.1 |
| `report_view.api.get_meta` | GET | `guard_report` | — | §2.2 |
| `report_view.api.get_entry_state` | GET | `guard_report_quiet` | — | §2.6 |
| `report_view.api.enrich` | POST | `guard_report` | 60 | §2.3 |
| `report_view.api.export_xlsx` | POST | `guard_report`، `guard_export` | 10 | §2.4 |
| `report_view.api.export_xlsx_status` | GET | وظيفة المستخدم نفسه، ثم `guard_report` و `guard_export` | — | §2.4 |
| `report_view.api.export_xlsx_cancel` | POST | كالسابق | — | §2.4 |
| `report_view.api.export_xlsx_download` | GET | كالسابق | — | §2.4 |
| `report_view.api.get_print_options` | GET | `guard_report`، `guard_print` | — | §2.8 |
| `report_view.api.get_print_format` | GET | `guard_report`، `guard_print` | — | §2.8 |
| `report_view.api.render_print_format` | POST | `guard_report`، `guard_print` | 10 | ADR-014 |
| `report_view.api.render_print_heading` | POST | `guard_report`، `guard_print` | — | §2.8أ |
| `report_view.api.render_print_signature` | POST | `guard_report`، `guard_print` | — | §2.8أ |
| `report_view.api.get_translations` | POST | `guard_report` | — | §2.9 |
| `report_view.api.document.get_doc_print_options` | GET | `guard_doc_print` | — | ADR-017 |
| `report_view.api.document.render_doc_print` | GET | `guard_doc_print` | — | ADR-017 |
| `report_view.api.document.render_doc_heading` | POST | `guard_doc_print` | — | ADR-017 |
| `report_view.api.document.render_doc_signature` | POST | `guard_doc_print` | — | ADR-017 |
| `report_view.api.document.get_doc_translations` | POST | `guard_doc_print` | — | ADR-017 |
| `report_view.api.document.render_doc_letterhead` | GET | `guard_doc_print` | — | ADR-017 |
| `report_view.api.pdf.pages_pdf_report` | POST | `guard_report`، `guard_print` | 10 | ADR-016 |
| `report_view.api.pdf.pages_pdf_document` | POST | `guard_doc_print` | 10 | ADR-016 |
| `report_view.api.pdf.pages_pdf_custom` | POST | `custom_print.resolve` (قالب يطبع به المستخدم أو رمز مرحلي له) | 10 | ADR-019 |
| `report_view.api.pdf.pages_pdf_status` | GET | وظيفة المستخدم نفسه | — | ADR-016 |
| `report_view.api.pdf.pages_pdf_cancel` | POST | وظيفة المستخدم نفسه | — | ADR-016 |
| `report_view.api.pdf.pages_pdf_download` | GET | وظيفة المستخدم نفسه | — | ADR-016 |
| `report_view.api.letterhead.builder_context` | GET | قراءة Letter Head و Company | 60 | ADR-018 |
| `report_view.api.letterhead.company_data` | GET | قراءة Letter Head و Company | 60 | ADR-018 |
| `report_view.api.letterhead.preview` | POST | قراءة Letter Head و Company | 120 | ADR-018 |
| `report_view.api.letterhead.save` | POST | إنشاء/كتابة Letter Head | 20 | ADR-018 |
| `report_view.api.letterhead.qr_svg` | GET | قراءة Letter Head و Company | 60 | ADR-018 |
| `report_view.api.custom_print.formats` | GET | `frappe.get_list` لقوالب Custom التي يطبع بها المستخدم | — | ADR-019 |
| `report_view.api.custom_print.stage` | POST | `guard_custom_format` أو `guard_inline` | 30 | ADR-019 |
| `report_view.api.custom_print.staged` | GET | `custom_print.resolve` | — | ADR-019 |
| `report_view.api.custom_print.get_options` | GET | `custom_print.resolve` | — | ADR-019 |
| `report_view.api.custom_print.render` | POST | `custom_print.resolve` | 60 | ADR-019 |
| `report_view.api.custom_print.render_letterhead` | GET | `custom_print.resolve` | — | ADR-019 |
| `report_view.api.custom_print.render_heading` | POST | `custom_print.resolve` | 60 | ADR-019 |
| `report_view.api.custom_print.render_signature` | POST | `custom_print.resolve` | 60 | ADR-019 |
| `report_view.api.custom_print.get_translations` | POST | `custom_print.resolve` | — | ADR-019 |
| `report_view.api.print_presets.list` | GET | `guard_target` (التقرير أو المستند أو قالب Custom) | — | ADR-020 |
| `report_view.api.print_presets.save` | POST | `guard_target` ثم صلاحية الإعداد | 60 | ADR-020 |
| `report_view.api.print_presets.delete` | POST | صلاحية الإعداد (`has_permission` لـ Print Preset) | — | ADR-020 |
| `report_view.api.print_presets.set_default` | POST | صلاحية الإعداد | — | ADR-020 |
| `report_view.api.chromium.engine_status` | GET | `frappe.only_for("System Manager")` | — | ADR-016 |
| `report_view.api.chromium.engine_install` | POST | `frappe.only_for("System Manager")` | — | ADR-016 |

`guard_doc_print` (`core/guard.py`) هو فحص طباعة المستند الوحيد: نوع مستند موجود وليس جدولاً فرعياً، ثم `print` على النوع، ثم على المستند نفسه.

---

## 3. عقد التطبيع

### 3.1 المدخل والمخرج

المدخل: `raw` من `api.run` (§2.1)، و `meta` من `get_meta`، و `filters` الحالية، و `config` المدمجة (§5.3).

المخرج (`NormalizedReport`)، بنفس الشكل في JS (`adapter/normalize.js`) وبايثون (`core/normalize.py`):

```
{
  columns: [Column],            # بالترتيب الأصلي
  rows:    [Row],               # كل صفوف التقرير بعد التصنيف، بالترتيب الأصلي (للعرض الشجري "كما هو")
  facts:   [Row],               # جدول الحقائق: rows حيث kind == "data" و (ليست شجرة أو is_leaf)
  tree:    {enabled, id_key, parent_key, label_key, initial_depth} | null,
  report_totals: {frappe_total: {key: value} | null, internal: [Row]},
  message, chart, report_summary,   # بعد التطبيع §3.4
  flags:   {add_total_row: bool, skip_total_row: bool, prepared: bool, mixed_row_shapes: bool},
  notices: [ {code, detail} ]   # ملاحظات غير قاتلة تظهر في وضع التطوير وفي حالة الخطأ
}

Column = {
  key,            # معرّف فريد داخل العرض (= fieldname، أو fieldname__2 عند التكرار)
  fieldname,      # كما وصل أو scrub(label)؛ قد يكون غير ASCII
  label, fieldtype (قانوني), options, width, hidden: bool, export_hidden: bool,
  role: "dimension" | "measure" | "attribute",
  agg:  "sum" | "avg" | "count" | "min" | "max" | null,
  currency: {kind: "row", key} | {kind: "company", company_key} | {kind: "system"} | null,
  link: {kind: "static", doctype} | {kind: "dynamic", doctype_key} | {kind: "filter", filter} | null,
  date: bool,     # Date/Datetime ⇒ أبعاد مشتقة سنة/ربع/شهر في المحرك
  source_index,   # موضعه في رد التقرير
  original: {...} # العمود الأصلي كاملاً، للـ formatter الأصلي
}

Row = { __rid: int, __kind: "data" | "frappe_total" | "internal_total" | "opening" | "closing"
                        | "group_header" | "separator",
        __indent: int | null, __parent: __rid | null, __is_leaf: bool, __bold: bool,
        __label_raw: str | null,     # القيمة المقتبسة الأصلية (مثل "'Total'") إن نُزع اقتباسها في N3.2، وإلا null
        <key>: value ... }           # القيم الخام بلا تنسيق
  # (المرحلة 3) الصف يحتفظ بكل مفاتيح صف التقرير الأصلية (مثل parent_account و indent و bold) لأن
  # الـ formatter الأصلي والعملة (options اسم مفتاح في الصف) يحتاجانها، ثم يُضاف لكل عمود مفتاحه
  # `key`: القيمة المفقودة ⇒ null (لا undefined)، وعمود مكرر (`fieldname__2`) ينسخ قيمة `fieldname`.
  # صف القائمة يُحوَّل بالموضع إلى مفاتيح الأعمدة فقط.
```

### 3.2 خطوات التطبيع (بالترتيب، وكل خطوة لها رقم يُشار إليه في §3.5)

**N1 — الأعمدة.**
1. عمود نصي `"Label:Fieldtype/Options:Width"` يُحلَّل بنفس قاعدة `get_column_as_dict` (`Q:1094-1117`): `fieldname = scrub(label)` إن غاب. (الخادم يفعل هذا في `run` أصلاً، والتكرار هنا دفاعي لصالح بايثون والحالات المشتركة.)
2. `fieldtype` غائب ⇒ `"Data"` (GL: 7 أعمدة، Stock Ledger، Stock Balance، Stock Projected Qty). لا نستنتج نوعاً رقمياً من القيم، لأن الأصل يعرضها نصاً.
3. `fieldtype` بحالة أحرف غير قياسية (`"float"`) ⇒ يُطابَق بلا حساسية للحالة مع قائمة أنواع Frappe ويُحوَّل إلى الشكل القانوني (`"Float"`)، مع `notice FIELDTYPE_CASE`.
4. `fieldname` غائب ⇒ `scrub(label)` (Gross Profit `posting_date`). التكرار ⇒ `key = fieldname + "__" + n`.
5. `hidden: 1` ⇒ `hidden: true`؛ `export_hidden = report_settings.export_hidden_cols === true` (Trial Balance، القوائم المالية).
6. **الدور:**
   - `Currency`, `Float`, `Int`, `Percent`, `Duration` ⇒ `measure`؛ `agg`: `Percent` ⇒ `avg`، الباقي `sum`.
   - `Link`, `Dynamic Link`, `Data`, `Select`, `Date`, `Datetime`, `Check` ⇒ `dimension`.
   - الأعمدة المخفية، وأي عمود يُشار إليه كعملة لعمود آخر، والقيم القوائمية (مثل `sales_person: []`) ⇒ `attribute`.
   - `Report View Settings.column_rules` ثم `register.columns` يمكنهما تغيير `role` و `agg` (§5.3).
7. **العملة** (`meta.js:295-325`):
   - `options` اسم عمود موجود في الأعمدة أو في أول صف بيانات ⇒ `{kind: "row", key}` (`currency`، `presentation_currency`، `transaction_currency`).
   - `options` بصيغة `"Company:company:default_currency"` ⇒ `{kind: "company", company_key: "company"}`؛ القيمة من الصف إن وُجد فيه `company`، وإلا من فلتر `company`، وإلا عملة النظام.
   - بلا `options` ⇒ `{kind: "system"}`.
8. **Link:** `Link` بخيار ثابت ⇒ `static`؛ `Dynamic Link` ⇒ `dynamic` على العمود المسمى في `options`؛ `Link` خياراته اسم فلتر (`party_type`، `tree_type`، `doctype`، `budget_against`) ⇒ `filter` ويُحَل من قيمة الفلتر الحالية؛ Gross Profit يكتب `column._options` لكل صف في الـ formatter الأصلي (`js:100-104`) ⇒ نتركه للـ formatter الأصلي ولا نبني رابطاً.

**N2 — أشكال الصفوف.**
1. آخر صف قائمة (`Array`) و `add_total_row` صادق و `skip_total_row` كاذب ⇒ `frappe_total` (`Q:732-810`). يُحفظ في `report_totals.frappe_total` ويُستبعد من `rows` و `facts`، كما تحذفه الواجهة الأصلية (`QJ:1101-1104`).
2. أي صف آخر قائمة ⇒ يُحوَّل إلى قاموس بترتيب الأعمدة (`source_index`)؛ إن كانت أطوال الصفوف مختلفة تُكمَّل بـ `null`. `flags.mixed_row_shapes = true` إذا اختلطت قوائم وقواميس (Gross Profit حسب `group_by`).
3. `skip_total_row`: نتبع صدقية Frappe نفسها (أي قيمة صادقة ⇒ تخطٍّ). القيمة الرقمية المسرّبة في BS/P&L (`balance_sheet.py:124`، `profit_and_loss_statement.py:92`) لا أثر لها لأن `add_total_row=0` لهما؛ تُسجَّل `notice SKIP_TOTAL_NON_BOOL`.
4. `add_total_row` قد يصل `0/1` أو `True/False` ⇒ `bool`.

**N3 — تصنيف الصفوف** (أول قاعدة تنطبق):
1. **فاصل:** لا توجد قيمة ذات معنى في أي عمود `dimension` (القيم `null`، `""`، أو غياب المفتاح)، ولا قيمة **غير صفرية** في أي عمود `measure`. (تعديل المرحلة 3: الصيغة الأولى «الصفر ذو معنى» جعلت فواصل GL حقائق، لأن صفوف GL شبه الفارغة تحمل `balance: 0` فعلياً على `acc.dev`. الصفر يبقى ذا معنى في أي صف له بُعد.) يشمل `{}` في BS/PL/CF و AR/AP و Sales Analytics، والصفوف شبه الفارغة في GL التي تحمل `presentation_currency` فقط (لأن العملة `attribute`). ⇒ `separator`.
2. **مجموع داخلي بعنوان مقتبس:** قيمة **عمود العنوان** (§3.2 N4.1)، ثم بقية أعمدة `dimension` بترتيبها، أول نص يبدأ وينتهي بـ `'` (تعديل المرحلة 3: عمود العنوان في GL هو `posting_date` بينما `'Opening'` في `account`، وفي AR العنوان `party_type` بينما `"Total"` في `party`؛ القاعدة نفسها تنطبق على N3.3) ⇒ يُنزع الاقتباس للعرض ويُحفظ الأصل في `__label_raw`، ثم: `'Opening'` ⇒ `opening`؛ `'Closing (Opening + Total)'` ⇒ `closing`؛ غيرها (`'Total'`, `'Totals'`, `'Total Asset (Debit)'`, `'Provisional Profit / Loss (Credit)'`، …) ⇒ `internal_total`. الاقتباس في الأصل لتعطيل الرابط، فلا رابط لهذه الصفوف.
3. **مجموع داخلي بلا اقتباس:** `bold` صادق وقيمة عمود العنوان (أو أي عمود `dimension` بالترتيب نفسه) تساوي `"Total"` أو `_("Total")` (AR `party:"Total"`، Gross Profit `sales_invoice:"Total"`، Employee Advance Summary `title=_("Total")`) ⇒ `internal_total`.
4. **مصنّف مخصص:** `register.classify_row(row, ctx)` إن وُجد، يعيد أحد الأنواع أو `undefined` للمتابعة.
5. **رأس مجموعة:** إذا كانت الشجرة مفعّلة (N4) والصف بلا `indent` ويليه صف بـ `indent > 0` ⇒ `group_header` بعمق 0 (Employee Leave Balance، Sales Analytics/All). وفي الشجرة، أي صف له أبناء ليس «ورقة» لكنه يبقى `data` (Trial Balance: الحسابات الأب صفوف `data` بـ `__is_leaf=false`).
6. **مجموعة بلا indent:** صف يحوي عمود التجميع فقط (Monthly Attendance Sheet مع `group_by`: `{"department": v}`) ⇒ `group_header`، ويُحدَّد عبر `register.group_header_key` أو تلقائياً: كل أعمدة `measure` فارغة وقيمة واحدة فقط في الأبعاد.
7. `bold` صادق ولم ينطبق ما سبق ⇒ `data` مع `__bold = true`. **استثناء (المرحلة 3):** في تقرير غير شجري فيه صف طابق 3 (مجموع عريض بلا اقتباس)، كل صف عريض آخر مصنّف `data` يصبح `internal_total`، لأنه مجموع فرعي من التقرير (AR `group_by_party`: مجاميع الأطراف). بدون ذلك تتضاعف الإجماليات (ثبت على `acc.dev`: 184 مقابل 92).
8. غير ذلك ⇒ `data`.

**N4 — الشجرة.**
1. **عمود العنوان:** `register.tree.label_key` ← `report_settings.name_field` (يدعمه ERPNext لا frappe، `frontend-query-report.md` §3) ← أول عمود `dimension` غير مخفي.
2. **التفعيل:** وجود المفتاح `indent` في أي صف (`QJ:1080`)، سواء أُعلن `tree: true` أم لا. 4 تقارير شجرية بلا `tree:true` (Sales/Purchase Analytics، Employee Leave Balance، Employee Advance Summary).
3. **الأب:** من مكدّس `indent`، لا من `parent_field`: الأب هو أقرب صف سابق بـ `indent` أصغر. `parent_field` يُستخدم للتحقق فقط (`notice TREE_PARENT_MISMATCH` عند التعارض). السبب: `name_field` و `parent_field` تختلف بين التقارير (Cash Flow `section/parent_section`، Gross Profit `parent/parent_invoice`)، والـ indent موجود دائماً.
4. `__is_leaf = true` إذا كان الصف التالي بـ `indent <=` هذا الصف أو لا يوجد صف تالٍ. الفواصل والمجاميع الداخلية لا تدخل في حساب الأبناء.
5. `initial_depth` من `report_settings.initial_depth` أو `register.tree.initial_depth` أو 2.
6. **الحقائق في التقارير الشجرية = الأوراق فقط** (`docs/brief.md` المصطلحات)، لأن قيم الآباء في Trial Balance مجاميع أبنائها، وجمعها يضاعف الأرقام.
7. **(مُستبدَل بـ N9 في §3.2أ منذ التحول إلى Perspective؛ النص التالي سجل للسبب)** **(المرحلة 3) الإجمالي الكلي في العرض الشجري = مجموع صفوف الجذر (`__parent = null`، `data`)**، لا مجموع الأوراق، ما دام لا فلتر عرض ولا تحديد. هذا ما يفعله Frappe نفسه في الشجرة (`Q:780`) و `calculate_total_row` في Trial Balance. السبب: مع `show_net_values` (افتراضي الواجهة) يصفّي التقرير الافتتاحي والختامي لكل حساب أب على حدة، فالعمودان الختاميان غير تجميعيين: مجموع صافي الأوراق 24,653,599 مقابل `'Total'` = مجموع الجذور 7,553,469 على `acc.dev`. مع فلتر عرض أو تحديد، الإجمالي = مجموع الأوراق المطابقة (قيم الآباء لا تُعاد حسابها). التجميع (`group.by`) يبني المجموعات من الأوراق، فالعمودان الختاميان فيه مجموع أرصدة صافية للأوراق ولا يقابلان صفاً في الأصل.

**قيم N1 المحددة في المرحلة 3** (ليطابق المحوّلان بعضهما):
- `width` عدد صحيح أو `null`؛ `options` الفارغة ⇒ `null`؛ `label` الغائب ⇒ `fieldname`؛ `original` = العمود بعد تحليل N1.1 (قاموس).
- `export_hidden = hidden && report_settings.export_hidden_cols === true` (العمود غير المخفي `false`).
- الأنواع خارج قائمتي `measure` و `dimension` (مثل `Small Text`، `Time`) ⇒ `attribute`. نوع غير معروف يبقى كما هو مع `notice FIELDTYPE_UNKNOWN`.
- `link` يُحسب لكل عمود أياً كان دوره. `Link` خياراته اسم فلتر حالي **أو** بصيغة `snake_case` (`^[a-z_][a-z0-9_]*$`) ⇒ `filter`.
- «أول صف بيانات» في N1.7 وفي القيم القوائمية = أول صف قاموس غير فارغ في الرد.
- N3.6 التلقائي لا يعمل إلا إذا وُجد عمود `measure` واحد على الأقل.
- `tree.initial_depth`: `register.tree.initial_depth` ← `report_settings.initial_depth` ← 2.
- `report_totals.internal` = كل صفوف `internal_total` بالترتيب؛ المرجع في ADR-008 هو **آخرها** (GL «حسب الحساب» فيه مجموع لكل حساب ثم الكلي).
- `message` الفارغ و `report_summary` الفارغ ⇒ `null`.
- `notices`: `FIELDTYPE_CASE` و `FIELDTYPE_UNKNOWN` (`detail` = fieldname)، `SKIP_TOTAL_NON_BOOL` (`detail` = القيمة)، `TREE_PARENT_MISMATCH` (`detail` = `__rid`؛ يُفحص فقط إن وُجد `name_field` و `parent_field` في `report_settings`).
- خارج الشجرة: `__indent = null`، `__parent = null`، `__is_leaf = true`. في الشجرة: الفواصل والمجاميع الداخلية `__parent = null` و `__is_leaf = true`، و `__indent` قيمة `indent` كما هي أو `null`.

**N5 — الرسائل والرسم والملخص.**
- `chart`: `{}` أو `[]` أو `null` ⇒ `null`؛ وإلا يُحفظ كما هو ويُحوَّل لـ ECharts في `views/charts_view.js` (أنواع percentage/donut/line/bar والمفاتيح الإضافية `fieldtype`، `options`، `currency`).
- `report_summary`: قائمة بطاقات `{value, label, datatype, currency, indicator}` تُعرض في بطاقات الملخص.
- `message`: نص أو HTML يُعرض فوق الجدول كما في الأصل، الذي يعامله كـ HTML موثوق لأنه من كود التقرير (Monthly Attendance Sheet يعيد مفتاح ألوان HTML).
- `_server_messages` (مثل `msgprint("No record found")`) ⇒ `notices` وتظهر في حالة «لا نتائج».
- رد فارغ (`[], []`، `[], [], None, []`، `columns, []`) ⇒ `rows = []` وحالة «لا نتائج» بالرسائل المرافقة.

**N6 — الإثراء.** بعد N1-N5: لكل قاعدة إثراء على عمود `link.static`، تُجمع القيم الفريدة من الحقائق، وتُطلب من `api.enrich` على دفعات 5,000، وتُضاف أعمدة جديدة `key = <source>__<field>` بدور `dimension` (أو حسب القاعدة). الإثراء لا يغيّر أي قيمة أصلية.

**N7 — الـ formatter الأصلي.** لا يدخل في التطبيع إطلاقاً. يُستدعى في طبقة العرض فقط (§9.3).

### 3.2أ تحميل Perspective (N8، بعد N1-N6)

**المخطط (schema) صريح دائماً** (`engine/schema.js`)؛ لا يُترك Perspective يخمّن:

| `fieldtype` في Frappe | نوع Perspective | تحويل القيمة قبل التحميل |
|---|---|---|
| `Currency`، `Float`، `Percent`، `Duration` | `float` | رقم منتهٍ، وإلا `null` |
| `Int` | `float` | كذلك. لا `integer`: هو int32 في Perspective ويلتف بصمت (`perspective-experiments.md` §7.12) |
| `Date` | `date` | نص `YYYY-MM-DD` صالح، وإلا `null`. قيمة تاريخ واحدة غير صالحة تُسقط الدفعة كلها، و `"05-01-2026"` يُقرأ بترتيب خاطئ |
| `Datetime` | `datetime` | ISO صالح، وإلا `null` |
| `Check` | `boolean` | |
| كل ما عداها (`Link`، `Data`، `Select`، …) | `string` | `null` للفارغ؛ القوائم تُضم بفاصلة |

- المحوّل يحوّل **كل** قيمة إلى نوعها أو `null` قبل التحميل، لأن Perspective يحوّل `""` و `"abc"` إلى 0 في `float` بصمت.
- أسماء الأعمدة في الجدول = `Column.key`. الأسماء غير ASCII تعمل كأعمدة وفي `filter` و `sort` و `group_by` و `split_by` وكمراجع في التعابير؛ لكن أي **نص حرفي** غير ASCII داخل تعبير يفشل، فلا تُكتب قيم عربية داخل `expressions` (تُمرَّر عبر أعمدة مساعدة).
- لكل عمود `string` يدخل في فرز أو تجميع يولّد المحوّل عمود مفتاح `__sort__<key>` (`float`) بترتيب `Intl.Collator(lang)`، لأن ترتيب Perspective بوحدات الترميز لا بقواعد اللغة.
- أعمدة تقنية يضيفها المحوّل: `__rid` (`float`)، `__kind` (`string`)، وللشجرة ما في N9.
- التحميل بصيغة أعمدة وعلى دفعات لا تزيد عن 50,000 صف (`table.update`).

**N9 — الشجرة: جدولان.**
1. **جدول العقد (`nodes`)**: كل صفوف التقرير من نوع `data` كما أعادها التقرير، آباءً وأوراقاً، بترتيبها، مع أعمدة: `__depth`، و `__anc_1 … __anc_n` (معرّف كل سلف)، و `__has_children`. يُستخدم في **العرض الشجري «كما هو»** بلا `group_by`: القيم هي قيم التقرير نفسها، فتطابق الأصل 100% للآباء وللإجمالي (`perspective-experiments.md` §6: 31 من 31). الطي والفتح بفلتر `not in` على أعمدة الأسلاف، والفرز داخل الإخوة بمفتاح مسار. الإجمالي = صف `internal_total` المرجعي من التقرير (ADR-008).
2. **جدول الحقائق (`facts`)**: الأوراق فقط مع أعمدة المستويات `level_1 … level_n` من سلسلة الأب (والعقد الوسيطة الناقصة في شجرة غير منتظمة العمق تُملأ بقيمة الورقة نفسها حتى لا تظهر عقد `null`). يُستخدم في كل ما عدا ذلك: تجميع المستخدم، والتحليل، والفلترة، والرسوم. هنا يحسب Perspective المجاميع بنفسه.

**لماذا جدولان:** ميزان المراجعة مع `show_net_values` يصفّي رصيد كل حساب أب على حدة، فالعمودان الختاميان غير جمعيين: مجموع الأوراق 24,653,599 والأصل 7,553,469. والتعابير في Perspective تُحسب قبل التجميع دائماً، فلا تعبير يصفّي بعد الجمع (`perspective-experiments.md` §6.3). الجدولان يطابقان الأصل في العرض الشجري دون أي حساب خارج المحرك. وفي العروض المجمَّعة مجموع الأوراق هو نفسه ما يعطيه التقرير الأصلي مع `show_group_accounts=0` (24,653,599)، فهو مرجع صحيح أيضاً. N4.7 يُستبدل بهذه القاعدة.

**N9أ — التقارير المسطحة ذات الصفوف البينية: جدول «الصفوف كما هي» (`rows`).**
تقرير غير شجري يعيد صفوفاً ملخِّصة لمجموعاته بين الحقائق (General Ledger «حسب الحساب»: `opening` و `internal_total` و `closing` لكل حساب؛ Accounts Receivable مع `group_by_party`: مجموع كل طرف؛ رؤوس مجموعات بلا `indent`) يُحمَّل في جدولين:
1. **جدول الصفوف (`rows`)**: كل صفوف التقرير (`data`، `opening`، `closing`، `internal_total`، `group_header`) بترتيبها وأنواعها، عدا الفواصل، بالمخطط الصريح نفسه لجدول الحقائق. يُستخدم في **العرض الافتراضي «كما هو»**: بلا `group_by` ولا `sort` ولا `aggregates`، فالقيم هي قيم التقرير نفسها. يُنشأ فقط إذا وُجد صف ملخِّص واحد على الأقل بين الحقائق؛ غير ذلك يكفي جدول الحقائق.
2. **جدول الحقائق (`facts`)**: صفوف `data` فقط، لكل ما يحسبه Perspective.

**صفوف التقرير كله** (`engine/report_rows.js: edge_rows`، وتوأمها في `core/engine.py`) تُحدَّد من ترتيب الأنواع وحده بعد حذف الفواصل: الافتتاحي = أول `opening` قبل أول حقيقة (وإذا كانت مجموعات التقرير تحمل افتتاحياً خاصاً، فلا افتتاحي للتقرير إلا بوجود صفّي `opening` على الأقل قبل أول حقيقة)؛ الختامي والمرجعي = صفوف `closing` و `internal_total` بعد آخر حقيقة ناقص ما يُغلق المجموعة الأخيرة (بعدد وأنواع ما يُغلق المجموعة التي قبلها)؛ المرجعي = آخر `internal_total` (ADR-008) إن كان منها. هذه الصفوف تُعرض مثبّتة خارج الجسم (الافتتاحي تحت الرؤوس، الختامي فوق الإجمالي العام، والمرجعي هو الإجمالي العام)، و `view` جدول الصفوف يستثنيها بفلتر `__rid not in`.

**متى يُترك «كما هو»:**

| حالة العرض | الجدول | الصفوف البينية | صفوف التقرير كله | الإجمالي العام |
|---|---|---|---|---|
| لا فلتر عرض، لا تجميع، لا فرز | `rows` | في أماكنها | مثبّتة | الصف المرجعي |
| فرز فقط | `facts` | مخفية | مثبّتة | الصف المرجعي |
| فلتر عرض | `facts` | مخفية | مخفية | مجموع المحرك للحقائق المطابِقة |
| تجميع المستخدم | `facts` | مخفية | مخفية | صف الإجمالي في `view` |

السبب: المجاميع البينية تصف مجموعات التقرير بترتيبه؛ الفرز يكسر تلك المجموعات، والفلتر والتجميع يغيّران ما تمثله الأرقام. عند الانتقال يظهر تنبيه `REPORT_ROWS_HIDDEN` بعدد الصفوف المخفية. التصدير يطبّق القاعدة نفسها (§4.3).

**العدّ والتصدير:** عدد الصفوف في شريط الحالة وشارة الإجمالي و `expected.row_count` = الحقائق التي تمر من الفلاتر دائماً (الصفوف الملخِّصة لا تُعدّ). `expected.totals` = الإجمالي المعروض: الصف المرجعي حين يُعرض هو، ومجموع المحرك غير ذلك (§8أ.6).

**الكلفة:** هذه التقارير تُحمَّل مرتين في المحرك، كالتقارير الشجرية.

### 3.3 استنتاج الأبعاد والمقاييس

- الأبعاد: أعمدة `role = dimension` + أبعاد مشتقة لكل عمود `date`: `<key>__year`, `<key>__quarter`, `<key>__month`.
- المقاييس: أعمدة `role = measure`. التجميع الافتراضي `agg`. عمود `Currency` بعملة `row` لا يُجمَّع عبر عملات مختلفة (ADR-008): يُحسب لكل مجموعة، وإذا وُجدت عملتان فأكثر تكون النتيجة `{mixed: true}`.
- قيم `Float` تمثل نقوداً (Sales/Purchase Analytics، Budget Variance) تبقى `Float`؛ `register.columns` يمكنه ضبط `display_as: "Currency"` للعرض فقط.

### 3.4 الحالات المشتركة للاختبار

`report_view/tests/fixtures/normalize/<case>.json`: `{"input": {raw, filters, report_settings, register}, "expected": NormalizedReport}`. كل نمط في §3.5 له حالة واحدة على الأقل، تُولَّد من تشغيل حقيقي في المرحلة 3-4 ثم تُراجع يدوياً. `tests/js/normalize.test.js` و `report_view/tests/test_normalize.py` يقرآن الملفات نفسها ويجب أن يعطيا المخرج نفسه.

### 3.5 معالجة كل حالة في الكتالوج

**أ. الأنماط العشرون** (`docs/research/report-catalog.md` §5):

| # | النمط | المعالجة |
|---|---|---|
| 1 | صف مجموع Frappe قائمة داخل قواميس | N2.1 |
| 2 | مجاميع داخلية بعناوين مقتبسة، وبلا اقتباس | N3.2، N3.3؛ مرجع الإجماليات ADR-008 |
| 3 | صفوف فارغة وشبه فارغة | N3.1 (العملة `attribute` فلا تُحتسب قيمة) |
| 4 | رؤوس مجموعات بلا indent يليها indent=1 | N3.5 |
| 5 | الشجرة بـ indent وحده، ومشروطة بفلتر | N4.2 (يُعاد الفحص لكل رد) |
| 6 | خلط قوائم وقواميس بحسب الفلتر | N2.2 |
| 7 | أعمدة بلا fieldname وأعمدة نصية | N1.1، N1.4؛ لا نستخدم `prepare_field_from_column` في الواجهة (`report_utils.js:93-119`) |
| 8 | fieldname مشتق من تسمية مترجمة أو بيانات، غير ASCII | `key` نص حر؛ العروض المحفوظة تخزّن `columns_ref` لكل مفتاح (§7.3) وتُصلح المرجع بالموضع والنوع عند تغيّر اللغة |
| 9 | ثلاث صيغ للعملة وعملة مختلفة لكل صف | N1.7؛ مجموع مختلط ⇒ `mixed` (ADR-008) |
| 10 | Link بخيارات متغيرة (Dynamic، فلتر، لكل صف) | N1.8 |
| 11 | أعمدة مخفية و `export_hidden_cols` | N1.5؛ التصدير يحترم `export_hidden` |
| 12 | Float نقدي وقيم قوائم في الخلية | §3.3؛ القوائم `attribute` وتُعرض مفصولة بفاصلة |
| 13 | `fieldtype` بحروف صغيرة | N1.3 |
| 14 | تسرّب رقم إلى `skip_total_row` | N2.3 |
| 15 | أشكال الحالة الفارغة ورسائل msgprint | N5 |
| 16 | فلاتر شرطية وتُحقن لاحقاً وتعتمد `frappe.query_report` | الفلاتر تُبنى بعناصر Frappe من `script.filters` (§5.1، `filters/report_filters.js`)؛ `mandatory_depends_on` و `depends_on` يُقيَّمان كما في `frappe.ui.FieldGroup`؛ `onload` و `on_change` يعملان بفضل كائن الواجهة (ADR-006)؛ `add_dimensions` غير المتزامن يُنتظر قبل أول تشغيل |
| 17 | `cash_flow.js` يعدّل الكائن المشترك | نحمّل السكربت بنفس ترتيب الأصل ولا ننسخ `erpnext.financial_statements`؛ `name_field` يُقرأ من كائن التقرير لحظة التطبيع |
| 18 | أشكال `chart` و `report_summary` | N5 |
| 19 | `get_datatable_options` | غير مدعوم (خاص بـ frappe DataTable). يُتجاهل مع `notice DATATABLE_OPTIONS_IGNORED`. Sales/Purchase Analytics يفقدان صناديق اختيار الرسم؛ البديل: رسم من النطاق المحدد (المرحلة 5د) |
| 20 | ملاحة داخل formatter و onload | الـ formatter الأصلي يُستدعى كما هو (§9.3)؛ `frappe.set_route` و `route_options` تعمل؛ `add_inner_button` يعمل على `page` صفحتنا عبر الواجهة (ADR-006) |

**ب. التقارير الـ 31:**

| التقرير | الأنماط | معالجة خاصة أو إعداد |
|---|---|---|
| Trial Balance | 2، 5، 11، 16 | إعداد مشحون: شجرة `account`، إثراء `root_type`/`account_type`، أزواج توازن (افتتاحي/حركة/ختامي)، تفصيل إلى General Ledger، مجموع مرجعي = صف `'Total'` الداخلي |
| General Ledger | 2، 3، N1.2 | `opening`/`closing`/`internal_total` لا تدخل الحقائق؛ الفواصل شبه الفارغة ⇒ `separator` |
| Accounts Receivable / Payable | 1، 2، 3، 9، 20 | `frappe_total` في الوضع العادي؛ في `group_by_party` مجاميع `bold` + فواصل؛ عملة الطرف ⇒ مجموع مختلط |
| Balance Sheet / P&L | 2، 3، 5، 11، 14، 18 | شجرة؛ `report_summary` بطاقات؛ أعمدة الفترات ديناميكية |
| Cash Flow | 2، 3، 5، 17 | `label_key = section` من كائن التقرير لحظة التحميل |
| Accounts Receivable Summary | 1، 12 | `sales_person` قائمة ⇒ `attribute` |
| Gross Profit | 2، 5، 6، 7، 10 | الشجرة مشروطة بـ `group_by=Invoice`؛ خلط أشكال؛ عمود بلا fieldname |
| Sales / Purchase Register | 1، 8 | أعمدة الحسابات الديناميكية بأسماء غير ASCII؛ `include_payments` ⇒ `skip_total_row` |
| Trial Balance for Party | 2، 10 | `party` خياراته من فلتر `party_type` |
| Budget Variance Report | 8، 10، 12 | fieldname من تسمية مترجمة؛ الـ formatter الأصلي يقارن `__("variance")` فيبقى صحيحاً لأنه يعمل بلغة الجلسة نفسها |
| Stock Ledger | N1.2، 9، 11 | عملة `Company:company:default_currency`؛ إخفاء شرطي |
| Stock Balance | 1، 9 | Prepared Report (ADR-009): حالات `prepared_pending/missing` وزر التوليد |
| Stock Projected Qty | 1، 6، N1.2 | صفوف قوائم |
| Stock Ageing | 6، 18 | `chart` قد يكون `{}` أو `[]` |
| Warehouse wise Item Balance Age and Value | 1، 6، 7، 8، 9 | أعمدة نصية، أسماء مستودعات عربية كـ fieldname، Currency بلا options ⇒ عملة النظام |
| Item Price Stock | 9 | عملة النظام |
| Sales Analytics / Purchase Analytics | 1، 3، 4، 5، 12، 19 | شجرة بلا `tree:true`؛ `get_datatable_options` يُتجاهل |
| Sales Order Analysis / Purchase Order Analysis | 1، 9، 15، 18 | حالة فارغة `[], [], None, []` |
| Customer / Supplier Ledger Summary | 1، 10، 15 | أعمدة `adj_<account>` ديناميكية |
| Sales Partner Transaction Summary | 1، 10 | خيارات Link من فلتر `doctype` |
| Monthly Attendance Sheet | 4 (N3.6)، 8، 15، 16، 18 | رؤوس مجموعات بلا indent؛ `message` HTML؛ `reqd` متبدّل برمجياً عبر `set_reqd_filter` في الواجهة |
| Salary Register | 1، 8 | أعمدة مكوّنات الراتب ديناميكية |
| Employee Leave Balance | 4، 5، 13 | `"float"` ⇒ `"Float"`؛ رؤوس مجموعات |
| Employee Advance Summary | 2، 5 | مجموع `title=_("Total")` بلا اقتباس (N3.3) |
| Employee Birthday | 6، 7 | أعمدة نصية وصفوف tuples |

---

## 4. عقد نموذج التصدير

### 4.1 ما ترسله الواجهة

```json
{
  "version": 1,
  "format": "xlsx" | "pdf",
  "filters": { "...": "فلاتر التقرير كما في آخر تشغيل" },
  "js_filters": [ {"fieldname", "fieldtype", "options"} ],
  "prepared_report_name": null,
  "view_state": { "...": "حالة العرض كاملة (§7)" },
  "quick_filters": [ {"id": "debit_closing", "expression": "abs(\"closing_debit\") > 0.005"} ],
  "scope": "all" | "selection",
  "selection": { "row_rids": [..], "column_keys": [..] } | null,
  "expected": { "row_count": 1234, "totals": { "<column_key>": 1234.5 } },
  "layout": {
    "title": "…", "orientation": "portrait" | "landscape", "page_size": "A4",
    "include_filters": true, "include_subtotals": true, "include_signatures": false,
    "columns": [ {"key", "width"} ]
  },
  "locale": { "lang": "ar", "rtl": true }
}
```

### 4.2 تحقق الخادم (`core/export/model.py`)

1. حجم النموذج ≤ 256 KB؛ `version == 1` (غير ذلك `RVInvalidInput`).
2. `format` يطابق الدالة المستدعاة.
3. `view_state` يمر بـ `view_state.validate` و `migrate` (§7)، ثم يُطابَق مع أعمدة `NormalizedReport` الذي بناه الخادم: كل مفتاح في `columns`، `sort`، `filters`، `group.by`، `pivot`، `values`، `layout.columns` موجود، وإلا `RVInvalidViewState`.
4. عمليات الفلترة من القائمة المغلقة (§7.1)، والقيم بأنواع صحيحة، والأرقام منتهية (`math.isfinite`)؛ حد 200 فلتر و 5,000 قيمة لكل فلتر مجموعة. ثم `view_state.check_exportable` (للتصدير فقط؛ الحالة نفسها تبقى صالحة كعرض محفوظ): **ما لا يطبّقه المتصفح يُرفض بـ `RVInvalidViewState` برسالة تسمّي الفلتر**، ولا يُطبَّق في الخادم، حتى لا يختلف الملف عن الشاشة، إلى أن يُدعم في الطرفين:
   - البحث الحر (`key: "*"`) والعملية `not_contains`؛
   - فلتر لا يناسب نوع العمود في Perspective (§3.2أ N8): `text` و `set` لأعمدة `string` فقط، `range` لأعمدة `float` فقط، `date` لأعمدة `date` و `datetime` فقط؛
   - فلتر `set` بلا `exclude` يجمع «فارغ» مع قيم أخرى («فارغ» وحده، أو مع `exclude`، مقبول)؛
   - المفاتيح المشتقة من التاريخ (`<k>__year`، `__quarter`، `__month`) في `sort` أو `filters` أو `group.by`.
4أ. `quick_filters` (ADR-013): قائمة ≤ 50 تعريفاً `{id, expression}` بلا مفاتيح أخرى ولا تكرار (غير ذلك `RVInvalidInput`). كل تعبير يمر بقواعد `core/expressions.py` المغلقة (مقارنة `"عمود"` أو `abs("عمود")` برقم، `and`/`or`، أقواس؛ ≤ 500 حرف) وإلا `RVInvalidViewState` برسالة تسمّي الفلتر. كل معرّف في `view_state.quick_filters` له تعريف، وإلا `RVInvalidViewState`. بعد التطبيع: أعمدة التعابير **النشطة** موجودة ونوعها رقمي (`value_type == "float"`)، وإلا `RVInvalidViewState`؛ التعريفات غير النشطة لا تُفحص (المتصفح لا يطبّقها أيضاً).
5. `scope = selection`: `row_rids` ≤ عدد الصفوف و `column_keys` موجودة. التحديد يُطبَّق **بعد** إعادة التشغيل على الحقائق التي بناها الخادم؛ `__rid` حتمي (ترتيب صفوف الرد) فيطابق ما رآه المستخدم لنفس الفلاتر.
6. `layout.title` نص ≤ 140 حرفاً يُهرَّب في القالب؛ لا HTML من المتصفح يدخل القالب إطلاقاً.
7. بعد الحساب: `expected` يُقارن بما حسبه الخادم؛ الاختلاف ⇒ `RVExportMismatch` مع قائمة الأعمدة المختلفة، وتسجيل Error Log. العقد (يطابقه المتصفح في §8أ.6):
   - `expected.row_count` = عدد **الحقائق** (أوراق الشجرة) التي تمر من فلاتر المتصفح الفعّالة ومن التحديد. الطي والتجميع والفرز لا تغيّره، وصفوف المجموعات والمجاميع وصفوف التقرير الملخِّصة لا تُعدّ.
   - `expected.totals` = **الإجمالي العام كما يُعرض**: `{key: number}` لكل عمود له إجمالي رقمي منتهٍ. عمود بلا تجميع، أو `disable_total`، أو بعملات مختلطة، أو قيمته في الصف المرجعي ليست رقماً ⇒ لا يُرسل ولا يُقارن. مصدره هو مصدر الخادم نفسه (`total_source` في §4.3): الصف المرجعي حين يكون هو المعروض، ومجموع المحرك غير ذلك.
   - المقارنة لكل مفتاح مُرسل فقط، بتسامح نصف أصغر وحدة في دقة العمود؛ `null` يساوي 0.
8. `js_filters` تُعامل كما في §2.1 (3). غيابها لا يمنح المستخدم أكثر مما يعطيه استدعاء `frappe.desk.query_report.run` مباشرة.

### 4.3 ما ينفّذه الخادم

`runner.run` ← `normalize` ← `engine.apply(view_state)` ← `xlsx.build` أو `pdf.render`. المبدأ: **ما على الشاشة = ما في الملف**. محرك بايثون (`core/engine.py`) توأم لوحدات المتصفح `view_config.js` (الأشكال، الفلاتر، الفرز، ترتيب الأعمدة، مصدر الإجمالي) و `report_rows.js` (`edge_rows`) و `tree_nodes.js` (`tree_index`) و `row_layout.js` (صفوف المجموع الفرعي)، بدلالات Perspective نفسها. التنسيق بـ `frappe.format_value` وإعدادات النظام، والعناوين بـ `_()`.

**الأشكال** (`layout_mode` في ناتج `apply`)، وضع `grid` فقط (غيره ⇒ `RVInvalidViewState`):

| الشكل | متى | الصفوف | الإجمالي العام (`total_source`) |
|---|---|---|---|
| `tree` | تقرير شجري بلا `group.by` ولا فلتر فعّال ولا تحديد | صفوف التقرير نفسها (`data` و `group_header`) آباءً وأوراقاً بقيمها من التقرير وبترتيبه (N9). الفرز بلا أثر. صفوف التقرير الملخِّصة الأخرى لا تُكتب (ليست في جدول العقد) | `reference`: آخر `internal_total` كما أعاده التقرير. وإلا `frappe_total`. وإلا `engine`: مجموع أعلى صفوف `data` |
| `levels` | تقرير شجري مع فلتر فعّال أو تحديد | الأوراق المطابقة وأسلافها بترتيب التقرير؛ قيم كل أب تُجمَّع من أوراقه المطابقة | `engine`: من الأوراق المطابقة |
| `group` | `group.by` (أعمدة موجودة) | مجموعات من الحقائق المطابقة، مرتّبة بمفتاحها (تصاعدياً، أو حسب `sort` إن ذُكر المفتاح فيه)، وتحتها الحقائق بفرز المستخدم ثم ترتيب التقرير. خلايا صف المجموعة: التجميع للأعمدة ذات الإجمالي فقط، والباقي فارغ | `engine` |
| `flat` | غير ذلك | بلا فلتر ولا تحديد: افتتاحي التقرير أولاً (`edge_rows.top`)، ثم الجسم، ثم ختامي التقرير (`edge_rows.bottom`). الجسم = الحقائق مفروزة إن وُجد فرز أو لم يكن للتقرير صفوف ملخِّصة داخلية؛ وإلا كل صفوف التقرير في أماكنها (عدا الفواصل والصفوف المثبّتة). مع فلتر أو تحديد: الحقائق المطابقة فقط | `reference` حين يكون الصف المرجعي ضمن ما يختم التقرير (`edge_rows.reference`) ولا فلتر ولا تحديد؛ وإلا `engine` |

- **الفلتر الفعّال:** فلتر نص بقيمة فارغة، أو نطاق أو تاريخ بلا حدّين، أو `exclude` بلا قيم، ليس فلتراً: الشكل يبقى كما هو بدونه (كما في `to_filter`).
- **الفلتر السريع** (`view_state.quick_filters` + تعريفاته في النموذج، ADR-013): فلتر متصفح فعّال دائماً ما دام معرّفه نشطاً (كما في `to_view_config`: `browser_filter = [...column_filter, ...quick.filter]`). يُقيَّم بعد فلاتر الأعمدة على الحقائق بقيمها الرقمية (`float` أو `null`) بدلالات Perspective المقيسة: العمود المجرّد وقيمته `null` يُقارن كأكبر قيمة، و `abs(null)` كأصغر قيمة. أكثر من فلتر سريع نشط = `and`.
- **الصف المرجعي** يُكتب صفَّ الإجمالي العام كما أعاده التقرير، للأعمدة التي لها إجمالي (`aggregate_of`)، ولا يُكرَّر في الجسم. في GL: `balance` في الإجمالي = قيمة الصف المرجعي لا مجموع الأرصدة المتراكمة.
- **المجاميع الفرعية** (`group.subtotals`، الافتراضي `true`)، في `tree` و `levels` و `group`: `true` ⇒ صف المجموعة (أو الأب) المفتوحة يحمل عنوانه بلا أرقام، وصف `foot` بعنوان «إجمالي <المجموعة>» بعد كل صفوفها يحمل الأرقام. `false` ⇒ لا صف مجموع، وكل صف مجموعة يحمل أرقامه. **المطوية تحمل أرقامها دائماً.** في `tree` أرقام الصفّين هي قيم صف الأب في التقرير.
- **الطي:** كل الصفوف تُكتب بمستوى outline يساوي عمقها (حتى 7). الصف تحت مجموعة أو أب مطوي ⇒ `hidden`، والصف المطوي نفسه ⇒ `collapsed`؛ لا يُحذف شيء. `group.expanded`: `"all"` / `"none"` / قائمة مسارات (المجموعة مفتوحة إن كان مسارها في القائمة؛ عنصر المسار نص أو رقم أو منطقي أو `null`، وللتاريخ ميلي ثانية منذ epoch بتوقيت UTC كما في `__ROW_PATH__`). الشجرة في الشكلين: `tree.expanded` قائمة `__rid` الآباء المفتوحين، وإن كانت `null` فالأب مفتوح إن كان عمقه أقل من `tree.depth ?? initial_depth ?? 2`.
- **ترتيب الأعمدة:** `layout.columns` إن أُرسلت (الأعمدة الظاهرة بترتيبها)، وإلا كل الأعمدة غير المخفية مرتبة بـ `columns.order` (غير المذكور آخراً) مع الأعمدة المخفية التي يصدّرها التقرير (`export_hidden`). ثم تُنقل أعمدة `columns.pinned.start` (الأبعاد والخصائص الظاهرة فقط، بترتيب القائمة) إلى ما بعد عمود العنوان مباشرة. عمود العنوان = أول عمود ظاهر على الشاشة؛ فيه تُكتب عناوين المجموعات (`<القيمة> (العدد)`، والفارغة «غير محدد») وعناوين صفوف المجموع والإزاحة.
- **التجميع:** `values[].agg` يغلب `Column.agg`. دلالات Perspective: `sum` و `avg` تتجاهلان `null` (مجموع الكل `null` = 0، ومتوسطه `null`)؛ `min` و `max` تتجاهلان `null`؛ `count` يعدّ الصفوف؛ `count_distinct` يعدّ `null` قيمة. العملات المختلطة: أكثر من قيمة في عمود عملة الصف بين صفوف المجموعة (والفارغة تُعدّ قيمة) ⇒ `{mixed: true}`.
- **الفلاتر:** القيم تُحوَّل إلى نوع العمود كما في N8 قبل المقارنة. `equals` مطابقة تامة؛ `contains` و `starts_with` تتجاهلان حالة الأحرف اللاتينية (ASCII) فقط؛ `set` مطابقة نصية تامة، و «فارغ» = `null`؛ `range` و `date` لا يمرّ منهما `null`.
- **الفرز:** `null` أكبر قيمة (آخراً تصاعدياً، أولاً تنازلياً)، وترتيب التقرير يحسم التساوي. النصوص بمفتاح `engine.collation_key`، وهو **تقريب** لـ `Intl.Collator(lang, {numeric, sensitivity: "base"})` (بلا ICU في الخادم): يتجاهل الحالة والتشكيل وأشكال الهمزة والتطويل، ويقارن الأرقام عددياً، والعربية قبل اللاتينية في `ar`. قد يختلف ترتيب الصفوف عن الشاشة في أحرف غير معتادة؛ الأرقام لا تتأثر.
- `layout.include_subtotals = false` (خيار الطباعة): لا صفوف مجموع، وصفوف المجموعات بلا أرقام.
- **الاختبار المشترك:** `report_view/tests/fixtures/screen/cases.json` يولّده `generate.mjs` من محرك المتصفح نفسه (Perspective في node عبر وحدات الصفحة): صفوف الشاشة بترتيبها ومجاميعها و `expected` لكل (حالة مشتركة، حالة عرض). `test_engine.py` يطابق محرك بايثون معه صفاً بصف. يُعاد توليده عند أي تغيير في محرك المتصفح.
- `export_background_threshold` (المرحلة 6) غير مطبّق.

---

## 5. الإعدادات

### 5.1 `report_view.register(report_name, config)`

يُستدعى من bundle أي تطبيق مدرج في `report_view_include_js` أو من `configs/` في تطبيقنا. التسجيل المتكرر لنفس التقرير يدمج (الأحدث يغلب) مع تحذير في وضع التطوير.

| الخيار | النوع | الافتراضي | المعنى |
|---|---|---|---|
| `title` | `string` | `__(report_name)` | عنوان الصفحة |
| `default_mode` | `"grid" \| "pivot" \| "charts"` | `"grid"` | العرض عند الفتح |
| `tree` | `{label_key?, initial_depth?, enabled?}` | من الرد (N4) | تجاوز كشف الشجرة |
| `columns` | `{[fieldname]: {role?, agg?, label?, pin?: "start"\|"end", width?, display_as?, hidden?}}` | `{}` | تجاوز استنتاج N1 |
| `classify_row` | `(row, ctx) => kind \| undefined` | — | N3.4 |
| `group_header_key` | `string` | — | N3.6 |
| `derived_columns` | `[{key, label, fieldtype, role, compute: (row) => value}]` | `[]` | أعمدة محسوبة في المتصفح فقط؛ لا تُصدَّر ما لم يعرّفها `defaults/<report>.json` بتعبير من القائمة المغلقة (`sum`, `diff`, `abs`, `sign`) لأن الخادم لا ينفّذ كود JS |
| `summary` | `{kind: "balance_pairs", pairs: [{label, debit, credit}]}` \| `{kind: "report_summary"}` | `report_summary` إن وُجد | بطاقات الملخص |
| `ready_views` | `[{id, title, description, state}]` | `[]` | عروض جاهزة غير قابلة للحذف (قائمة المفضلة) |
| `quick_filters` | `[{id, label, expression, exclusive?}]` | `[]` | الفلاتر السريعة (نمط `PRESETS` في التصميم): `expression` تعبير Perspective منطقي، وللتصدير يجب أن يكون من القواعد المغلقة في ADR-013 |
| `period` | `{from_key, to_key, fiscal_year_key?, company_key?}` | يُكتشف تلقائياً من أسماء الفلاتر `from_date/to_date/fiscal_year/company` | ربط مكوّن الفترة |
| `row_actions` | `[{label, icon, action: (row, ctx) => void, visible?: (row) => bool}]` | `[]` | قائمة إجراءات الصف |
| `enrich` | `[{source, doctype, fields}]` | `[]` | **اقتراح فقط** (ADR-003): لا يُفعَّل إلا بقاعدة خادمية |
| `drilldown` | `[{source, target_report, filters: (row, current_filters) => filters, open_as: "drawer" \| "page"}]` | `[]` | **اقتراح فقط**؛ الهدف يمر بـ `api.run` وصلاحياته |

### 5.2 DocTypes الإعدادات

**`Report View Global Settings` (Single)** — كتابة: System Manager، Report View Manager؛ قراءة: الدور `Desk User`.

> بُني في 2026-10-12 (ADR-015) بالحقول `max_rows` (الافتراضي في الكود والـ DocType **50,000**، `core/settings.DEFAULT_MAX_ROWS`؛ تحقق 2026-10-22) و `print_max_pages` وقسم «إعدادات الطباعة القياسية»، ثم `custom_print_open_in` (ADR-019)؛ بقية الحقول أدناه «لم يُبنَ». اختيار 50,000 أو 100,000 قرار صاحب المشروع (C21). `Report View Settings` كله «لم يُبنَ»: الإعدادات لكل تقرير تأتي من `defaults/*.json`.

| الحقل | النوع | الافتراضي |
|---|---|---|
| `enabled_for` | Select: `All Reports` / `Enabled Reports Only` | `All Reports` |
| `entry_button_scope` | Select: `All Reports` / `Enabled Reports Only` / `None` | `Enabled Reports Only` |
| `max_rows` | Int | 50,000 في الكود (الخطة كانت 100,000؛ يُقيَّد بـ `System Settings.max_report_rows` وبالسقف 200,000) |
| `hard_max_rows` | Int، للقراءة فقط | 200,000 (السقف الصلب لـ `max_rows`) |
| `export_background_threshold` | Int | 20,000 |
| `default_pdf_generator` | Select: `wkhtmltopdf` / `chrome` | `wkhtmltopdf` — «لم يُبنَ» (ADR-016: محرك Chromium خاص دائماً) |

**`Report View Settings`** (اسم السجل = اسم التقرير) — نفس الصلاحيات (قراءة `Desk User`، كتابة System Manager و Report View Manager).

| الحقل | النوع | ملاحظة |
|---|---|---|
| `report` | Link Report، إلزامي، فريد | |
| `enabled` | Check | 1 |
| `show_entry_button` | Select: `Default` / `Show` / `Hide` | |
| `default_mode` | Select: `grid` / `pivot` / `charts` | |
| `default_saved_view` | Data (اسم عرض) | الافتراضي العام الوحيد. ليس Link عن قصد: حذف العرض لا يفشل بـ `LinkExistsError` (`delete_doc.py:170-172`). `validate`: العرض موجود، لنفس التقرير، و `visibility != Private`. قيمة تشير لعرض محذوف أو خاص تُتجاهل عند القراءة. يُعدَّل بصلاحيات هذا النوع ولا يتطلب ملكية العرض |
| `drilldown_target` | Select: `query-report` / `report-view` | افتراضي `query-report` حتى لا نغيّر روابط ERPNext ضمنياً |
| `pdf_generator` | Select: `Default` / `wkhtmltopdf` / `chrome` | |
| `default_orientation` | Select: `portrait` / `landscape` | |
| `column_rules` | Table `Report View Column Rule`: `fieldname`, `label`, `role` (Auto/Dimension/Measure/Attribute), `aggregation` (Auto/Sum/Avg/Count/Min/Max/None), `pin` (None/Start/End), `width`, `hidden` | |
| `enrich_rules` | Table `Report View Enrich Rule`: `source_column`, `link_doctype`, `fields` (Small Text، سطر لكل حقل) | قائمة السماح (ADR-011) |
| `drilldowns` | Table `Report View Drilldown`: `source_column`, `target_report` (Link Report), `filter_map` (JSON: `{"target_filter": "row:<key>" \| "filter:<name>" \| "const:<value>"}`), `open_as` | |
| `balance_pairs` | Table `Report View Balance Pair`: `label`, `debit_column`, `credit_column` | معادلة التوازن (المرحلة 6) |
| `signatures` | Table `Report View Signature`: `label`, `idx` | خانات التوقيع في PDF |
| `filter_defs` | Table `Report View Filter Def`: `fieldname`, `fieldtype` (Link فقط، لأن `validate_filters_permissions` لا يفحص غيره، `Q:1149`)، `options` | تعريفات فلاتر خادمية تُدمج في `js_filters` (§2.1) ولا يستطيع المتصفح إسقاطها |

### 5.3 ترتيب الأولوية

من الأضعف للأقوى، مفتاحاً بمفتاح (ADR-003):

1. الاستنتاج من الرد (§3).
2. `defaults/<report>.json` المشحون (يُحمَّل عند التثبيت كسجل `Report View Settings` إن لم يوجد، فيصبح قابلاً للتعديل).
3. `report_view.register`.
4. `Report View Settings`.

قواعد خاصة:
- `enrich_rules` و `drilldowns` و `pdf_generator` و `filter_defs` و `default_saved_view`: **الخادم فقط** (2 و 4).
- (المرحلة 3) `defaults/<report>.json` يحمل أيضاً `report_settings` (نسخة خادمية من `tree`/`name_field`/`parent_field`/`initial_depth`/`export_hidden_cols` في سكربت التقرير) لأن الخادم لا ينفّذ JS ويحتاجها في تطبيع التصدير. تقرير بلا إعداد يُطبَّع في الخادم بـ `report_settings = {}` (فلا تُصدَّر أعمدته المخفية). و `get_meta.settings` يعيد `enrich_rules[].fields` قائمةً لا نصاً متعدد الأسطر، ومفتاح `source` = `"defaults"` أو `null`.
- الإعدادات مقروءة لكل مستخدمي Desk، فلا تُخزَّن فيها أسرار (مفاتيح، كلمات مرور، روابط موقّعة). اقتراحات `register` تظهر في شاشة الإعدادات كزر «اعتماد».
- الجداول الفرعية (`column_rules`) تُدمج بمفتاح `fieldname`: قاعدة في 4 تغلب نظيرتها في 3 حقلاً بحقل؛ الحقل الفارغ أو `Auto` لا يغلب.
- `enabled = 0` في 4، أو `enabled_for = Enabled Reports Only` بلا سجل ⇒ الصفحة تعرض «التقرير غير مفعّل في Report View» مع رابط للأصل. هذا ليس فحص صلاحية.

### 5.4 تقرير بلا إعدادات

يعمل بالكامل: فلاتر من سكربت التقرير، تطبيع §3، عرض جدول (أو شجرة إن وُجد `indent`)، تجميع وتحليل على الأبعاد المستنتجة، إجمالي بقواعد ADR-008، تصدير. لا إثراء، لا تفصيل، لا بطاقات توازن، لا عروض جاهزة.

---

## 6. DocType `Report View Saved View` — «لم يُبنَ»

> لم يُبنَ (ADR-010)، ولا اختباره الإلزامي. لا hooks مسجّلة له (ADR-007). المواصفة أدناه الخطة.

| الحقل | النوع | ملاحظة |
|---|---|---|
| `title` | Data، إلزامي | فريد لكل (مالك، تقرير)، يُتحقق في `validate` |
| `report` | Link Report، إلزامي | `set_only_once` |
| `visibility` | Select: `Private` / `Roles` / `Public` | `Private` |
| `roles` | Table MultiSelect `Report View Saved View Role` (`role`: Link Role) | إلزامي عند `Roles` |
| `state` | JSON | حالة العرض (§7) |
| `state_version` | Int، للقراءة فقط | |
| `columns_ref` | JSON، للقراءة فقط | `{key: {label, fieldtype, source_index}}` وقت الحفظ (§7.3) |
| `description` | Small Text | |

`naming`: hash. `owner` هو المالك. `track_changes`: 1. لا حقل «افتراضي» على العرض نفسه.

**الافتراضيات بلا DocType.**
- افتراضي المستخدم: `frappe.defaults` للمستخدم الحالي بالمفتاح `report_view_default::<report_name>`. لا يمكن ضبطه لمستخدم آخر، ولا روابط Link، فالحذف لا يتعطل. إن كان العرض محذوفاً أو لم يعد مرئياً يُتجاهل عند القراءة (بلا كتابة داخل GET)، ويُمسح المفتاح عند أول `set_default` لاحق.
- الافتراضي العام: `Report View Settings.default_saved_view` (§5.2).
- الأولوية: افتراضي المستخدم ← الافتراضي العام ← لا شيء. كلاهما يُعاد فقط إن كان مرئياً للمستخدم الآن.

**DocPerm** (للنوع وجدوله الفرعي): الدور `Desk User` (`SYSTEM_USER_ROLE`، `frappe/permissions.py:35`): `read`، `create`، و `write`، `delete` مع `if_owner = 1`. لا `share`، `export`، `print`، `report`، `import`. لا دور `All` لأنه يشمل مستخدمي الموقع. System Manager بلا صلاحية إضافية.

**شرط الرؤية** (دالة واحدة `is_visible(doc, user)` تستخدمها كل الطبقات):
```
owner == user
OR ( report ∈ DeskViews.get_allowed_report_names(user=user)        # frappe/desk/desk_views.py:111
     AND ( visibility == "Public"
           OR (visibility == "Roles" AND roles ∩ frappe.get_roles(user) ≠ ∅) ) )
```
المالك يرى عرضه حتى لو فقد صلاحية التقرير (ليحذفه). في hook القراءة يُفحص شرط المالك **أولاً**، ثم صلاحية التقرير لغير المالك فقط. `get_view` يمر بـ `guard_report` أولاً فلن يطبّق عرضاً لتقرير لم يعد مسموحاً.

**`permission_query_conditions`**، التوقيع `get_permission_query_conditions(user: str | None) -> str`:
```sql
`tabReport View Saved View`.owner = {user}
OR ( `tabReport View Saved View`.report IN ({allowed_reports})
     AND ( `tabReport View Saved View`.visibility = 'Public'
           OR ( `tabReport View Saved View`.visibility = 'Roles'
                AND `tabReport View Saved View`.name IN (
                    SELECT parent FROM `tabReport View Saved View Role`
                    WHERE parenttype = 'Report View Saved View'
                      AND parentfield = 'roles'
                      AND role IN ({user_roles}) ) ) ) )
```
كل القيم بـ `frappe.db.escape`، على نمط Frappe في Prepared Report (`prepared_report.py:320-334`). إذا كانت قائمة التقارير المسموحة أو قائمة الأدوار فارغة يُحذف الفرع المقابل (لا `IN ()`) فيبقى شرط المالك وحده. يُطبَّق على Administrator أيضاً (لا نعيد `None` له)، فلا يرى الخاص في القوائم.

**hook `has_permission`**، التوقيع `has_permission(doc, ptype: str, user: str | None, debug: bool = False) -> bool`. القيمة `None` منعٌ في Frappe (`permissions.py:492-496`)، فكل فرع يعيد `bool` صريحاً:

| ptype | القيمة |
|---|---|
| `read`، `email`، `print` | المالك المخزّن ⇒ `True`؛ وإلا `is_visible(doc, user)`، وتقرير غير مسموح ⇒ `False` (يُفحص بـ `get_report_doc(doc.report)` داخل `try` مع مسح `message_log`) |
| `write`، `delete`، `cancel`، `submit`، `amend`، `share` | `stored_owner(doc) == user`، حيث `stored_owner` = `doc.get_doc_before_save().owner` إن وُجد، وإلا `frappe.db.get_value("Report View Saved View", doc.name, "owner")` للمستندات غير الجديدة، و `doc.owner` للجديدة فقط. **لا** يُقرأ `owner` من الذاكرة: REST (`frappe/api/v1.py:49-57`) يطبّق `doc.update(data)` قبل `check_permission` (`document.py:577`)، و `owner` ليس من `RESERVED_KEYWORDS` (`base_document.py:292`)، فيمكن لأي مستخدم إرسال `{"owner": "<me>"}` والاستيلاء على العرض (`phase-2-review.md` ح4) |
| `create` | `True` (تحكمه DocPerm؛ و `validate` يتحقق أن `guard_report(doc.report)` ينجح) |
| أي نوع آخر | `True` (تحكمه DocPerm) |

**تحقق المتحكم (`validate`)**، لأن REST لا يمر بـ `save_view` (`phase-2-review.md` ع7):
- لغير الجديد: `owner` لا يتغير (مقارنة بـ `get_doc_before_save().owner`) وإلا `frappe.PermissionError`. `report` لا يتغير (`set_only_once`).
- `state` يمر بـ `core/view_state.validate` + `migrate`؛ `state_version` و `columns_ref` تُحسب في الخادم ولا تُقبل من المدخل.
- `visibility` من القائمة؛ `Roles` ⇒ `roles` غير فارغة وكل دور موجود؛ `Private`/`Public` ⇒ `roles` تُفرَّغ.
- `guard_report(doc.report)` ينجح للمستخدم الحالي عند الإنشاء والتعديل.
- `title` فريد لكل (مالك، تقرير).

**استثناء موثّق من قاعدة «لا db»:** `frappe.db.get_value(..., "owner")` في الـ hook قراءة لقيمة واحدة لأجل فحص صلاحية، ولا تُعاد للمستخدم. قاعدة `CLAUDE.md` تمنع `db.sql` و `get_all` في الواجهات التي تعيد بيانات؛ هذا ليس منها، ويُذكر هنا كي لا يرفضه المراجع آلياً.

**حقائق مثبتة من الكود** (`docs/progress/phase-2-review.md` ع6):
- Administrator يتجاوز الـ hook عند فتح مستند بالاسم (`permissions.py:107`)، لكن الـ pqc يُطبَّق عليه في القوائم. لذلك `get_view` و `list_views` يطبّقان `is_visible` صراحة. وصوله للخاص عبر REST بالاسم قيد معروف موثّق (حساب صيانة).
- System Manager لا يتجاوز الـ hook ولا الـ pqc.
- DocShare يتغلب على الـ hook والـ pqc (`permissions.py:208-209`، `database/query.py:1592-1596`). بلا صلاحية `share` لأي دور لا ينشئه إلا Administrator. يُختبر في المرحلة 4.
- اختبار إلزامي في المرحلة 4: `PUT /api/resource/Report View Saved View/<name>` بجسم `{"owner": "<attacker>"}` من مستخدم آخر ⇒ 403، والعرض لم يتغير.

**النصوص المشتركة.** `title` و `description` يكتبهما مستخدم ويراهما غيره، فتُعرض دائماً عبر `frappe.utils.escape_html` في JS ولا تُحقن كـ HTML.

---

## 7. حالة العرض

### 7.1 المخطط (الإصدار 1)

```js
{
  v: 1,
  mode: "grid" | "pivot" | "charts" | "pages",   // pages = التقرير صفحات مطبوعة (ADR-014)
  report_filters: { /* فلاتر التقرير (معايير الخادم) */ },
  columns: {
    order: [key],              // الأعمدة الظاهرة بالترتيب
    hidden: [key],
    widths: { [key]: px },
    pinned: { start: [key], end: [key] }
  },
  sort: [ { key, dir: "asc" | "desc" } ],
  filters: [                   // فلاتر المتصفح (بعد التشغيل)
    { key, type: "text",  op: "contains" | "equals" | "starts_with" | "not_contains", value: string },
    { key, type: "set",   values: [any], exclude: bool },
    { key, type: "range", min: number | null, max: number | null },
    { key, type: "date",  from: "YYYY-MM-DD" | null, to: "YYYY-MM-DD" | null },
    { key: "*", type: "text", op: "contains", value, source: "search" }  // شريحة بحث حر
  ],
  quick_filters: [id],         // من register.quick_filters
  group: { by: [key], subtotals: bool, expanded: "all" | "none" | [path] },
               // path = قيم مفاتيح التجميع من الأعلى (نص، رقم، منطقي، null)؛ القائمة = المجموعات المفتوحة
  tree: { depth: int | null, expanded: [rid] | null },   // للتقارير الشجرية؛ القائمة = __rid الآباء المفتوحين
  values: [ { key, agg: "sum" | "avg" | "count" | "min" | "max" | "count_distinct" } ],
  pivot: { rows: [key], cols: [key], values: [ { key, agg } ], totals: { rows: bool, cols: bool } },
  charts: {                    // لوحة الرسوم؛ null = لوحة التقرير الافتراضية (register.charts أو من أبعاده)
    cards: [ { id, type: "bar" | "stacked" | "hbar" | "hstacked" | "line" | "area" | "donut" | "kpi",
               x: key | null,          // null = المقاييس متجاورة (أو بطاقة رقم)
               series: [key], agg: "sum" | "avg" | "count" | "min" | "max" | null,
               sort: "desc" | "asc" | "label" | null, top: 5 | 10 | 20 | 0 | null,
               size: "half" | "full", title: string | null, filter: [ { key, values: [v] } ] } ],
    slicers: [ { key, type: "set", values: [v] | null } | { key, type: "date", from, to } ],
    cross: { card, key, value } | null   // الفئة التي نُقر عليها في بطاقة تفلتر البقية
  } | null,
  ui: { density: "comfortable" | "compact", side_panel: "columns" | "filters" | null }
}
```

الثيم (فاتح/داكن) ليس جزءاً من الحالة: يتبع ثيم Desk للمستخدم.

### 7.2 التحقق

`state/view_state.js` و `core/view_state.py` ينفّذان المخطط نفسه: أنواع، قيم من القوائم المغلقة، حدود أطوال (200 فلتر، 5,000 قيمة، 50 عمود تجميع، 20 بُعد تحليل). المفاتيح غير المعروفة تُحذف (لا تُرفض) في المتصفح، وتُرفض في الخادم.

### 7.3 الترحيل ومراجع الأعمدة

- `migrate(state)`: سلسلة دوال `v0→v1→…`. إصدار أكبر من المعروف ⇒ يُستخدم العرض الافتراضي مع تنبيه «هذا العرض أُنشئ بإصدار أحدث».
- **v0** = حالة بلا `v` (لا يوجد إنتاج قبل v1؛ السلسلة جاهزة لإضافات لاحقة).
- الحالة المحفوظة ترافقها `columns_ref`. عند الفتح: كل مفتاح غير موجود في الأعمدة الحالية يُبحث عنه بـ (`label` مترجماً) ثم (`source_index` + `fieldtype`). النجاح ⇒ إعادة ربط صامتة؛ الفشل ⇒ حذف المرجع من الحالة وتنبيه يسرد الأعمدة المفقودة. هذا يحل نمط الكتالوج 8.

### 7.4 التمثيل في الرابط

```
/desk/report-view/<report_name>?<فلاتر التقرير كمعاملات عادية>&rv=<base64url(JSON)>
/desk/report-view/<report_name>?<فلاتر>&view=<saved_view_name>
```

- فلاتر التقرير كمعاملات عادية لتتوافق مع `frappe.route_options` والروابط القادمة من query-report (`QJ:65-90`).
- `rv` = الحالة بدون `report_filters` و `ui`، مرمّزة `base64url(UTF-8 JSON)` بلا ضغط (لا مكتبة إضافية).
- إن تجاوز الرابط 2,000 حرف: لا يُكتب `rv`، ويظهر في القائمة «احفظ العرض لمشاركته».
- التحديث بـ `history.replaceState` كما في الأصل، مع تأخير 300 ms.
- الأولوية عند الفتح: `rv` ← `view` ← الافتراضي (ADR-010) ← `register.default_mode`.

---

## 8. الأداء

الأرقام من `docs/research/perspective-experiments.md` §3 (Chromium، خادم بأربع أنوية تحت حمل).

| البند | القرار |
|---|---|
| الحد الأقصى للصفوف | `min(max_rows, System Settings.max_report_rows)`؛ الافتراضي في الكود 50,000 (الخطة 100,000، قرار صاحب المشروع معلّق) والسقف الصلب 200,000 (ADR-009). عند 100 ألف: أول عرض 468ms و `group_by` بمستويين 117ms و `split_by` 246ms. عند 500 ألف: أول عرض 3.6 ث، وذاكرة 450-544MB، وتحميل الدفعة الواحدة أسقط التبويب |
| ما فوق الحد | رسالة بخيارات فعلية (ADR-009)؛ دعم كامل للتقارير المعدّة أصلاً |
| التحميل الكسول | سكربت الصفحة (Page) صغير ⇒ `frappe.require("report_view.bundle.js")` عند أول فتح (JS المكتبتين نحو 20KB مضغوطاً) ⇒ جلب ملفي WASM (2.28MB و 0.22MB، غير قابلين للضغط، مخزَّنين سنة في الكاش) عند أول تشغيل ⇒ `report_view_charts.bundle.js` عند أول فتح لعرض الرسوم. الصفحات الأخرى تحمّل `report_view_entry.bundle.js` فقط |
| أول تهيئة للمحرك | 0.3 ث على شبكة محلية، 2.7 ث على 10Mbit، 13 ث على 1.6Mbit (مرة واحدة). حالة التحميل تعرض «جارٍ تجهيز المحرك» مع أول فتح |
| Web Worker | دائماً: Perspective يعمل في worker واحد للصفحة، ننشئه نحن من ملف ثابت لنملك مقبضه (§8أ.1) |
| التحميل في الجدول | بصيغة أعمدة، على دفعات ≤ 50,000 صف (يخفض ذروة الذاكرة من 450MB إلى 137MB عند 500 ألف) |
| العرض | `regular-table` افتراضي: لا يُرسم إلا النافذة الظاهرة، ويقرأها من `view.to_columns` |
| التطبيع | خطي O(n) في الخيط الرئيسي |
| الأهداف | كما في `docs/brief.md`. تُقاس من جديد في المرحلتين 4 و 7 ببيانات مولّدة وعلى جهاز مستخدم عادي |

---

## 8أ. محرك Perspective

### 8أ.1 التحميل (`engine/perspective_engine.js`)
الطريقة المثبتة بالتجربة (`perspective-experiments.md` §1.6):
- `import perspective from "@finos/perspective"` و `import "regular-table"` داخل `report_view.bundle.js` (يُبنيان على es2017 بلا إعداد).
- `perspective.init_server(fetch(BASE + "/wasm/perspective-server.wasm?v=" + VERSION))` و `perspective.init_client(fetch(BASE + "/wasm/perspective-js.wasm?v=" + VERSION))` مرة واحدة للصفحة.
- `BASE = "/assets/report_view/node_modules/@finos/perspective/dist"` (مجلد `node_modules` للتطبيق يربطه `bench build` داخل الأصول). `VERSION` يساوي الإصدار المثبّت ويكسر الكاش عند الترقية؛ اختبار آلي يتأكد أنه يطابق `package.json`.
- الـ worker: `new Worker(BASE + "/cdn/perspective-server.worker.js?v=" + VERSION, {type: "module"})` ثم `perspective.worker(Promise.resolve(worker))`.
- لا تُستعمل النسخة inline (3.7MB، top-level await)، ولا استيراد `.wasm` عبر esbuild (لا loader في Frappe).
- CSP: الخادم لا يرسل CSP اليوم. إن فُعّلت لاحقاً فالحد الأدنى `script-src 'self' 'wasm-unsafe-eval'`؛ ولا حاجة لـ `blob:` لأن الـ worker من ملف.

### 8أ.2 عقد `view config`
`engine/view_config.js` دالة خالصة واحدة: `to_view_config(view_state, normalized, mode) -> {table: "nodes" | "rows" | "facts", config, post}` (`rows` = جدول «الصفوف كما هي» للتقارير المسطحة ذات الصفوف البينية، N9أ). اللوحات لا تبني `config` مباشرة؛ تعدّل حالة العرض فقط.

| مفتاح `config` | مصدره في حالة العرض (§7.1) | ملاحظات |
|---|---|---|
| `group_by` | `group.by` (أبعاد المستخدم)، أو `level_1..n` في الشجرة المعاد تجميعها، أو `pivot.rows` | فارغ في الشجرة «كما هي» (جدول العقد) |
| `split_by` | `pivot.cols` في وضع التحليل فقط | لا يعيد عمود إجمالي؛ `view` ثانٍ بلا `split_by` |
| `columns` | `columns.order` ناقص `columns.hidden`، ثم الأعمدة التقنية المطلوبة للعرض (`__rid`، `__depth`، …) | الأعمدة التقنية لا تظهر |
| `aggregates` | `values[].agg` أو `Column.agg` | مقابلة الأسماء: `sum`→`sum`، `avg`→`avg`، `count`→`count`، `count_distinct`→`distinct count`، `min`→`min`، `max`→`high`. **لا `max` ولا `low`**: يعيدان `null` و 0 عند وجود `null`. أعمدة الأبعاد في صفوف المجموعات: `unique` |
| `filter` | `filters` و `quick_filters` والبحث | `text contains`→`contains` (غير حساس للحالة)، `equals`→`==`، `starts_with`→`begins with`، `set`→`in` / `not in`، `range`→شرطان `>=` و `<=` (لا `between`)، `date`→شرطان. لا `filter_op: "or"` (أعاد نتائج فارغة في التجربة)؛ «أو» داخل عمود واحد تُكتب `in` |
| `sort` | `sort` | عمود نصي ⇒ عمود مفتاحه `__sort__<key>`؛ في الشجرة «كما هي» يُسبق بمفتاح المسار للحفاظ على الهرمية |
| `expressions` | `register.derived_columns` المعرّفة بالقائمة المغلقة، والفلاتر السريعة | بلا نصوص حرفية غير ASCII؛ تُحسب قبل التجميع دائماً |

ملاحظات من التنفيذ (المرحلة 3، `docs/progress/phase-3-perspective.md`):
- كل عمود فرز يُدرج في `columns` كعمود تقني مخفي في العرض: عمود فرز غير موجود في `columns` يفسد نوافذ `to_columns` في `view` مجمَّع.
- في العرض المجمَّع يُضاف `__rid` كآخر مستوى في `group_by` حتى تظهر صفوف الحقائق تحت مجموعاتها؛ بدونه لا يعيد `view` إلا صفوف المجاميع.
- طي الشجرة «كما هي»: فلتر `__depth <= D` إلى أن يطوي المستخدم عقدة، ثم `not in` على أعمدة الأسلاف `__anc_i`؛ `tree.expanded` قائمة `__rid` للآباء المفتوحين.
- الفلاتر التي لا يعبّر عنها Perspective (`not_contains`، البحث الحر على كل الأعمدة، نوع لا يناسب العمود، «فارغ مع قيم») تُعاد في `post.notices` ولا تُطبَّق بصمت. الخادم لا يطبّقها أيضاً: يرفض التصدير بـ `RVInvalidViewState` (§4.2 بند 4).

`post` = ما لا يعبّر عنه `config` ويُطبَّق في نموذج البيانات بلا حساب: إدراج صفوف المجموع الفرعي، وإخفاء الأعمدة التقنية، وترتيب الأشرطة.

ما لا تستطيع اللوحات تمريره: أسماء جداول، تعابير حرة من المستخدم، أو أعمدة غير موجودة في `normalized.columns` (تُحذف من الحالة بتنبيه، §7.3).

### 8أ.3 دورة الحياة
| الكائن | يُنشأ | يُحذف |
|---|---|---|
| worker + client | عند أول تشغيل تقرير في الصفحة (مرة واحدة) | `on_page_hide` إن لم يعد المستخدم خلال 60 ثانية، وعند `beforeunload`: `client.terminate()` ثم `worker.terminate()`. ذاكرة WASM المحجوزة لا تنكمش بغير ذلك |
| `table` (`facts`، ومعه `nodes` للشجرية أو `rows` للمسطحة ذات الصفوف البينية) | بعد كل `api.run` ناجح وتطبيع | قبل تحميل نتيجة جديدة، وعند تبديل التقرير، وعند إنهاء المحرك. بعد حذف كل `view` عليه |
| `view` الرئيسي | عند كل تغيير في `view config` | يُنشأ الجديد أولاً ثم يُبدَّل في نموذج البيانات ثم يُحذف القديم (لا وميض) |
| `view` مؤقت (قيم فريدة، تفصيل، نطاق، رسم، عمود إجمالي التحليل) | عند الطلب | في `finally` فور القراءة، أو عند إغلاق النافذة أو الخروج من العرض |

قواعد المدير (`EngineHandles`)، من مفاجآت التجربة §7:
- كل `view` و `table` يُسجَّل عند الإنشاء؛ `delete()` يمر بالمدير حصراً ويجعل المقبض غير صالح. نداء على مقبض محذوف أو `delete()` مرتين **لا ينتهي أبداً** في Perspective، فالمدير يرمي خطأً فوراً بدل الانتظار.
- `table.delete()` مع `view` مفتوح يُرفض ثم يموت المقبض ويبقى الجدول؛ لذلك المدير يحذف كل عروض الجدول أولاً دائماً.
- نداءات متسابقة (تغيير إعداد أثناء بناء `view`) تُحل برقم جيل: النتيجة الأقدم تُحذف ولا تُعرض.
- عدّاد تطويري `engine.debug_handles()` يعيد غير المحذوف؛ اختبار Playwright يشترط صفراً بعد 20 تبديلاً.

### 8أ.4 القيم الفريدة لفلتر القيم
`queries.unique_values(table, key, other_filters)`: `view` مؤقت `{group_by: [key], columns: [key], aggregates: {[key]: "count"}, filter: other_filters, sort: [[__sort__key, "asc"]]}` على الجدول، ثم `to_columns()` ثم `delete()`. `other_filters` = كل الفلاتر النشطة عدا فلتر العمود نفسه، فيعكس العدّاد بقية الفلاتر. فوق 5,000 قيمة فريدة تُعرض أول 5,000 مع بحث يعيد الاستعلام بـ `contains`.

### 8أ.5 شريط الحالة والنطاق المحدد
- عدد الصفوف المعروضة: `view.num_rows()` (ناقص صف الإجمالي في العرض المجمَّع)؛ الإجمالي الكلي: حجم الجدول.
- النطاق: `view.to_columns({start_row, end_row, start_col, end_col})` لنافذة التحديد، ثم العدد والمجموع والمتوسط والأدنى والأعلى على الخلايا الرقمية. هذا تلخيص لقيم معروضة لا حساب تقرير، وهو الاستثناء الوحيد المسمّى من قاعدة «لا حساب خارج المحرك»، ومحصور في `queries.range_stats`.
- القاعدة الموثّقة (المرحلة 5ج): صفوف المجموعات والمجاميع الفرعية داخل النطاق **لا تدخل** في المجموع إذا كان أي من أبنائها ظاهراً داخل النطاق (منع العدّ المزدوج)؛ المجموعة المطوية تدخل بقيمتها.

### 8أ.6 نموذج التصدير من `view`
النموذج يرسل حالة العرض لا `view config`؛ الخادم يترجمها بمحرك بايثون التوأم (§4.3) ويقارن `expected` (§4.2 بند 7):
- `expected.row_count` = عدد الحقائق التي تمر من الفلاتر (`queries.count_rows` على جدول الحقائق بـ `post.fact_filter`، أو حجم الجدول بلا فلتر)، لا `num_rows()` للعرض الرئيسي الذي يشمل صفوف المجموعات ويتغيّر بالطي.
- `expected.totals` = **الإجمالي العام المعروض** (`opened.totals`): قيم الصف المرجعي حين يكون `post.total.source` = `row` (الشجرة «كما هي»، والتقرير المسطح بلا فلتر الذي يختمه صفه المرجعي)، أو صف مجموع Frappe (`frappe_total`)، أو صف الإجمالي من `view` غير ذلك. تُرسل الأرقام المنتهية فقط؛ الأعمدة المختلطة العملة أو الفارغة لا تُرسل.
- ما لا يطبّقه المتصفح من الحالة (§4.2 بند 4) يرفضه الخادم قبل الحساب؛ فلا يصل إلى `RVExportMismatch`.
- الفلاتر السريعة (ADR-013): النموذج يحمل `quick_filters: [{id, expression}]` من `register.quick_filters` (يجوز إرسالها كلها)، ولكل معرّف في `view_state.quick_filters` تعريف؛ المعرّف المجهول للمتصفح (`QUICK_FILTER_UNKNOWN`) يُحذف من حالة النموذج. **لم يُنفَّذ في المتصفح بعد**؛ إلى حينه تبقى `index.js` ترفض التصدير مع فلتر سريع نشط.

---

## 9. الترجمة و RTL

### 9.1 الترجمة
- كل نص للمستخدم: `__()` في JS و `_()` في بايثون. أسماء التقارير والأعمدة تمر بـ `__()` كما في الأصل.
- ملف `report_view/locale/ar.po` (نظام .po في frappe 16، مثل `erpnext/locale/ar.po`). اختبار آلي في المرحلة 7 يستخرج السلاسل ويتأكد أن كل واحدة مترجمة.
- رسائل الأخطاء من الخادم مترجمة بـ `_()`؛ رموز `exc_type` لا تُترجم.

### 9.2 RTL
- الاتجاه من `frappe.utils.is_rtl()`؛ الجذر `<div class="rv" dir="rtl|ltr">`.
- `regular-table` لا يدعم RTL من نفسه (`dir="rtl"` وحده يكسر التمرير الأفقي). يعمل بمحوّلين صغيرين في `views/rtl_adapter.js`: عكس إشارة `scrollLeft`، ونقل قيد `sticky` إلى اليمين داخل Shadow DOM (`perspective-experiments.md` §2.2). المحوّلان يعتمدان على تفاصيل داخلية في 0.9.1، فالإصدار مثبّت بالضبط ويُعاد اختبار RTL عند أي ترقية.
- CSS بخصائص منطقية فقط (`inset-inline-*`، `padding-inline`، `border-inline-*`)، كما في `rv.css`.
- الأرقام والتواريخ والرموز داخل `<bdi class="ltr">` مع `tabular-nums` و `white-space: nowrap`؛ الأرقام لاتينية كما في التصميم وإعدادات النظام.
- PDF و Excel: `dir="rtl"` في القالب، و `ws.sheet_view.rightToLeft = True` (تجربة المرحلة 1).

### 9.3 التنسيق
- الأرقام والتواريخ عبر `frappe.format(value, df, {inline: true}, row)`، حيث `df` هو `column.original` و `row` الصف الخام، فتعمل عملة الصف (`meta.js:319-320`) ولا يُقرأ `cur_frm` (`meta.js:297`). الدقة و `number_format` من إعدادات النظام.
- الـ formatter الأصلي للتقرير (إن وُجد): `report.formatter(value, row, column, data, default_formatter)` حيث `default_formatter` = غلافنا لـ `frappe.format`. يُستدعى في `addStyleListener` للصفوف الأصلية فقط (`data` في جدول العقد أو الحقائق بلا تجميع؛ الصف الأصلي يُجلب بـ `__rid`)، لا لصفوف المجموعات التي يحسبها Perspective (لا تملك شكل صف التقرير).
- ناتج الـ formatter HTML يُحقن كما في الأصل (`cellmanager.js:857-892`). التصدير لا يستخدمه أبداً: القيم الخام + `frappe.format_value` في الخادم.
- الألوان في JS: لا قيم ثابتة. الرسوم تقرأ `--c1..--c7` و `--dr`/`--cr` بـ `getComputedStyle` وتعيد القراءة عند تغيّر الثيم.

---

## 10. نقاط الدخول

| المدخل | الآلية | الإحالة |
|---|---|---|
| المسار | `/desk/report-view/<report_name>`؛ `/app/report-view/<name>` يعمل كإعادة توجيه | ADR-005 |
| زر في query-report | `report_view_entry.bundle.js` في `app_include_js`: مستمع `frappe.router.on("change")` ⇒ `get_entry_state` ⇒ `frappe.query_report.page.add_inner_button(__("Report View"), …)`، ويعيد الإضافة بعد `load_report` | ADR-007 |
| الرابط من الزر | ينقل فلاتر query-report الحالية: `frappe.set_route("report-view", name)` مع `frappe.route_options = frappe.query_report.get_filter_values()` | |
| مساحات العمل | رابط URL يدوي أو مشحون إلى `/desk/report-view/<name>` | ADR-007 |
| من Report View إلى الأصل | زر «فتح في query-report» في القائمة، ينقل الفلاتر | |
| التفصيل | `drilldowns` في الإعدادات ⇒ درج بـ `api.run` للتقرير الهدف | §5.2 |

---

## 11. خريطة المكونات

### 11.0 مصدر التصميم
`reference/design/` غير موجود. `reference/design/README.md` يصف محتوى `reference/design/` بأنه «نموذج أولي من Claude Design»، وفيه `Main.dc.html`، `Mobile.dc.html`، `States.dc.html`، `Tokens.dc.html`، و `rv.css` («هذا الملف هو أساس التنفيذ»). الخريطة مبنية عليه. أي تصدير لاحق في `reference/design/` يُقارن بهذه الخريطة، والفروق تُسجَّل في تقرير المرحلة 5أ.

الأرقام (#) هي أرقام حصر العناصر الـ 93 في النموذج. «regular-table» = ما توفره مكتبة العرض ونضبطه؛ «المحرك» = إعداد `view` في Perspective؛ «بناء» = نبنيه من الصفر؛ «Frappe» = عنصر Frappe موجود.

### 11.1 الجدول

| # | العنصر في التصميم | الملف المنفّذ | regular-table / المحرك / بناء / Frappe | المرحلة |
|---|---|---|---|---|
| 1، 2 | الجذر `.rv` (ثيم، كثافة، RTL) والإطار | `components/shell.js` + `css/rv_tokens.css` | بناء | 3 (بسيط)، 5أ |
| 3 | مسار التنقل | `components/header.js` | Frappe: `frappe.breadcrumbs` للصفحة | 5أ |
| 4، 5 | العنوان ووسم النوع وسطر المعلومات (الشركة، الفترة، العملة، وقت التشغيل) | `components/header.js` | بناء | 5أ |
| 6، 7، 8 | شريط الإجراءات، الكثافة، الثيم | `components/header.js` | بناء؛ الثيم الافتراضي يتبع ثيم Desk، والزر يبدّل صنف `.rv.dark` محلياً فقط ويُحفظ في localStorage | 5أ |
| 9، 10، 11 | أزرار Excel و PDF والطباعة | `components/header.js` ⇒ `api.export_xlsx/pdf` | بناء؛ تظهر حسب `perms` | 3 (Excel)، 6 |
| 12، 16 | شريط معايير الخادم وحالة «معلّق» وزر التشغيل | `filters/report_filters.js` | Frappe: `frappe.ui.form.make_control` لكل فلتر من `script.filters`؛ حالة «معلّق» بناء | 3، 5أ |
| 13، 14، 15 | حقل الفلتر، قائمة الاختيار، التاريخ | `filters/report_filters.js` | Frappe controls مع CSS التصميم | 3 |
| 17-22 | مكوّن الفترة: القوالب الجاهزة، وضع النطاق بتقويمين، وضع الفترة المالية، التذييل | `filters/period_picker.js` | بناء؛ السنة المالية من `frappe.get_list("Fiscal Year")` بصلاحيات المستخدم؛ يُربط بفلاتر التقرير عبر `register.period` | 5أ |
| 23، 24 | بطاقات الملخص (افتتاحي/حركة/ختامي) وشارة الحالة | `components/summary.js` | بناء؛ من `register.summary` (أزواج التوازن) أو `report_summary` | 5أ (عرض)، 6 (معادلة التوازن) |
| 25، 26 | شريط الأدوات ومبدّل العرض (جدول/Pivot/رسوم) | `components/toolbar.js` | بناء | 3 (جدول فقط)، 5ب، 5د |
| 27، 28، 29 | البحث بالشرائح، الاقتراحات، القائمة المنسدلة (فلاتر سريعة وأبعاد تجميع) | `components/search.js` | بناء؛ الشرائح تكتب في `view_state.filters` | 5هـ |
| 30، 31 | زر المفضلة وقائمة العروض (جاهزة ومحفوظة، حفظ) | `components/saved_views.js` ⇒ `api.views.*` | بناء؛ نضيف المشاركة (خاص/أدوار/عام) والافتراضي بعناصر التصميم نفسها، لأن النموذج بلا مشاركة | 5هـ |
| 32 | إطار الجدول | `views/grid_view.js` | regular-table: `<regular-table>` بنموذج بيانات افتراضي (`setDataListener`) يقرأ نوافذ من `view` | 3 |
| 33 | لوحة مجموعات الصفوف (سحب، ترتيب، حذف، مجاميع فرعية، فتح/طي الكل) | `components/group_panel.js` | بناء (لوحة وسحب HTML5 من رؤوس الجدول)؛ الناتج `group_by` في `view config` | 5أ |
| 34 | لوحة أعمدة التحليل | `components/group_panel.js` | بناء؛ الناتج `split_by` | 5ب |
| 35 | الرؤوس المجمّعة (أشرطة افتتاحي/حركة/ختامي) | `views/grid_view.js` | regular-table: رؤوس متعددة المستويات (`column_headers`)؛ الأشرطة من `register.columns[*].band` أو من مسارات `split_by` | 3 (أساسي)، 5أ |
| 36، 37 | الفرز لكل عمود ومؤشر الفلتر | `views/grid_view.js` | بناء (أيقونة ونقرة على الرأس)؛ المحرك: `sort` على عمود المفتاح `__sort__<key>` للنصوص | 5أ |
| 38 | قائمة العمود (تثبيت، ضبط العرض، تجميع، فلتر القيم، فرز، إخفاء، إعادة ضبط) | `components/column_menu.js` | بناء (قائمة بأصناف `.rv-pop/.rv-mi`)؛ الناتج تعديل حالة العرض | 5أ |
| 39 | تغيير عرض العمود | `views/grid_view.js` | بناء (مقبض سحب في الرأس، حد أدنى 72px؛ العرض في حالة العرض ويُطبَّق في `addStyleListener`) | 5أ |
| 40 | سحب الرأس إلى مناطق التجميع/القيم/التحليل | `components/group_panel.js`، `side_panel.js` | بناء؛ الناتج `group_by` / `columns` / `split_by` | 5أ، 5ب |
| 41، 42، 43 | الفلاتر العائمة: نص، مجموعة، نطاق أرقام | `views/grid_view.js` + `components/header_filters.js` | بناء: صف رأس إضافي خاص بنا فوق الجدول؛ المحرك: `filter` | 5أ |
| 44 | نافذة فلتر القيم (بحث، الكل، عدّاد، مسح) | `components/set_filter.js` | بناء؛ القيم الفريدة والعدّ من `view` مؤقت في المحرك (§8أ.4) | 5أ |
| 45، 50 | صف البيانات وخلية الحساب (رقم + اسم، رابط) | `views/grid_view.js` + `format.js` | regular-table: الخلايا تُنسَّق في `addStyleListener` عبر §9.3 | 3 |
| 46، 49 | صف رأس المجموعة، المسافة البادئة، زر الفتح، العدّاد؛ الشجرة | `views/grid_view.js` | المحرك: `group_by` على أعمدة المستويات أو الأبعاد، و `expand`/`collapse`/`set_depth`؛ في الشجرة «كما هي» جدول العقد وفلتر الأسلاف (§3.2أ N9). regular-table: رؤوس الصفوف (`row_headers`) بعمود شجري واحد، والمسافة والسهم والعدّاد في `addStyleListener` | 3 |
| 47 | صف المجموع الفرعي للمجموعة | `views/grid_view.js` | بناء: صف مولَّد في نموذج البيانات بعد آخر ابن، بقيم صف المجموعة نفسه من `view` (لا حساب) | 5أ |
| 48 | الإجمالي العام المثبّت أسفل الجدول | `views/grid_view.js` | بناء: عنصر خاص خارج منطقة التمرير يقرأ صف الإجمالي من `view` (الصف 0 في العرض المجمَّع)، أو صف `internal_total` المرجعي في الشجرة «كما هي» | 3 |
| 51 | تنسيقات الخلايا (مدين، دائن، سالب، صفر «—») | `format.js` + `css/rv_components.css` | بناء (أصناف `.dr/.cr/.neg/.zero` في `addStyleListener`) فوق `frappe.format` | 5أ |
| 52 | الأعمدة المثبّتة وظل الحافة | `views/grid_view.js` | regular-table: رؤوس الصفوف مثبّتة في البداية (مع محوّل RTL)؛ عمود النهاية المثبّت غير مدعوم في المكتبة (§11.3) | 5أ |
| 53، 54 | أزرار خلية الإجراءات وقائمة إجراءات الصف | `components/row_actions.js` | بناء: زر «…» يظهر عند المرور داخل خلية العمود المثبّت ويفتح قائمة الصف؛ القائمة من `register.row_actions` + الإجراءات العامة | 5ج، 5د |
| 55 | تحديد نطاق الخلايا | `views/grid_view.js` | بناء: حالة التحديد بإحداثيات البيانات لا DOM، وتُرسم في `addStyleListener` | 5ج |
| 56، 66 | إحصاءات التحديد وشريط الحالة | `components/status_bar.js` | بناء؛ الأرقام من المحرك (§8أ.5) | 5ج |
| 57 | القائمة السياقية (نسخ، نسخ مع الرؤوس، تصدير المحدد، رسم من النطاق، فتح) | `components/context_menu.js` | بناء (قائمة سياقية خاصة)؛ النسخ TSV خام من `view.to_columns` لنافذة النطاق | 5ج |
| 58 | هيكل التحميل الرمادي | `components/states.js` | بناء | 5هـ |
| 59 | حالة «لا نتائج» مع شرائح الفلاتر وإجراءات | `components/states.js` | بناء | 5هـ |
| 60 | حالة الخطأ (العنوان، الرسالة، الرمز، إعادة المحاولة، نسخ التفاصيل) | `components/states.js` | بناء؛ الرمز من `exc_type` (§2.0) | 3 (أساسي)، 5هـ |
| — | حالة «أكبر من الحد» و «Prepared قيد التوليد» | `components/states.js` | بناء بعناصر حالة التصميم (غير موجودة في النموذج؛ ADR-009) | 4، 5هـ |
| 61 | تبويبات اللوحة الجانبية العمودية | `components/side_panel.js` | بناء | 5ب |
| 62 | لوحة الأعمدة (مفتاح Pivot، بحث، قائمة قابلة للسحب، أوسمة النوع) | `components/side_panel.js` | بناء | 5ب |
| 63 | مناطق السحب في اللوحة (مجموعات، قيم مع دالة التجميع، أعمدة تحليل) | `components/side_panel.js` | بناء | 5ب |
| 64، 65 | لوحة الفلاتر والفلاتر السريعة | `components/filter_panel.js` | بناء؛ الفلاتر السريعة من `register.quick_filters` | 5ب |
| 67 | جدول التحليل | `views/pivot_view.js` | المحرك: `split_by` + `group_by` + `aggregates`؛ regular-table يبني الرؤوس من مسارات الأعمدة؛ عمود الإجمالي من `view` ثانٍ بلا `split_by` | 5ب |
| 68 | تفصيل خلية التحليل | `components/pivot_drill.js` | بناء؛ الصفوف من `view` مؤقت بفلتر مسار الصف والعمود | 5ب |
| 69-73 | لوحة الرسوم (أعمدة حسب النوع الجذري، حلقة، أشرطة أفقية، حالة غير جاهز) | `views/charts_view.js` (bundle الرسوم) | ECharts بدل CSS/SVG في النموذج (الموجز يحدد ECharts)، بنفس الألوان من المتغيرات؛ الرسوم الافتراضية من `register` أو من أول بُعد ومقياس | 5د |
| 74 | نافذة الرسم من النطاق | `components/chart_dialog.js` | Frappe `frappe.ui.Dialog` + ECharts | 5د |
| 75 | درج كشف الحساب | `components/drill_drawer.js` | بناء؛ **البيانات من `api.run("General Ledger", …)`** عبر `drilldowns` وليس من قيود في المتصفح كما في النموذج (§11.3) | 5د |
| 76 | نافذة تفاصيل القيد | `components/voucher_dialog.js` | `frappe.ui.Dialog`؛ السطور من `api.run("General Ledger", {voucher_no})`؛ «قبض/صرف» من `account_type` المثرى لا من أرقام حسابات ثابتة | 5د |
| 77 | وضع «صفحات»: التقرير صفحات مطبوعة (الورق والاتجاه والهوامش، القالب، الترويسة، اللغة، الفلاتر، المجاميع، التوقيعات، الترقيم) والطباعة من المكان نفسه | `views/pages_view.js` + `engine/page_layout.js` + `views/grid_rows.js` ⇒ `api.get_print_options`، `api.get_print_format`، `api.get_translations`، `api.run(_lang)` | بناء؛ الصفحات تُقطع في المتصفح من `view` الجدول نفسه وتُطبع بنافذة المتصفح (ADR-014). PDF من الخادم يبقى زراً لاحقاً (المرحلة 6، ADR-001) | 5هـ |
| 78 | النافذة العامة | — | Frappe `frappe.ui.Dialog` بأصناف التصميم | 5أ |
| 79 | تموضع النوافذ المنبثقة | `components/popover.js` | بناء (يحترم RTL والحافة) | 5أ |
| 80 | التنبيه المؤقت | — | Frappe `frappe.show_alert` بتنسيق `.rv-toast` | 3 |
| 81، 82 | العناصر الأولية (أزرار، روابط، صناديق اختيار، مفاتيح، شارات) | `css/rv_components.css` | CSS فقط | 5أ |
| 83 | معالجة RTL | كل الملفات | §9.2 | كل المراحل |
| 84 | لوحة المفاتيح (Enter، Backspace، Escape، Shift+نقرة) | `components/*` | بناء؛ نضيف Ctrl+C و Ctrl+Shift+C فعلياً (في النموذج تلميح فقط) | 5أ، 5ج |
| 85 | مبدّل حالات العرض التجريبي | — | خاص ببيئة التصميم؛ لا يُنفَّذ | — |
| 86-91 | الجوال: شريط التطبيق، الملخص، البحث والفلاتر، مبدّل الأشرطة، قائمة الحسابات، الورقة السفلية | `components/mobile/*.js` | بناء؛ عند عرض ≤ 600px تتحول اللوحات إلى أوراق سفلية ويبقى الجدول بتمرير أفقي وعمود مثبّت محدود العرض (المرحلة 5هـ) | 5ب، 5هـ |
| 92 | لوحة الحالات | — | مرجع بصري لـ #58-60 | 5هـ |
| 93 | لوحة الرموز | `css/rv_tokens.css` | 68 متغيراً: خط، أسطح، خطوط، نصوص، علامة، محاسبة، حالات، شبكة، رسوم، طبقة، ظلال، أنصاف أقطار، كثافة. جدول الربط مع Tabulator في `Tokens.dc.html` مُلغى (ADR-012؛ البديل `docs/research/prototype-mapping.md`) | 5أ |

### 11.2 قرارات الربط مع regular-table و Perspective
- **مصدر واحد للأرقام:** كل رقم على الشاشة يأتي من `view` (أو من صف التقرير الأصلي في جدول العقد). لا جمع ولا متوسط في كود العرض.
- **الهرمية:** العرض الشجري «كما هو» من جدول العقد بفلتر الأسلاف؛ تجميع المستخدم والتحليل من جدول الحقائق بـ `group_by` و `split_by` (§3.2أ N9).
- **النموذج الافتراضي:** `setDataListener(x0, y0, x1, y1)` يطلب `view.to_columns({start_row, end_row, start_col, end_col})` ويعيد `data`، `row_headers`، `column_headers`، `num_rows`، `num_columns`. لا يُحمَّل في DOM إلا النافذة الظاهرة.
- **التنسيق:** `addStyleListener` يضبط الأصناف والمحتوى لكل `td`/`th` من `getMeta`؛ لا CSS من ثيمات Perspective.
- **عمود شجري واحد** في رؤوس الصفوف، وحد أقصى لعرضه على الشاشات الضيقة (على 390px أخذ 331px من 370px في التجربة).

### 11.3 انحرافات مقصودة عن التصميم
| العنصر | التصميم | التنفيذ | السبب |
|---|---|---|---|
| مصدر أرقام ميزان المراجعة | يحسبها من قيود GL في المتصفح (`compute()`) | من رد تقرير Trial Balance | المبدأ المعماري: نفس التقرير ونفس الصلاحيات (ADR-002)؛ ومطابقة الأصل |
| درج كشف الحساب ونافذة القيد | من قيود GL محمّلة مسبقاً | `api.run("General Ledger")` عند الطلب | الصلاحيات، وعدم تحميل كل القيود |
| قبض/صرف في نافذة القيد | أرقام حسابات ثابتة 1110/1120/1121 | `account_type` في (Cash, Bank) من الإثراء | الأرقام تختلف بين الشركات |
| الرسوم | CSS/SVG يدوي | ECharts | `docs/brief.md` |
| العروض المحفوظة | محلية بلا مشاركة | DocType مع مشاركة وافتراضي | `docs/brief.md` والمرحلة 5هـ |
| شريط الخادم | فلتران ثابتان (الشركة، الفترة) | فلاتر سكربت التقرير كلها، ومكوّن الفترة عند وجود فلاتر التاريخ | عمومية المحرك لأي تقرير |
| معاينة الطباعة | صفحات مولّدة في المتصفح | صفحات مولّدة في المتصفح من `view` الجدول، تُطبع من المتصفح (ADR-014)؛ PDF الخادم زر لاحق | ADR-014 (طلب صاحب المشروع 2026-10-12) |
| أزرار Excel/PNG للنطاق | تنبيه فقط | تنفيذ فعلي (Excel للنطاق عبر `scope: selection`؛ PNG من ECharts) | إكمال السلوك |
| عمود الإجراءات المثبّت في النهاية | عمود ثالث مثبّت يسار الجدول بثلاثة أزرار | زر «…» يظهر عند المرور داخل العمود المثبّت في البداية، ويفتح قائمة الصف نفسها | `regular-table` لا يدعم تثبيت عمود في النهاية؛ البديل (عنصر مستقل و `view` ثانٍ) كلفته أعلى من فائدته (`perspective-experiments.md` §2.4). يُعاد النظر إن طلب صاحب المشروع |
| ترتيب الأعمدة في RTL | sticky يمين/يسار | محوّل RTL خاص فوق `regular-table` | المكتبة لا تدعم RTL (§9.2) |

---

## 12. ملخص الصلاحيات (للمراجعة)

| الدالة | الفحص الأول | فحوص إضافية بالترتيب | ما يرفضه |
|---|---|---|---|
| `run` | `guard_report` | اتحاد `js_filters` مع `filter_defs` ⇒ تحقق `prepared_report_name` ⇒ `query_report.run` (طبقات Frappe كلها) ⇒ حد الصفوف | مستخدم بلا دور التقرير أو بلا `report` على `ref_doctype`، تقرير معطّل أو غير مدعوم، قيم فلاتر Link غير مسموحة، صفوف تمنعها User Permissions (حسب حدود Frappe) |
| `get_meta` | `guard_report` | قراءة الإعدادات بـ `check_permission` | كما `guard_report` |
| `enrich` | `guard_report` | قائمة السماح ⇒ حد الأسماء ⇒ `get_permitted_fieldnames` ⇒ `frappe.get_list` | ثلاثيات غير مسموحة، حقول permlevel أعلى، مستندات بلا read أو خارج User Permissions |
| `export_xlsx` | `guard_report` | `guard_export` ⇒ نموذج ⇒ إعادة `run` ⇒ مقارنة الإجماليات | بلا `export`، نماذج مزوّرة أو غير متسقة |
| `export_pdf` | `guard_report` | `guard_print` (بلا مشاركات) ⇒ كما سبق | بلا `print`، ولو شُورك معه مستند |
| `get_entry_state` | `guard_report_quiet` | الإعدادات | لا يكشف إلا `show: false` |
| `views.*` | `guard_report` | pqc + hook `has_permission` + `is_visible` صراحة (المالك للكتابة والحذف) | قراءة أو تعديل الخاص من غير مالكه، رؤية أي عرض لتقرير غير مسموح |
| REST القياسي على `Report View Saved View` | — (لا يمر بنا) | DocPerm `Desk User` + pqc + hook (§6) | نفس ما سبق، عدا Administrator بالاسم (قيد معروف) |
| `frappe.desk.desk_page.getpage` لصفحتنا | — | `Page.is_permitted` بأدوار `Desk User` | الضيف ومستخدمو الموقع لا يحمّلون سكربت الصفحة |

المعروف والمقبول (حدود Frappe، لا نعيد تنفيذها؛ `docs/research/risks.md`): تصفية الصفوف تفحص أعمدة Link فقط (`Q:1049`)، ولا فحص عند غياب User Permissions (`Q:934-935`)؛ `validate_filters_permissions` لا يفحص فلاتر `MultiSelectList` إطلاقاً ويثق بـ `fieldtype` القادم من المتصفح (`Q:1131-1160`؛ الحماية الخادمية الوحيدة `filter_defs` لأنواع Link)؛ `run` يتجاهل `user` (`Q:235-244`)؛ Prepared Report يُصفّى وقت التوليد بمستخدم المالك (`Q:274-287`).

---

## 13. أسئلة مفتوحة
0. (قرار لا سؤال) مهمة التصدير في الخلفية (المرحلة 6) تعيد `guard_report` و `guard_export` داخل المهمة بمستخدم الطلب، ولا تثق بفحص وقت الطلب.
1. هل يُقبل شحن خط Noto Naskh Arabic داخل التطبيق (ADR-004)؟
2. `frappe.format(..., {inline: true})` يُفترض أنه يتجاوز غلاف `text-align:right` في `_right` (`formatters.js:11-17`)؛ يُتحقق منه في المرحلة 3 قبل اعتماده.
3. (محسوم بالتجربة) الـ worker ملف ثابت من `node_modules` لا bundle (§8أ.1). يبقى: إثبات التحميل داخل صفحة Desk بمستخدم حقيقي، واختبار Firefox و Safari، وتحذير `Unknown browser detected` الذي يطبعه عميل Perspective في غير Chrome (استثناء موثّق من قاعدة «لا تحذيرات في console» إلى أن يُحل).
4. (محسوم) Administrator وقواعد `has_permission`: الحقائق في §6؛ المرحلة 4 تضيف الاختبارات فقط.
5. `frappe.set_route("query-report", name, {...})` بوسيط ثالث (`fs.js:329`) ومساره المقابل لصفحتنا — يُختبر في المتصفح بعد إصلاح خادم الويب.
6. هل يُسجَّل Access Log للتصدير والطباعة من Report View كما تفعل الأصلية (`QJ:1552-1560`)؟ المقترح: نعم، بـ `frappe.get_doc({"doctype": "Access Log", ...}).insert()` بصلاحيات المستخدم في المرحلة 6.
