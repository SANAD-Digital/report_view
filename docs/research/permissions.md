# طبقات الصلاحيات في تقارير Frappe (المحور ب — المرحلة 1)

- الإصدار المفحوص: frappe `v16.28.0` (فرع `version-16`)، erpnext `v16.29.0`. كل الملفات المذكورة أدناه خالية من تعديلات محلية (`git status --short` عليها فارغ).
- الموقع: `$SITE`. كل التجارب نُفّذت بسكربتات بايثون مباشرة (خادم الويب يعطي 500)، بقراءة فقط، مع `frappe.db.rollback()` في نهاية كل سكربت وبدون أي `commit`.
- السكربتات المؤقتة (غير مُدرجة في المستودع): `/tmp/claude-1001/-home-snd-frappe-bench-apps-report-view/80b6fc89-9d79-4ce6-8bf4-88166e120282/scratchpad/{find_users.py,find_users2.py,run_matrix.py,probe2.py,probe3.py}`.
- المسارات المختصرة: `F/` = `<bench>/apps/frappe/frappe/`، `E/` = `<bench>/apps/erpnext/erpnext/`.

> تنبيه: مصفوفة الاختبار بمستخدمي `rv_admin / rv_accountant / rv_restricted / rv_noexport / rv_none` **ما زالت معلّقة** لأن هؤلاء المستخدمين لم يُنشأوا بعد. ما هو موثّق هنا نُفّذ بمستخدمين موجودين فعلاً على الموقع يمثّلون الحالات نفسها قدر الإمكان (انظر القسم 5).

## 1. ترتيب الفحوص عند استدعاء `frappe.desk.query_report.run`

سلسلة الاستدعاء كما هي في `F/desk/query_report.py`:

| # | الخطوة | الموضع | ما يحدث |
|---|--------|--------|---------|
| 0 | `run()` (whitelisted, `@frappe.read_only()`) | `F/desk/query_report.py:222-244` | يمرر كل شيء إلى `_run()`. المعامل `user` مُهمل ("Kept for backward compatibility") ولا يُمرَّر إلى `_run`، فالمستخدم دائماً `frappe.session.user` (`:259-260`). |
| 1 | `validate_filters_permissions(report_name, filters, user, js_filters)` | `:261` → `:1131-1160` | يفحص صلاحية `read` أو `select` على قيمة كل فلتر من نوع Link **بشرط** أن يكون الفلتر معرّفاً في جدول `Report.filters` أو مُرسلاً من المتصفح في `js_filters`. يُلقي `ValidationError` (عبر `frappe.throw` بلا نوع) وليس `PermissionError`. |
| 2 | `get_report_doc(report_name)` | `:262` → `:24-58` | (أ) `doc.is_permitted()` وإلا `PermissionError` "You don't have access to Report: {0}" (`:43-47`). (ب) `frappe.has_permission(doc.ref_doctype, "report")` وإلا `PermissionError` "You don't have permission to get a report on: {0}" (`:49-53`). (ج) `doc.disabled` → `ValidationError` (`:55-56`). |
| 3 | فحص مكرر لـ `report` على `ref_doctype` | `:263-267` | نفس فحص 2-ب لكن عبر `frappe.msgprint(raise_exception=True)` (يُلقي `ValidationError`). لا يُصل إليه عملياً لأن 2-ب يرمي قبله. |
| 4 | تنفيذ التقرير | `:276-293` | إمّا `get_prepared_report_result` (`:287`) أو `generate_report_result` (`:289`). أي استثناء **داخل** هذا البلوك فقط يُسجَّل بـ `frappe.log_error("Report execution failed for: ...")` ثم يُعاد رفعه (`:291-293`). استثناءات الصلاحيات في الخطوات 1-3 تقع **قبل** `try` فلا تُسجَّل في Error Log من هنا. |
| 5 | تصفية الصفوف بـ User Permissions | `generate_report_result` `:121-122` → `get_filtered_data` `:893-937` | تُطبَّق فقط في مسار `generate_report_result`، أي **ليس** على نتائج Prepared Report المخزّنة (انظر القسم 3.5). |

نفس `get_report_doc` تُستدعى أيضاً من `get_script` (`:180`) ومن `save_report` (`:856`) ومن `get_report_result` للتقارير المخصّصة (`:71`).

## 2. جدول الطبقات (ملخّص)

| الطبقة | أين تحدث (ملف:سطر) | ما الذي تمنعه | كيف نختبرها |
|--------|--------------------|---------------|-------------|
| 1. أدوار التقرير `Report.roles` | `F/core/doctype/report/report.py:140-155` (`is_permitted`)، تُستدعى من `F/desk/query_report.py:43` | فتح التقرير أصلاً (run / get_script / export / save_report) لمن لا يحمل أي دور من `Has Role` للتقرير، أو من `Custom Role` إن وُجد. | `frappe.get_doc("Report", name).is_permitted()` بعد `frappe.set_user(u)` — أو استدعاء `run` وترقّب `PermissionError` بالرسالة "You don't have access to Report". |
| 2. صلاحية `report` على `ref_doctype` | `F/desk/query_report.py:49-53` (و `:263-267` المكرر) → `F/permissions.py:80-224` → `get_role_permissions` `:282-342` | فتح التقرير لمن يحمل دور التقرير لكن دوره ليس له علامة `report` في DocPerm/Custom DocPerm على `ref_doctype` (permlevel 0). | `frappe.has_permission("GL Entry", "report")` بعد `set_user`. |
| 3. User Permissions على الصفوف | `F/desk/query_report.py:893-937` (`get_filtered_data`)، `:940-1013` (`has_match`)، `:1042-1076` (`get_linked_doctypes`)، `:1120-1128` (`get_user_match_filters`) → `F/desk/reportview.py:870-878` → `F/database/query.py:1678-1724` | صفوفاً تحمل في **عمود من نوع `Link`** قيمة خارج User Permission للمستخدم. لا تمنع شيئاً إذا لم يكن للمستخدم أي User Permission، ولا تفحص أعمدة `Data`/`Dynamic Link`. | استدعاء `get_filtered_data(ref_doctype, columns, rows, user)` بصفوف اصطناعية (القسم 6). |
| 3ب. فلاتر Link | `F/desk/query_report.py:1131-1160` | تمرير قيمة فلتر Link لا يملك المستخدم `read`/`select` عليها — فقط إن كان الفلتر في `Report.filters` أو `js_filters`. | `validate_filters_permissions("General Ledger", {"company": X}, user, js_filters=[...])`. |
| 4أ. `can_export` | `F/permissions.py:644-652`؛ يُستدعى في `F/desk/query_report.py:383-386` (`export_query`) | تنزيل CSV/Excel لمن ليس System Manager وليس لدوره `export` على `ref_doctype`. | `frappe.permissions.can_export("GL Entry")` بعد `set_user`، أو `export_query()` مع `frappe.local.form_dict`. |
| 4ب. صلاحية `print` | **عميل فقط**: `F/public/js/frappe/views/reports/query_report.js:1956` و `:1974` (`frappe.model.can_print(ref_doctype)`) ← `F/public/js/frappe/model/model.js:408-410` ← `F/utils/user.py:157-160` (بناء `boot.user.can_print`). الخادم: `F/utils/print_format.py:261-274` (`report_to_pdf`) **بلا أي فحص صلاحية**. | إخفاء زرّي Print/PDF من القائمة فقط. لا يوجد منع خادمي لطباعة التقرير. | `frappe.has_permission("GL Entry", "print")`؛ ومراجعة الكود أعلاه. |
| 5. تقرير بلا `ref_doctype` | `F/core/doctype/report/report.json` (`ref_doctype.reqd = 1`)؛ `is_permitted` لا يعتمد عليه؛ `frappe.has_permission(None, ...)` → `DoesNotExistError` من `frappe.get_meta` (`F/permissions.py:131`). | لا حالة إنتاجية: الحقل إلزامي ولا يوجد تقرير كهذا على الموقع. | القسم 3.6. |
| 6. استدعاء API بمستخدم غير مصرّح | `F/exceptions.py:40-41` (`PermissionError.http_status_code = 403`)؛ `F/app.py:349-418` (`handle_exception`) | يُعاد 403 مع `exc_type: "PermissionError"`. **يُسجَّل في Error Log فقط** إذا `http_status_code >= 500` أو `developer_mode` (`F/app.py:411-412`). | القسم 3.7. |

## 3. تفصيل كل طبقة

### 3.1 أدوار التقرير — `Report.is_permitted`

`F/core/doctype/report/report.py:140-155`:
- يقرأ `Has Role` حيث `parent = self.name` (`:144`). ملاحظة: الاستعلام بلا فلتر `parenttype`.
- إن وُجد `Custom Role` مرتبط بالتقرير (`get_custom_allowed_roles("report", self.name)` في `F/core/doctype/custom_role/custom_role.py:34-41`) فإنه **يستبدل** قائمة الأدوار كلياً (`:146-149`).
- إذا كانت القائمة النهائية فارغة → `True` (تقرير مفتوح لكل من يتجاوز الطبقة 2) (`:151-152`).
- وإلا `has_common(frappe.get_roles(), allowed)` (`:154-155`). يعتمد على `frappe.get_roles()` بلا معامل أي على مستخدم الجلسة. لاحظ أن الدالة تعيد `None` (لا `False`) عند الرفض؛ `get_report_doc` تفحص بـ `not`.
- على الموقع: `General Ledger` لديه `Custom Role` باسم `3bau15v6mt` بالأدوار `Accounts Manager, Accounts User, Auditor` (مطابقة لما في `general_ledger.json`)، بينما `Trial Balance` و`Accounts Receivable` يعتمدان على `Has Role` من ملف الـ JSON القياسي.
- عند إنشاء تقرير غير قياسي بلا أدوار، تُنسخ أدوار `ref_doctype` (permlevel 0) تلقائياً في `before_insert` (`:90-91`، `:133-138`).

### 3.2 صلاحية `report` على `ref_doctype`

- تُفحص مرتين لكل `run`: `F/desk/query_report.py:49` (تُلقي `PermissionError`) و `:263` (لا يُصل إليها). وتُفحص كذلك ضمن `get_script` و`save_report` لأنهما يمرّان بـ `get_report_doc`.
- `frappe.has_permission` (`F/__init__.py:600-645`) → `frappe.permissions.has_permission` (`F/permissions.py:80-224`). بلا `doc`، الفحص يُختصر إلى `get_role_permissions(meta, user).get("report")` (`:161-167`) ثم fallback للمشاركة `false_if_not_shared` (`:177-209`) — لكن `report` ليست ضمن `share_rights` (`:178`) فالمشاركة لا تمنح `report`.
- `Administrator` يتجاوز كل شيء (`:107-109`).
- `get_role_permissions` (`:282-342`) تجمع DocPerm/Custom DocPerm عند permlevel 0 لأدوار المستخدم (`:314-320`)؛ إذا كان كل الصلاحيات من نوع `if_owner` تُنقل إلى `perms["if_owner"][ptype]` وتُصفَّر (`:328-338`)، وهذا ما يقرأه `get_filtered_data` في `:903`.
- على الموقع (Custom DocPerm على `GL Entry`, permlevel 0): `Accounts User` و`Accounts Manager`: read/report/export/print = 1؛ `Auditor`: read/report/export = 1 و **print = 0**. على `Sales Invoice`: `Accounts Manager` و`Accounts User`: read/report/print = 1 و **export = 0**.

### 3.3 User Permissions على صفوف النتيجة — `get_filtered_data` / `has_match`

الخوارزمية (`F/desk/query_report.py:893-937`):
1. `linked_doctypes = get_linked_doctypes(columns, data)` (`:1042-1076`): يجمع **الأعمدة التي `fieldtype == "Link"` فقط** ويربط `options` → (فهرس العمود إذا كانت الصفوف قوائم، أو `fieldname` إذا كانت dicts) (`:1049-1054`). ثم يحذف كل doctype عموده فارغ في كل الصفوف (`:1057-1074`). إذا وُجد عمودا Link لنفس الـ doctype يبقى الأخير فقط لأن المفتاح هو اسم الـ doctype.
2. `match_filters_per_doctype = get_user_match_filters(linked_doctypes, user)` (`:1120-1128`): لكل doctype مرتبط يستدعي `frappe.desk.reportview.build_match_conditions(dt, user, False)` (`F/desk/reportview.py:870-878`) → `Engine.build_match_conditions(as_condition=False)` (`F/database/query.py:1687-1722`) الذي يعيد، لكل حقل Link في **ذلك الـ doctype** (بما فيه `name` الخاص به)، قائمة القيم المسموحة من `frappe.permissions.get_user_permissions(user)` (`F/permissions.py:345-348` → `F/core/doctype/user_permission/user_permission.py:88-147`)، مع احترام `applicable_for` و`ignore_user_permissions` (`:1695-1714`). لا تُطبَّق هنا hooks `permission_query_conditions` (تلك تُبنى فقط في مسار `as_condition=True`، `:1680-1685`).
3. إذا كانت `match_filters_per_doctype` فارغة (لا User Permission للمستخدم تمسّ أياً من الـ doctypes المرتبطة) → **تُعاد كل الصفوف بلا فحص** (`:934-935`). أي أن هذه الطبقة لا تفحص أدوار القراءة إطلاقاً في هذه الحالة (تجربة `ai-iso-a` في القسم 6 أعادت كل الصفوف رغم أن المستخدم بلا أي دور محاسبي).
4. وإلا لكل صف: يُقبل إن كانت قيمة عمود `ref_doctype` ضمن المستندات المشارَكة (`:917-922`)، أو إن نجح `has_match` (`:924-933`).
5. `has_match` (`:940-1013`): الصف الفارغ يُقبل (`:962-964`). لكل doctype له match filters: مطابقة المالك إن كان `if_owner` (`:969-973`، تعتمد على عمود Link إلى `User` باسم `owner`)، ثم لكل مجموعة فلاتر ولكل عمود Link في التقرير: يُرفض الصف إذا كان `dt in match_filters` و**القيمة ليست في المسموح** و**المستند موجود فعلاً** (`frappe.db.exists(dt, cell_value)`, `:989-995`) — أي القيم الفارغة أو غير الموجودة تمرّ. ثم شرط إضافي: `has_unrestricted_read_access(ref_doctype, frappe.session.user)` (`:997-998`، `:1016-1039`) — يشترط وجود DocPerm/Custom DocPerm بـ `read=1, if_owner=0` لأحد أدوار **مستخدم الجلسة** (لا المعامل `user`).
6. الحقول المقنّعة (`get_masked_fields`) تُقنَّع هنا أيضاً (`:905-912`).

ما يُفحص وما لا يُفحص (مؤكَّد بالتجربة في القسم 6):

| نوع العمود | يُفحص؟ | الدليل |
|-----------|--------|--------|
| `Link` إلى doctype عليه User Permission (مثل `Company`) وقيمة موجودة | نعم | صف `company = "SND Accounting"` حُذف لمستخدم مقيّد على `SND Accounting 2`. |
| `Link` بقيمة فارغة | لا (يمرّ) | صف `company = ""` بقي. |
| `Link` بقيمة غير موجودة كمستند | لا (يمرّ) | صف `company = "NOT-A-COMPANY"` بقي بسبب `frappe.db.exists` في `:992`. |
| `Data` يحمل اسم الشركة نصاً | لا | عمود `company_text` لم يُفحص. |
| `Dynamic Link` (مثل `party` في Accounts Receivable) | لا | `get_linked_doctypes` يقبل `fieldtype == "Link"` فقط (`:1049`). صفّ العميل غير المسموح بقي عندما كان العمود Dynamic Link فقط، وحُذف عندما وُجد عمود `Link/Customer`. |
| أعمدة كسلاسل نصية `"Company:Link/Company:120"` وصفوف كقوائم | نعم | `get_column_as_dict` (`:1094-1117`) تفكّكها؛ الصفوف القوائم تُفحص بالفهرس (`:986-987`). |
| صف فارغ `{}` أو `[]` | يمرّ دائماً | `:962-964`. |
| Link إلى doctype لا User Permission عليه | لا | لا يدخل في `match_filters`. |

حدود هذه الطبقة مع Script Report التي تبني SQL بنفسها:
- الطبقة تعمل **بعد** التنفيذ على النتيجة فقط، فلا تمنع القراءة من قاعدة البيانات ولا تؤثر على الإجماليات المحسوبة داخل التقرير (مثل صفوف Opening/Closing/Total في General Ledger، أو `report_summary`/`chart`).
- إذا لم يُخرج التقرير عمود `Link` للـ doctype المقيّد (مثلاً GL لا يُخرج عمود `company`)، فلا تصفية أصلاً من Frappe؛ ما رأيناه من تقييد فعلي لمستخدم `user1@example.com` جاء من **ERPNext نفسه**:
  - `E/accounts/report/general_ledger/general_ledger.py:333-336` تستدعي `frappe.desk.reportview.build_match_conditions("GL Entry")` وتضيف الشرط إلى SQL (`where company=%(company)s {get_conditions(filters)}`, `:196-213`). الشرط الناتج للمستخدم المذكور: `IFNULL(\`tabGL Entry\`.\`company\`,'')='' OR \`tabGL Entry\`.\`company\` IN ('SND Accounting 2')` (لأن `apply_strict_user_permissions = 0` على الموقع).
  - `E/accounts/report/financial_statements.py:570-573` (يخدم Trial Balance عبر `set_gl_entries_by_account`) بنفس الأسلوب.
  - `E/accounts/report/accounts_receivable/accounts_receivable.py:883-884` عبر `build_qb_match_conditions("Payment Ledger Entry")` (`E/accounts/utils.py:2676-2703`)، و`add_user_permission_filters` (`:937-953`) لتقييد `party` يدوياً لأنه Dynamic Link.
  - أي تقرير Script/Query لا يفعل ذلك بنفسه يقرأ كل البيانات ثم تُصفّى الصفوف فقط وفق الجدول أعلاه. هذا خارج سيطرة `report_view` ويجب أن يُعامل كسلوك Frappe الأصلي (شرط CLAUDE.md: المرور عبر `query_report.run` دون إعادة تنفيذ الصلاحيات).

### 3.4 فلاتر Link — `validate_filters_permissions`

`F/desk/query_report.py:1131-1160`: تفحص فقط الفلاتر المعرّفة في `report.filters` (جدول `Report Filter` — فارغ للتقارير الثلاثة على الموقع) أو المرسلة في `js_filters` (يرسلها `query_report.js` من تعريف الفلاتر في ملف JS). النتيجة: عند استدعاء `run` من API **بدون** `js_filters` لا يوجد أي فحص على قيمة `company`؛ مع `js_filters` يُلقى `ValidationError` "You do not have permission to access Company: SND Accounting." (مثبت في القسم 6). على `report_view` أن يمرر `js_filters` لتبقى هذه الطبقة فعّالة كما في الواجهة الأصلية.

### 3.5 Prepared Report

`_run` (`:274-287`): إذا كان `report.prepared_report` مفعّلاً ولم يُمرَّر `ignore_prepared_report` ولا `custom_columns`، تُقرأ النتيجة من ملف `Prepared Report` (`:336-370`) **دون** المرور بـ `generate_report_result` وبالتالي دون `get_filtered_data` عند القراءة. التصفية حدثت وقت التوليد في الخلفية بمستخدم `instance.owner` (`F/core/doctype/prepared_report/prepared_report.py:127`)، و`get_completed_prepared_report` يبحث بـ `owner = user` (`:249-258`)، وعند تمرير `prepared_report_name` يُفحص `read` على مستند Prepared Report (`:282-284`). التقارير الثلاثة على الموقع `prepared_report = 0`.

### 3.6 التقارير بلا `ref_doctype`

- `F/core/doctype/report/report.json`: `ref_doctype` بـ `reqd: 1`، فلا يمكن حفظ تقرير بدونه عبر المسار الطبيعي. الاستعلام `select name from tabReport where ifnull(ref_doctype,'')=''` على الموقع أعاد صفراً.
- سلوك الكود لو وُجد (تجربة على مستند في الذاكرة بلا إدراج):
  - `is_permitted()` لا يستخدم `ref_doctype` إطلاقاً. بمستند في الذاكرة (`name = None`) أعادت `None` (رُفض)، وبعد ضبط `doc.name = "zz_no_ref"` أعادت `True` (تقرير بلا أدوار = مفتوح، `:151-152`). سبب الفرق (`probe3.py`): `get_custom_allowed_roles("report", None)` (`F/core/doctype/custom_role/custom_role.py:36`) تنفّذ `frappe.db.get_value("Custom Role", {"report": None})` التي تطابق `report IS NULL` فتعيد الـ Custom Role الخاص بصفحة (`eti4lt2fc2`, أدوارها `System Manager, WhatsApp Manager, WhatsApp Group Viewer`) فتُستبدل قائمة الأدوار بها (`report.py:146-149`). أي أن `is_permitted` على مستند بلا اسم يعطي نتيجة مضلِّلة، لكنها حالة غير إنتاجية.
  - `frappe.has_permission(None, "report")` و`frappe.has_permission("", "report")` → `DoesNotExistError: DocType None not found` (من `frappe.get_meta` في `F/permissions.py:131`).
  - `get_filtered_data(None, ...)` و`get_filtered_data("", ...)` → `DoesNotExistError` من `frappe.get_meta(ref_doctype)` (`:900`) — بل قبله من `frappe.share.get_shared` (`:897`)؛ في كل الأحوال يفشل.
  - `frappe.permissions.can_export(None)` → `AttributeError: 'NoneType' object has no attribute 'name'` (`:648`).
  - أي أن `run` لتقرير كهذا ينتهي بخطأ 500 لا بمنع نظيف.

### 3.7 استدعاء `run` مباشرة عبر API بمستخدم غير مصرّح

- الاستثناء: `frappe.exceptions.PermissionError` مع `http_status_code = 403` (`F/exceptions.py:40-41`)، الرسالة في `frappe.message_log`: "You don't have access to Report: General Ledger" (من `:44-47`). (وإن كان محروماً من الطبقة 2 فقط: "You don't have permission to get a report on: GL Entry"، `:50-53`.)
- على مستوى HTTP: `F/app.py:349-418` — للطلبات `/api/` أو AJAX يُبنى الردّ بـ `frappe.utils.response.report_error(403)` (`F/utils/response.py:39-64`) ويُضاف `exc_type`؛ traceback يُرسل فقط إذا `is_traceback_allowed()`.
- التسجيل: `log_error_snapshot(e)` يُستدعى فقط إذا `http_status_code >= 500 or frappe.conf.developer_mode` (`F/app.py:411-412`). على هذا الموقع `developer_mode = 1` فسيُسجَّل في Error Log (بـ `defer_insert=True`, `F/utils/error.py:168-175`). في الإنتاج (بدون developer_mode) **لا يُسجَّل** رفض الصلاحية في Error Log. لا يوجد تسجيل في Access Log للرفض.
- تحقق فعلي: بمستخدم `ai-iso-a@example.com` (Desk User + Projects User فقط) أعاد `run("General Ledger", ...)` الاستثناء `frappe.exceptions.PermissionError` بـ `http_status_code=403` والرسالة أعلاه. لم يُتحقق من الرد HTTP الفعلي لأن خادم الويب معطّل (سؤال مفتوح).

### 3.8 الفرق مع `frappe.desk.reportview`

`F/desk/reportview.py:27-35` (`get`) → `execute` (`:99-100`) → `DatabaseQuery(doctype).execute` (`F/model/db_query.py:106-...`) وهو المسار الذي يستخدمه Report Builder وList View. هناك الصلاحيات تُترجم إلى **شروط SQL قبل التنفيذ** (`build_match_conditions` `F/model/db_query.py:1025-1090` مع `permission_query_conditions` hooks `:1157`)، وترمي `PermissionError` إن لم يكن هناك `read`/`select` (`:1047`). أمّا `query_report.run` فيُنفّذ كود التقرير كما هو ثم يصفّي الصفوف بعدياً. `report_view` معنيّ فقط بـ `query_report.run`.

### 3.9 التصدير والطباعة

- **التصدير**: `export_query` (`F/desk/query_report.py:373-407`) يقرأ `form_dict` ويستدعي `frappe.permissions.can_export(ref_doctype, raise_exception=True)` في `:383-386` قبل أي شيء (لو غاب `report_name` يفشل بـ `AttributeError` من `:648` لأن `get_cached_value` تعيد `None`). ثم `_export_query` (`:419-514`) تستدعي `run(...)` (`:434-439`) فتتكرر الطبقات 1-3 وتصفية الصفوف. `can_export` (`F/permissions.py:644-652`): `System Manager` دائماً `True`؛ وإلا `export` أو `if_owner.export` من `get_role_permissions`. التصدير في الخلفية (`:388-405`) يرسل الملف بالبريد بنفس الفحص المسبق. لا يُنشئ الخادم Access Log للتصدير؛ المتصفح هو من يستدعي `make_access_log` قبل الطلب (`query_report.js:1805`, `:1552-1560`).
- **الطباعة**: لا يوجد مسار خادمي خاص بطباعة التقرير. القائمة تُخفي Print/PDF عبر `frappe.model.can_print(this.report_doc.ref_doctype)` (`query_report.js:1956`, `:1974`) المعتمد على `frappe.boot.user.can_print` (`model.js:408-410`) المبني من DocPerm بعلامة `print` (`F/utils/user.py:155-160`). الطباعة الفعلية: `print_report` (`query_report.js:1576-1599`) → `frappe.render_grid` (`F/public/js/frappe/microtemplate.js:121`) في المتصفح؛ وPDF: `pdf_report` (`:1601-1654`) → `frappe.render_pdf` (`microtemplate.js:199`) → `POST /api/method/frappe.utils.print_format.report_to_pdf` (`F/utils/print_format.py:261-274`) الذي يحوّل HTML مرسلاً من المتصفح إلى PDF بلا فحص صلاحية سوى كونه whitelisted لمستخدم مسجّل، ويسجّل Access Log بنوع PDF. `F/www/printview.py` (`:393-403`) يفحص `print` على **مستند** وليس على تقرير، ولا يُستخدم لطباعة التقارير. **الخلاصة**: فحص `print` للتقارير في هذا الإصدار عميلي فقط؛ على `report_view` أن يفحص `frappe.has_permission(ref_doctype, "print")` خادمياً بنفسه عند أي endpoint طباعة كما يشترط CLAUDE.md.

## 4. أعمدة الربط الفعلية للتقارير الثلاثة (ما يمكن أن تصفّيه الطبقة 3)

لم تُستخرج قوائم الأعمدة حرفياً في هذا المحور (سؤال مفتوح)، لكن ما ظهر من النتائج: `General Ledger` أعاد 17 عموداً، `Trial Balance` 10، `Accounts Receivable` 25. `party` في AR هو `Dynamic Link` فلا تصفّيه الطبقة 3، وERPNext يعوّض ذلك في `add_user_permission_filters`.

## 5. التحقق العملي — المستخدمون الحقيقيون على الموقع

بيانات الموقع وقت التجربة: 5 شركات، كل قيود `GL Entry` (614) في شركة `SND Accounting`، سنة مالية واحدة `2026`، `apply_strict_user_permissions = 0`، `developer_mode = 1`.

المستخدمون المختارون وأدوارهم ذات الصلة:

| المستخدم | الحالة الممثَّلة | الأدوار المحاسبية | User Permission |
|----------|-----------------|-------------------|-----------------|
| `Administrator` | rv_admin | System Manager (+ Auditor) | لا |
| `ai-bench@example.com` | rv_admin (غير Administrator) | System Manager, Accounts Manager, Accounts User, Auditor | Party Type=Supplier (applicable_for Party Balance Certificate) |
| `user4@example.com` | rv_accountant + تقييد على Customer | Accounts Manager, Accounts User, Auditor | Customer=`albashq` (عام)، Warehouse=`مخازن - SA`، Party Type ×4 (applicable_for Party Balance Certificate) |
| `user2@example.com` | rv_accountant الأدنى (Accounts User فقط) | Accounts User | لا |
| `user1@example.com` | rv_restricted (Company) | Accounts Manager, Accounts User, Auditor | **Company=`SND Accounting 2`** (عام)، Warehouse/Currency (applicable_for Sales Invoice)، Party Type (applicable_for Account) |
| `ai-iso-a@example.com` | rv_none (حساب **معطّل** لكن `set_user` لا يتحقق من ذلك) | لا (Desk User, Projects User) | لا |
| `user3@example.com` | rv_none (Website User بلا أدوار) | لا | لا |
| `Guest` | زائر | Guest | لا |

لا يوجد على الموقع مستخدم يمثّل `rv_noexport` على `GL Entry` (كل الأدوار المحاسبية لها `export=1` هناك)؛ لكن `Sales Invoice` على الموقع `export=0` لكل الأدوار المحاسبية، فـ `user4@example.com` و`user2@example.com` و`user1@example.com` يمثّلون rv_noexport لتقرير Accounts Receivable.

الفلاتر المستخدمة (`company = "SND Accounting"` ما لم يُذكر غيره):
- Trial Balance: `fiscal_year=2026, from_date=2026-01-01, to_date=2026-12-31, with_period_closing_entry_for_opening=1, with_period_closing_entry_for_current_period=1, include_default_book_entries=1, show_net_values=1, show_group_accounts=1`
- General Ledger: `from_date=2026-01-01, to_date=2026-09-30, categorize_by="Categorize by Voucher (Consolidated)", include_dimensions=1, include_default_book_entries=1`
- Accounts Receivable: `report_date=2026-09-30, ageing_based_on="Due Date", calculate_ageing_with="Report Date", range="30, 60, 90, 120"`
- بدون `js_filters` (أي كما يستدعيها عميل API خام، لا المتصفح).

النتائج كما ظهرت (`run_matrix.py`):

| المستخدم | `has_permission(GL Entry, report)` | `has_permission(GL Entry, print)` | `can_export(GL Entry)` | `has_permission(Sales Invoice, report)` | `can_export(Sales Invoice)` | `is_permitted` TB/GL/AR | Trial Balance | General Ledger | Accounts Receivable |
|---|---|---|---|---|---|---|---|---|---|
| Administrator | True | True | True | True | True | T/T/T | OK, 32 صفاً، 10 أعمدة | OK, 523 صفاً، 17 عموداً | OK, 196 صفاً، 25 عموداً |
| ai-bench@example.com | True | True | True | True | True | T/T/T | OK, 32 | OK, 523 | OK, 196 |
| user4@example.com | True | True | True | True | **False** | T/T/T | OK, 32 | OK, 523 | **OK, 4** (تقييد Customer=albashq عبر ERPNext `add_user_permission_filters`) |
| user2@example.com | True | True | True | True | **False** | T/T/T | OK, 32 | OK, 523 | OK, 196 |
| user1@example.com | True | True | True | True | **False** | T/T/T | **OK, 1** (صف الإجمالي فقط) | **OK, 3** (Opening/Closing/Total فقط) | **OK, 0** |
| user1@example.com بـ `company = SND Accounting 2` | — | — | — | — | — | — | OK, 1 | OK, 3 | OK, 0 |
| ai-iso-a@example.com (معطّل) | False | False | False | False | False | F/F/F | `PermissionError: You don't have access to Report: Trial Balance` | `PermissionError: ... General Ledger` | `PermissionError: ... Accounts Receivable` |
| user3@example.com | False | False | False | False | False | F/F/F | `PermissionError` (نفس الرسالة) | `PermissionError` | `PermissionError` |
| Guest | False | False | False | False | False | F/F/F | `PermissionError` | `PermissionError` | `PermissionError` |

ملاحظات على النتائج:
- `user1@example.com` مع `company = "SND Accounting"` (التي لا يملك عليها User Permission) **لم يُرفض** من `run` لأن الفلاتر لم تُمرَّر عبر `js_filters` وجدول `Report.filters` فارغ (الطبقة 3ب لم تعمل)؛ لكنّ SQL الخاص بـ ERPNext قيّد الصفوف إلى شركته فجاءت النتائج شبه فارغة. عند تكرار الاستدعاء مع `js_filters=[{"fieldname":"company","fieldtype":"Link","options":"Company"}]` رُفض بـ `ValidationError: You do not have permission to access Company: SND Accounting.` (`probe2.py`).
- عدد Error Log قبل/بعد التجربة ثابت (1461) — لم يُسجَّل أي رفض صلاحية عبر `query_report._run` لأنها تقع قبل `try` (`:276`).
- تصدير (`export_query` مع `form_dict`): `ai-iso-a` → `PermissionError: You are not allowed to export GL Entry doctype` (من `can_export` قبل الوصول إلى فحص أدوار التقرير)؛ `user4@example.com` لتقرير AR → `PermissionError: You are not allowed to export Sales Invoice doctype`؛ `user2@example.com` لتقرير GL → نجح (`response.type = binary`, `General Ledger.csv`, 83,064 بايت).
- **مصفوفة rv_* الخمسة معلّقة** حتى إنشاء المستخدمين (سكربت `dev` المذكور في phase-0).

## 6. تجارب `get_filtered_data` بصفوف اصطناعية (`probe2.py`)

مستخدم الجلسة والمعامل `user` = `user1@example.com` (Company = `SND Accounting 2`)، `ref_doctype = "GL Entry"`:

| الأعمدة | الصفوف (قيمة `company` → `debit`) | الناتج (قيم `debit` المتبقية) |
|---------|-----------------------------------|-------------------------------|
| `company:Link/Company`, `account:Link/Account`, `company_text:Data`, `debit` | SND Accounting→1، SND Accounting 2→2، ""→3، NOT-A-COMPANY→4، `{}`→None | `[2, 3, 4, None]` |
| نفسها بدون عمود `company` (Link) — يبقى `company_text` (Data) | نفسها | `[1, 2, 3, 4, None]` (لا تصفية) |
| أعمدة نصية `"Company:Link/Company:120"`, `"Debit:Currency:100"` وصفوف قوائم | `["SND Accounting",1]`, `["SND Accounting 2",2]`, `["",3]`, `[]` | `[["SND Accounting 2", 2], ["", 3], []]` |
| `company:Link/Company`, `debit` فقط | نفسها | `[2, 3, 4, None]` |
| نفسها لكن `user = "ai-iso-a@example.com"` (بلا User Permissions، والجلسة ما زالت user1) | نفسها | `[1, 2, 3, 4, None]` (لا تصفية إطلاقاً رغم غياب أي دور قراءة) |

`get_user_match_filters(["GL Entry","Account","Company","Customer"], "user1@example.com")` → `{'GL Entry': [{'Company': ['SND Accounting 2']}], 'Account': [{'Company': ['SND Accounting 2'], 'Party Type': ['Creditor']}], 'Company': [{'Company': ['SND Accounting 2']}]}` (لا مفتاح `Customer`).

مستخدم `user4@example.com` (Customer = `albashq`)، `ref_doctype = "Sales Invoice"`:

| الأعمدة | الناتج |
|---------|--------|
| `customer:Link/Customer` + `party:Dynamic Link` + `party_type:Link/DocType` + `amt` | `[1]` (صف العميل الآخر حُذف) |
| `party:Dynamic Link` + `party_type` + `amt` فقط | `[1, 2]` (لا تصفية) |

## 7. ما يعنيه هذا لـ `report_view` (بلا قرار تصميمي هنا)

- المرور عبر `frappe.desk.query_report.run` يضمن الطبقات 1، 2، 3، 3ب — لكن 3ب تعمل فقط إذا مرّرنا `js_filters` كما يفعل `query_report.js`.
- `run` يتجاهل معامل `user` (`:227`, `:235-244`)؛ لا سبيل لتشغيله نيابة عن مستخدم آخر بدون `set_user` الممنوع.
- التصدير يجب أن يستدعي `frappe.permissions.can_export(ref_doctype, raise_exception=True)` (نفس ما يفعله `export_query:383`) لأن `run` وحدها لا تفحص `export`.
- الطباعة بلا فحص خادمي في Frappe؛ فحص `frappe.has_permission(ref_doctype, "print")` يجب أن يُضاف في أي endpoint طباعة خاص بنا. لاحظ أن `Auditor` على الموقع له `report=1` و`print=0` على `GL Entry` — حالة اختبار جاهزة.
- الإجماليات: `add_total_row` (`:124-127`) يُحسب **بعد** `get_filtered_data`، أي على الصفوف المصفّاة؛ بينما إجماليات ERPNext الداخلية (Opening/Closing) تُحسب داخل التقرير قبل التصفية.

## 8. أسئلة مفتوحة

1. (حُلّ) سلوك `is_permitted()` على مستند بلا اسم موثّق في 3.6. يبقى سؤال جانبي: `Report.is_permitted` تقرأ `Has Role` بفلتر `parent` فقط دون `parenttype` (`report.py:144`)؛ لم يُتحقق مما إذا كان تطابق أسماء بين Report وUser/Custom Role يمكن أن يُدخل أدواراً غريبة.
2. الرد HTTP الفعلي (403 + `exc_type`) لم يُختبر لأن خادم الويب يعطي 500؛ الاستنتاج من `F/app.py:349-418` و`F/utils/response.py:39-64` فقط. وكذلك لم يُتحقق فعلياً من إدراج Error Log عبر `log_error_snapshot` في developer_mode.
3. لم تُستخرج قوائم الأعمدة (`fieldtype`/`options`) الفعلية للتقارير الثلاثة لتحديد أي أعمدة Link يمكن أن تصفّيها الطبقة 3 في كل تقرير؛ يلزم ذلك لتوقّع الفرق بين تصفية ERPNext الداخلية وتصفية Frappe البعدية.
4. سلوك `get_linked_doctypes` عند وجود عمودَي Link لنفس الـ doctype (يُحتفظ بالأخير فقط، `:1051`/`:1054`) لم يُختبر عملياً.
5. `has_unrestricted_read_access` تستخدم `frappe.session.user` لا المعامل `user` (`:998`)؛ الأثر عملياً معدوم في `run` (كلاهما نفس المستخدم) لكنه يهم أي استدعاء لـ `generate_report_result(report, filters, user=...)` من الخلفية (Prepared Report يمرر `instance.owner` بينما الجلسة قد تكون مستخدم الطابور). لم يُختبر.
6. هل تسجّل `frappe.utils.print_format.report_to_pdf` أو `frappe.core.doctype.access_log.access_log.make_access_log` شيئاً عند الرفض؟ لا رفض فيهما أصلاً؛ السؤال هو ما إذا كان مطلوباً من `report_view` تسجيل Access Log للطباعة/التصدير بنفسه (المتصفح الأصلي يفعل ذلك من JS).
7. مصفوفة `rv_admin / rv_accountant / rv_restricted / rv_noexport / rv_none` لم تُنفَّذ (المستخدمون غير موجودين). يجب إعادة تشغيل `run_matrix.py` بهم بعد إنشائهم، مع إضافة حالة `js_filters` وحالة `Auditor` (print=0).
