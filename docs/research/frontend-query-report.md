# واجهة صفحة `query-report` في Frappe — توثيق من الكود المثبَّت

**المحور ج من المرحلة 1 — مشروع report_view.**

| البند | القيمة |
|---|---|
| bench | `/home/snd/frappe-bench` |
| frappe | 16.28.0، فرع `version-16`، commit `be4728af84` |
| erpnext | 16.29.0، commit `a5de60c357` |
| frappe-datatable | 1.20.5 (`apps/frappe/node_modules/frappe-datatable/package.json`) |
| موقع التحقق | `acc.dev.sanad.digital` (استعلامات قراءة فقط عبر `bench console`؛ السكربت في `/tmp/claude-1001/.../scratchpad/verify.py`، ولم يُحفظ في المستودع) |

كل رقم سطر أدناه يخص الملفات كما هي مثبَّتة في هذا الـ bench. اختصارات المسارات:

| الاختصار | المسار |
|---|---|
| `JS` | `apps/frappe/frappe/public/js/frappe/views/reports/query_report.js` (2433 سطراً) |
| `RU` | `apps/frappe/frappe/public/js/frappe/views/reports/report_utils.js` |
| `BL` | `apps/frappe/frappe/public/js/frappe/list/base_list.js` |
| `F` | `apps/frappe/frappe/public/js/frappe/form/formatters.js` |
| `NF` | `apps/frappe/frappe/public/js/frappe/utils/number_format.js` |
| `U` | `apps/frappe/frappe/public/js/frappe/utils/utils.js` |
| `R` | `apps/frappe/frappe/public/js/frappe/router.js` |
| `PG` | `apps/frappe/frappe/public/js/frappe/ui/page.js` |
| `MT` | `apps/frappe/frappe/public/js/frappe/microtemplate.js` |
| `PU` | `apps/frappe/frappe/public/js/frappe/form/print_utils.js` |
| `Q` | `apps/frappe/frappe/desk/query_report.py` |
| `DT` | `apps/frappe/node_modules/frappe-datatable/src/` |

ملاحظة تسمية مهمة: في Frappe يوجد ملفان مختلفان تماماً:
- `query_report.js` (`JS`): صفحة `/desk/query-report/<Report Name>` لتقارير Script/Query/Custom. **هذا موضوع الملف.**
- `report_view.js` (`apps/frappe/frappe/public/js/frappe/views/reports/report_view.js`): «Report View» الخاص بالـ Report Builder على مسار `/desk/<doctype>/view/report`، ويرث `frappe.views.ListView`. يُذكر هنا فقط عند المقارنة (User Settings و Pick Columns).

---

## 1. تحميل الصفحة وسكربت التقرير

### 1.1 من الرابط إلى الصفحة

- البادئة الفعلية لمسارات المكتب في هذا الإصدار هي `/desk/` وليس `/app/`: `R:104-112` (`is_app_route` يقبل `desk` فقط)، و `R:514-522` (`strip_prefix` يزيل `desk/`). الروابط القديمة `/app/...` تُعاد توجيهها على الخادم عبر `website_redirects` في `apps/frappe/frappe/hooks.py:68-72` (`/app/(.*)` → `/desk/\1` مع تمرير query string).
- `frappe.router.route()` (`R:131-153`) يحلّل المسار ثم `render()` (`R:292-299`) ثم `render_page()` (`R:301-322`):
  - إذا كان للمسار جزء ثانٍ وكانت هناك `frappe.views[<TitleCase(route[0])> + "Factory"]` تُستخدم الـ Factory (`R:306-314`). `to_title_case("query-report")` = `QueryReport` (`U:281-289`) ولا توجد `frappe.views.QueryReportFactory`، لذلك يسقط إلى الفرع الثاني.
  - الفرع الثاني: `frappe.views.pageview.show("query-report")` (`R:316-321`).
- `frappe.views.pageview.with_page` (`apps/frappe/frappe/public/js/frappe/views/pageview.js:8-15`) يفحص `frappe.standard_pages[name]` أولاً، وإن وُجدت يستدعيها مرة واحدة إذا لم تكن `frappe.pages[name]` موجودة، ثم `frappe.container.change_to(name)` (`pageview.js:61`).
- `frappe.standard_pages["query-report"]` معرّفة في `JS:12-28`: تُنشئ الحاوية بـ `frappe.container.add_page("query-report")` (`JS:13`)، ثم `frappe.ui.make_app_page({parent, title: __("Query Report"), single_column: true})` (`JS:15-19`)، ثم كائناً واحداً `frappe.query_report = new frappe.views.QueryReport({parent: wrapper})` (`JS:21-23`)، وتربط حدث `show` على الحاوية بـ `frappe.query_report.show()` (`JS:25-27`). حدث `show` يُطلقه `frappe.container.change_to` (`apps/frappe/frappe/public/js/frappe/views/container.js:81`).
- النتيجة: صفحة واحدة مشتركة لكل التقارير؛ الانتقال بين تقريرين لا يُنشئ كائناً جديداً بل يعيد `load()`.

### 1.2 دورة `show → init → load`

- `frappe.views.QueryReport extends frappe.views.BaseList` (`JS:30`). لكنها تُعيد تعريف `show()` (`JS:31-33`) و `init()` (`JS:35-49`) فلا تمر بمسار `BaseList.show` (`BL:9-20`) ولا بـ `fetch_meta`/`check_permissions`.
- `init()` يشغّل بالتسلسل: `setup_defaults` (`JS:51-63`)، `setup_page` (موروثة `BL:171-178`: تأخذ `this.page = this.parent.page`، وتستدعي `setup_page_head` → `set_breadcrumbs`/`set_title`/`set_menu_items` `BL:180-184`)، `setup_report_wrapper` (`JS:2247-2267`: تبني `$status`، `$report_message`، `$summary`، `$chart`، `$loading`، `$report`، `$message`)، `setup_events` (`JS:114-137`: تستمع لـ `frappe.realtime.on("report_generated")` وتربط `[data-action]` بأسماء دوال في الكائن).
- `setup_defaults` يلفّ `refresh` بـ `frappe.utils.throttle(this.refresh, 300)` (`JS:59`).
- `load()` (`JS:139-160`): إذا كان اسم التقرير في المسار مختلفاً عن `this.report_name` → `load_report(route_options)`؛ وإن كان نفس التقرير مع وجود `frappe.route_options` → `refresh_report(route_options)`؛ وإلا لا يفعل شيئاً «للحفاظ على حالة الفلاتر وعرض الأعمدة» (`JS:155-159`).
- `load_report` (`JS:162-183`) يمسح الشريط الداخلي `page.clear_inner_toolbar()`، ويضبط `report_name = route[1]`، ويبني `menu_items = get_menu_items()`، ويصفّر `datatable`، ثم بالتسلسل: `get_report_doc` → `get_report_settings` → `add_translate_data_checkbox` → `setup_progress_bar` → `setup_page_head` → `refresh_report(route_options)` → `add_chart_buttons_to_toolbar(true)` → `add_card_button_to_toolbar(true)`.

### 1.3 `get_report_doc` و `get_script`

- `get_report_doc` (`JS:414-421`): `frappe.model.with_doc("Report", name)` (يستدعي `frappe.desk.form.load.getdoc` — `apps/frappe/frappe/public/js/frappe/model/model.js:276` — الذي ينفّذ `doc.check_permission("read")` في `apps/frappe/frappe/desk/form/load.py:40`)، ثم `frappe.model.with_doctype(report_doc.ref_doctype)` لتحميل meta الـ DocType المرجعي (يلزم لاحقاً لـ `masked_fields` و `can_print`/`can_export`).
- `get_report_settings` (`JS:423-454`):
  1. إن كان `frappe.query_reports[report_name]` موجوداً مسبقاً (سكربت سبق تحميله، أو عرّفه bundle) يُستخدم مباشرة **ولا يُستدعى الخادم** (`JS:425-427`).
  2. وإلا `frappe.xcall("frappe.desk.query_report.get_script", {report_name})` (`JS:429-432`).
  3. الرد يُنفَّذ بـ `frappe.dom.eval(settings.script)` (`JS:434`)، وهي `new Function(txt)()` (`apps/frappe/frappe/public/js/frappe/dom.js:28-31`) — أي تنفيذ عالمي بلا وحدة (module) ولا نطاق.
  4. بعد `frappe.after_ajax` (لأن السكربت قد يطلق طلبات؛ `JS:435`) يُقرأ الكائن من `frappe.query_reports` عبر `get_local_report_settings(custom_report_name)` (`JS:456-464`): للتقارير من نوع `Custom Report` يُقرأ باسم `custom_report_name` أو `report_doc.reference_report`، وإلا باسم التقرير نفسه؛ وإن لم يوجد يُرجع `{}`.
  5. تُضاف على الكائن `html_format` و `execution_time` (`JS:439-440`) ويُخزَّن في `frappe.query_reports[this.report_name]` (`JS:441`).
  6. إن كان لمستند Report فلاتر مُعرَّفة (جدول `Report Filter`) ولم يعرّف السكربت `filters` تُؤخذ من المستند: `JS:443-446`.
- الخادم `get_script` (`Q:178-212`):
  - يبحث عن `<module>/report/<scrub(name)>/<scrub(name)>.js` و `.html` (`Q:185-188`)؛ وإن لم يوجد ملف .js يستخدم حقل `Report.javascript` (`Q:200-202`)؛ وإن لم يوجد شيء يرجع `frappe.query_reports['<name>']={}` (`Q:204-205`).
  - يمرّر السكربت عبر `render_include` (`Q:208`) ليحل توجيهات `{% include %}`.
  - الرد: `{script, html_format, execution_time, filters, custom_report_name}` (`Q:207-213`). تحقق فعلي على `acc.dev` لـ Trial Balance: المفاتيح نفسها، `html_format` غير فارغ (ملف `trial_balance.html` موجود)، `filters: []`، `custom_report_name: None`، `execution_time: 0`، وذيل السكربت `//# sourceURL=trial_balance.js`.
  - **لا يستهلك `get_script` أي hook** من التطبيقات الأخرى (لا يوجد `report_js` أو ما شابه): تحقق فعلي `frappe.get_hooks()` لا يحوي أي مفتاح فيه كلمة `report`.
- `frappe.report_utils.get_report_filters(report_name)` (`RU:121-147`) تعيد نفس الآلية لاستخدامها خارج الصفحة (Auto Email Report، Dashboard).

### 1.4 الخصائص المدعومة في `frappe.query_reports[name]`

الجدول يضم كل مفتاح تقرؤه `query_report.js` فعلياً من `this.report_settings` (نتيجة `grep -on "report_settings\.[a-z_]*"` على الملف)، بالإضافة إلى خصائص تُقرأ عبر مسارات أخرى:

| المفتاح | النوع | أين يُقرأ | السلوك |
|---|---|---|---|
| `filters` | مصفوفة docfields | `JS:532`, `JS:443-446`, `JS:735-739`, `JS:2430` | تُبنى الحقول بـ `page.add_field` (انظر §2). `fieldtype: "Break"` يُتجاهل (`JS:539`). |
| `onload(report)` | دالة | `JS:408` | تُستدعى داخل `refresh_report` بعد `setup_filters` و `set_route_filters` وقبل أول `refresh`؛ أثناءها `_no_refresh = true` (`JS:405-409`) فتغيير الفلاتر لا يطلق تشغيلاً. |
| `after_refresh(report)` | دالة | `JS:880` | في `finally` لكل `refresh` (نجاحاً أو فشلاً). |
| `formatter(value, row, column, data, default_formatter, filter)` | دالة | `JS:1434-1442` | انظر §3. |
| `get_datatable_options(options)` | دالة | `JS:1131-1133`, `JS:1390-1393` | تستقبل خيارات DataTable الافتراضية وتعيد المعدَّلة. تُستدعى أيضاً بـ `{}` داخل `format_cell` لمعرفة `checkboxColumn` عند تسمية صف المجموع. |
| `after_datatable_render(datatable)` | دالة | `JS:1140-1142` | بعد إنشاء/تحديث DataTable. |
| `tree` | boolean | `JS:748`, `JS:1101`, `JS:1124`, `JS:1900` | يُرسل للخادم كـ `is_tree`؛ يمنع `showTotalRow` في DataTable ويمنع حذف الصف الأخير من البيانات (`JS:1101-1104`, `JS:1124`). |
| `parent_field` | string | `JS:749` | يُرسل للخادم فقط (`Q:289` → `add_total_row(..., is_tree, parent_field)` `Q:126`). |
| `initial_depth` | number | `JS:1137-1139`, `JS:2297` | `datatable.rowmanager.setTreeDepth(n)` بعد كل render؛ و`0` يعني إظهار زر «Expand All» بدل «Collapse All» في الذيل. |
| `name_field` | string | لا يُقرأ في frappe | لا يظهر في `JS` ولا في `RU` (grep). تستخدمه ERPNext داخل `formatter` الخاص بها فقط (`apps/erpnext/erpnext/public/js/financial_statements.js:228`). |
| `get_chart_data(columns, result)` | دالة | `JS:1178-1179` | لها الأولوية على `chart` القادم من الخادم (§4.1). |
| `html_format` | string | `JS:439`, `JS:1657` | يأتي من `get_script` (ملف `.html` بجوار التقرير) ويُستخدم كقالب طباعة مخصص (§4.5). |
| `get_pdf_format(report, custom_format)` | دالة async | `JS:1665-1667` | تُستدعى فقط إن لم يختر المستخدم أعمدة ولا Print Format. |
| `export_hidden_cols` | boolean | `JS:1766` | يضيف خيار «Include hidden columns» في حوار التصدير. |
| `collapsible_filters` | boolean | `JS:581-586` | يخفي الفلاتر بعد الصف الأول ويضيف زر طي. |
| `separate_check_filters` | boolean | `JS:536`, `JS:580` | ينقل فلاتر `Check` إلى منطقة مستقلة. **تنبيه:** `general_ledger.js:234` تكتبها `seperate_check_filters` (خطأ إملائي) فلا أثر لها هناك. |
| `execution_time` | number | `JS:440`, `JS:468` | من الخادم؛ إن كان ≥ 5 ثوانٍ يُعرض شريط تقدم (`JS:466-476`). |

مفاتيح على مستوى **الفلتر** الواحد (داخل `filters[]`) تقرؤها الصفحة: `fieldname`, `label`, `fieldtype`, `options`, `default`, `reqd`/`mandatory` (`JS:1477`), `get_query` (`JS:550`), `get_data` (لـ MultiSelectList، `apps/frappe/frappe/public/js/frappe/form/controls/multiselect_list.js:268-270`), `on_change` (`JS:551`), `depends_on` (`JS:482`), `hidden` (`JS:1494`), `wildcard_filter` (`JS:1496-1498`), `width` (يمرَّر للـ control). لا تدعم الصفحة `mandatory_depends_on` (لا ذكر له في `JS`؛ يُقيَّم فقط في `form/layout.js:734-735` للنماذج).

---

## 2. الفلاتر

### 2.1 البناء (`setup_filters`، `JS:530-594`)

- `clear_filters()` = `page.clear_fields()` = `page_form.empty()` (`JS:700-702`, `PG:898-900`).
- لكل تعريف: `this.page.add_field(df, filter_area)` (`JS:544`) → `PG:843-896`: ينشئ control بـ `frappe.ui.form.make_control({df, parent, only_input: fieldtype != "Check"})`، يضيف class `col-md-2` و tooltip، وإن كان `df.default` موجوداً `f.set_input(df.default)` (`PG:892`). ثم تعيد الصفحة `f.set_input(df.default)` مرة أخرى في `JS:546-548`.
- `get_query` و `on_change` يُنسخان من `df` إلى الكائن `f` (`JS:550-551`)؛ ثم يُدمج `df` كله في `f` بـ `Object.assign(f, df)` (`JS:575`) — لذا كل خصائص التعريف متاحة على الكائن، والصفحة تقرأ لاحقاً من `f.df.*` و `f.*` معاً.
- `df.onchange` (الذي يستدعيه الـ control عند التغيير) يُستبدل بدالة الصفحة (`JS:553-573`): تعيد تقييم `depends_on`، تقارن قيم الفلاتر الحالية بـ `previous_filters` (وتمسحها بعد 10 ثوانٍ، `JS:565-566`)، ثم إن كان للفلتر `on_change` تستدعي `f.on_change(this)` **بدل** التشغيل التلقائي؛ وإلا `this.refresh(true)` ما لم يكن `_no_refresh` مرفوعاً. أي أن أي فلتر يعرّف `on_change` مسؤول بنفسه عن استدعاء `frappe.query_report.refresh()` إن أراد.
- بعد البناء: `refresh_filters_dependency()` (`JS:587`)، وإخفاء `page_form` إن لم توجد فلاتر (`JS:588-593`).
- خانة «Translate Data» تُضاف كفلتر `Check` باسم `translate_data` إذا كان `Report.add_translate_data` مفعّلاً (`JS:2423-2432`)؛ الخادم يترجم النتيجة عندها (`Q:129-130`).

### 2.2 `get_query`

- للحقول `Link` يقرأ الـ control `this.get_query || this.df.get_query` (`apps/frappe/frappe/public/js/frappe/form/controls/link.js:784-785`). الأشكال المقبولة: كائن `{filters: {...}}` أو `{query: "path"}` أو قاموس فلاتر مباشر (`link.js:786-804`)، أو نص = اسم دالة بحث على الخادم (`link.js:805-806`)، أو دالة تُستدعى بـ `(doc, doctype, docname)` وتعيد أحد الشكلين السابقين (`link.js:807-830`). في صفحة التقرير لا يوجد `frm`، فـ `doc` هو `this.doc` (غير محدد).
- `MultiSelectList` لا تستخدم `get_query` بل `get_data(txt)` تعيد مصفوفة أو Promise (`multiselect_list.js:266-282`)؛ ERPNext تستخدم `frappe.db.get_link_options(doctype, txt, filters)` (مثلاً `trial_balance.js:51-57`).

### 2.3 `depends_on`

- `refresh_filters_dependency` (`JS:478-502`): لكل فلتر له `depends_on` تُقيَّم القيمة بـ `evaluate_depends_on_value(expression, label)` (`JS:504-528`): إن كانت boolean تُؤخذ كما هي؛ إن بدأت بـ `eval:` تُنفَّذ بـ `frappe.utils.eval(expr, {doc})` حيث `doc` = `get_filter_values()` (`JS:506`, `JS:512`)؛ وإلا تُعامل كاسم فلتر ويُختبر امتلاؤه (المصفوفة الفارغة = false، `JS:519-525`).
- عند الإخفاء: `hidden_due_to_dependency = true`، ويُضاف class `hide-control` على `div[data-fieldname=...]` (`toggle_filter_display`، `JS:2389-2391`)، وتُعاد قيمة الفلتر إلى `df.default || null` (`JS:497`). الفلاتر المخفية بهذه الطريقة تُستثنى من «الفلاتر المطبَّقة» في الطباعة والتصدير (`JS:1725`, `JS:1859`) لكنها **تبقى تُرسل** إلى الخادم ضمن `get_filter_values()` إن كانت لها قيمة.

### 2.4 `reqd`

- `get_filter_values(raise)` (`JS:1474-1507`): عند `raise = true` يفحص `f.df.reqd || f.df.mandatory` ويرمي `"Filter missing"` بعد عرض رسالة «Please set filters» (`JS:1476-1485`). يُستدعى بـ `raise` في `refresh` عندما لا يكون هناك prepared report محدد (`JS:707`)، وفي التصدير (`JS:1807`)، وفي توليد prepared report (`JS:1050`).
- الخادم لا يعرف `reqd`؛ الفحص واجهي فقط.

### 2.5 القيم الافتراضية

- `default` في تعريف الفلتر يُطبَّق مرتين بـ `set_input` (انظر §2.1). لا تعالج الصفحة `default` بشكل خاص (لا `frappe.defaults` تلقائي)؛ ERPNext تحسب القيمة عند تعريف الكائن، مثل `frappe.defaults.get_user_default("Company")` (`trial_balance.js:11`) — تقرأ من `frappe.boot.user.defaults` (`apps/frappe/frappe/public/js/frappe/defaults.js:5-7`) مع مراعاة User Permissions إن كان المفتاح مفتاح صلاحية (`defaults.js:8-11`).
- لأن السكربت يُنفَّذ مرة واحدة ثم يُخزَّن في `frappe.query_reports` (`JS:441`)، فالقيم الافتراضية المحسوبة تُثبَّت عند أول تحميل في الجلسة (مثل `frappe.datetime.get_today()` في `general_ledger.js:24,32`).
- عند `refresh` تُحسب `are_default_filters` (`JS:714-721`): صحيحة فقط إذا لم تتغير الفلاتر و كل فلتر قيمته = `filter.default` أو كلاهما فارغ؛ تُرسل للخادم (`JS:750`) الذي يستبدل الفلاتر بـ `report.custom_filters` للتقارير المخصصة إن كانت افتراضية (`Q:264-265`, `Q:296-297`) وتعيد الصفحة ضبطها بـ `set_filters(data.custom_filters)` (`JS:811-814`).

### 2.6 الفلاتر المعتمدة على بعضها

- الآلية الوحيدة المبنية داخلياً هي `depends_on` (إخفاء/إظهار). الاعتماد في القيم يتم يدوياً داخل `on_change` باستخدام `frappe.query_report.set_filter_value(fieldname | {..})` (`JS:1522-1544`؛ ترفع `_no_refresh` حتى آخر مفتاح فلا يُشغَّل التقرير إلا مرة) و `get_filter_value(fieldname, warn)` (`JS:1517-1520`) و `get_filter(fieldname)` (`JS:1509-1515`). مثال: `general_ledger.js:64-71` يمسح `party` عند تغيير `party_type`، و `party.get_data` يقرأ `party_type` من الصفحة (`general_ledger.js:78-85`).
- `get_values` اسم بديل قديم لـ `get_filter_values` (`JS:2419-2421`) وتستخدمه ERPNext (`trial_balance.js:22`).

### 2.7 القراءة من الرابط والحفظ

- **القراءة:** عند تحليل المسار `set_route_options_from_url()` (`R:531-548`) يحوّل كل query string إلى `frappe.route_options` (ويقرأ أيضاً `localStorage["route_options"]` الذي يضبطه `set_route` عند الفتح في تبويب جديد، `R:362-365`). في `load()` تُنسخ `frappe.route_options` (`JS:145-146`)، ثم `set_route_filters(route_options)` (`JS:671-698`) يضبط كل فلتر اسمه موجود في المفاتيح بـ `await f.set_value(value)`، ويحوّل النص الذي يبدأ بـ `[` إلى مصفوفة (`JS:683-686`) لأجل MultiSelectList، ويلتقط `prepared_report_name` (`JS:678`) و `ignore_prepared_report` (`JS:694`)، ثم يصفّر `frappe.route_options = null` (`JS:690-692`).
- **الحفظ:** لا تُحفظ الفلاتر في User Settings (انظر §6). بعد كل `refresh` يُحدَّث الرابط فقط بـ `window.history.replaceState` (`update_url_with_filters`، `JS:65-69`) بقيم `get_filter_values()` (المصفوفات تُسلسل JSON) أو `prepared_report_name` إن وُجد (`JS:71-90`).
- روابط الفتح في تبويب جديد بأسهم Ctrl/Cmd تُترك للمتصفح (`R:56-59`)؛ وأي `<a href="/desk/...?k=v">` يُعترض ويحوَّل إلى `frappe.set_route` مع `route_options` من query string (`R:26-71`).

---

## 3. `formatter` و DataTable وإعدادات الشجرة

### 3.1 تجهيز الأعمدة (`prepare_columns`، `JS:1374-1448`)

- كل عمود يمر أولاً بـ `frappe.report_utils.prepare_field_from_column` (`RU:93-119`) الذي يحوّل الشكل النصي `"Label:Fieldtype/Options:Width"` إلى كائن.
- ثم يُضاف عليه (`JS:1423-1446`): `id = fieldname`، `name = label` (يُترجم فقط للتقارير من نوع Query، `JS:1375-1378`, `JS:1429`)، `width = parseInt(width) || null`، `editable = column.editable ?? false`، `compareValue` لأعمدة `Date` (لتشغيل فلاتر DataTable المضمّنة على التواريخ، `JS:1411-1421`)، و **`format`**.
- `format` (`JS:1433-1445`): إن عُرِّف `report_settings.formatter` يُستدعى بـ `(value, row, column, data, default_formatter, filter)` حيث `default_formatter` هو `format_cell` المحلي؛ وإلا `format_cell(value, row, column, data)`.
- `format_cell` (`JS:1382-1409`): يعالج صف المجموع (`column.isHeader && !data`) بوضع كلمة `__("Total")` في العمود الأول (أو الثاني عند وجود `checkboxColumn`، `JS:1389-1397`) واستخدام `this.data[0]` كـ `data` بديل لأعمدة `Currency`/`Float` حتى تُقرأ العملة من صف حقيقي (`JS:1398-1401`)، ثم يعيد `frappe.format(value, column, {for_print: false, always_show_decimals: true}, data)`.
- **ما يعيده `formatter`: نص HTML.** DataTable يضعه بـ `innerHTML` داخل `<div class="dt-cell__content">` (`DT/cellmanager.js:857-892`, `DT/cellmanager.js:671`)؛ لذلك يمكن للـ formatter إعادة عناصر `<a>` و `<span>` وأنماط مضمّنة. مثال ERPNext: يلفّ القيمة بـ `<span style="font-weight:bold">` لصفوف المجموعات ويضيف `text-danger` (`financial_statements.js:246-257`)، ويضبط `column.link_onclick` قبل استدعاء `default_formatter` (`financial_statements.js:238-241`) لينتج `frappe.form.formatters.Link` رابط `<a onclick=...>` (`F:201-205`).
- توقيع DataTable الفعلي لدالة `format` هو `(value, row, column, data)` (`DT/cellmanager.js:884`)، أما المعامل الخامس `filter` فيُمرَّر فقط من فلاتر DataTable المضمّنة (`DT/filterRows.js:41`: `formatter(cell.content, rows[i], cell.column, rowData, filter)`) — وهو ما تستغله ERPNext لإعادة القيمة الخام عند التصفية (`financial_statements.js:231-235`).

### 3.2 تجهيز الصفوف والبيانات

- `prepare_report_data` (`JS:1074-1081`): يحفظ `raw_data` (الرد الكامل)، يبني `columns`، يصفّر `custom_columns`، يحوّل الصفوف المصفوفية إلى كائنات بمفاتيح `column.id` (`prepare_data`, `JS:1450-1462`)، يحسب `linked_doctypes` (لزر Add Column)، ويقرر `tree_report = data.some(d => "indent" in d)` (`JS:1080`) — أي أن **الشجرة تُفعَّل في العرض من وجود المفتاح `indent` في أي صف**، بغض النظر عن `report_settings.tree`.

### 3.3 إنشاء DataTable (`render_datatable`، `JS:1083-1143`)

- تُستبعد الأعمدة `hidden` (`JS:1085`)، وتُحوَّل الأعمدة المقنَّعة (`masked_fields` من meta الـ `ref_doctype`) إلى `Data` (`JS:1087-1089`, `JS:1145-1158`).
- حد الصفوف: إن تجاوزت `cint(frappe.boot.sysdefaults.max_report_rows) || 100000` تُعرض رسالة بدل الجدول (`JS:1091-1099`). القيمة الفعلية على `acc.dev`: `max_report_rows = '100000'`.
- إن كان `raw_data.add_total_row` صحيحاً وليس شجرياً: يُحذف الصف الأخير من نسخة البيانات (`JS:1101-1104`) لأن DataTable سيحسب صف المجموع بنفسه.
- الخيارات الافتراضية (`JS:1115-1129`): `columns`, `data`, `inlineFilters: true`, `language: frappe.boot.lang`, `translations: frappe.utils.datatable.get_translations()` (`apps/frappe/frappe/public/js/frappe/utils/datatable.js:3-22`), `treeView: this.tree_report`, `layout: "fixed"`, `cellHeight: 33`, `showTotalRow: add_total_row && !tree`, `direction: frappe.utils.is_rtl() ? "rtl" : "ltr"`, `hooks: {columnTotal: frappe.utils.report_column_total}`.
- تُمرَّر إلى `report_settings.get_datatable_options(options)` إن وُجدت (`JS:1131-1133`) ثم `new window.DataTable(this.$report[0], options)` (`JS:1134`؛ `DataTable` معرَّض عالمياً في `JS:3-6`).
- إعادة الاستخدام: إذا كان هناك `datatable` قائم و `options.showTotalRow === raw_data.add_total_row` يُستدعى `datatable.refresh(data, columns)` بعد تحديث `options.treeView` (`JS:1107-1113`) بدل إنشاء جديد — وهذا ما يحفظ عرض الأعمدة والترتيب بين التشغيلات.
- الخيارات الافتراضية لـ DataTable نفسها في `DT/defaults.js:4-89` (منها `headerDropdown` بعناصر Sort Ascending/Descending، Reset sorting، Remove column، Freeze/Unfreeze؛ `events.onRemoveColumn/onSwitchColumn/onSortColumn/onCheckRow`; `serialNoColumn: true`; `checkboxColumn: false`).
- صف المجموع يُحسب في `DT/body-renderer.js:81-115` من **الصفوف المرئية** (`this.visibleRows`) عبر `hooks.columnTotal` = `frappe.utils.report_column_total` (`U:969-985`): يعيد `""` إذا `column.disable_total`، متوسطاً لـ `Percent`، `cint` لـ `Int`، `flt` لبقية الأنواع الرقمية (`frappe.model.is_numeric_field`)، و `null` لغيرها. أي أن **مجموع الجدول يتغير مع فلاتر DataTable المضمّنة** وقد يختلف عن صف المجموع القادم من الخادم.

### 3.4 إعدادات الشجرة

- الخادم: `is_tree` و `parent_field` يُرسلان في `run` (`JS:748-749`) وتستخدمهما `add_total_row` (`Q:126-127`) فقط.
- الواجهة: `treeView` من وجود `indent` (§3.2). DataTable يضيف المسافة البادئة والزر في **العمود الأول بعد `_rowIndex`** بمقدار `indent * 20px` (`DT/cellmanager.js:895-914`).
- `initial_depth` → `rowmanager.setTreeDepth(depth)` (`JS:1137-1139`؛ التنفيذ في `DT/rowmanager.js:263-284`).
- ذيل الصفحة للشجرة (`show_footer_message`، `JS:2284-2304`): حقل رقمي «Set Level» + «Expand All» + «Collapse All» مربوطة بـ `set_tree_level` (`JS:2335-2355`)، `expand_all_rows` (`JS:2316-2326`)، `collapse_all_rows` (`JS:2328-2333`) عبر `rowmanager.expandAllNodes/collapseAllNodes` (`DT/rowmanager.js:239-261`).
- الطباعة والتصدير يحترمان الشجرة: `print_grid.html:47` يضيف `padding-left: indent*2em`، والتصدير يمرّر `include_indentation` (`JS:1750-1756`).

---

## 4. الرسم والملخص والأعمدة والتصدير والطباعة

### 4.1 الرسم البياني

- `get_chart_options(data)` (`JS:1177-1207`): الأولوية لـ `report_settings.get_chart_data(data.columns, data.result)`، ثم `data.chart` من الخادم. يُرفض الخيار إن لم يكن فيه `data.labels` غير فارغة. إن حمل `fieldtype` يُضاف `tooltipOptions.formatTooltipY` عبر `frappe.format`؛ ويُفرض `axisOptions = {shortenYAxisNumbers: 1, numberFormatter: frappe.utils.format_chart_axis_number}` و `height = 280`.
- `render_chart(options)` = `new frappe.Chart(this.$chart[0], options)` (`JS:1209-1213`).
- إن لم يُرجع الخادم رسماً ووُجد `this.chart_fields` (اختيار المستخدم من حوار «Set Chart»، `JS:1215-1372`) يُبنى الرسم من الأعمدة بـ `frappe.report_utils.make_chart_options` (`RU:4-55`؛ يحذف الصف الأخير إذا `add_total_row`).
- أزرار «Set Chart» و «Add Chart to Dashboard» تحت مجموعة «Actions» في الشريط الداخلي (`JS:196-222`) مشروطة بـ `frappe.model.can_create("Dashboard Chart")`؛ و «Create Card» مشروطة بـ `can_create("Number Card")` (`JS:185-194`).
- **ملاحظة تخص هذا الموقع:** `snd_accounting` يعيد تعريف `get_chart_options`/`render_chart` لدعم Highcharts (`apps/snd_accounting/snd_accounting/public/js/snd_query_report.js:2-40`) — انظر §8.5.

### 4.2 الملخص (`report_summary`)

- إن جاء `data.report_summary` يُفرَّغ `$summary` ويُرسم بـ `render_summary` (`JS:836-839`, `JS:884-890`): لكل عنصر `frappe.utils.build_summary_item(summary)` (`U:1676-1700`): النوع `separator` يعرض قيمة فقط؛ وإلا `frappe.format(summary.value, {fieldtype: summary.datatype, options: "currency"?}, {only_value: true}, {currency: summary.currency})` مع لون من `indicator` أو `color`. المفاتيح المقروءة: `type`, `value`, `label`, `datatype`, `currency`, `indicator`, `color`.

### 4.3 اختيار الأعمدة

- **لا يوجد حوار «Pick Columns» في صفحة query-report.** الاسم يظهر فقط في `report_view.js:1674-1727` (Report Builder) وفي حوار الطباعة كخيار `pick_columns` (`PU:71-91`).
- ما يتوفر في query-report:
  - إزالة عمود من قائمة رأس العمود في DataTable (`DT/defaults.js:28-33` → `removeColumn`). `get_visible_columns()` (`JS:1464-1472`) يقرأ الأعمدة الحالية من `datatable.datamanager.getColumns(true)` ويعيدها بترتيبها، وهي المستخدمة في الطباعة والحفظ.
  - «Add Column» من القائمة (`JS:1989-2107`): يعرض DocTypes المرتبطة من أعمدة `Link`/`Dynamic Link` (`get_linked_doctypes`، `JS:2193-2245`)، يجلب القيم بـ `frappe.desk.query_report.get_data_for_custom_field` (`Q:813-824`؛ يفحص `has_permission(doctype, "read")` ويستخدم `frappe.get_list`)، ويدرج العمود بـ `add_custom_column` (`JS:2175-2191`) ويعيد الرسم. الأعمدة المضافة تُخزَّن في `this.custom_columns` وتُرسل مع التصدير (`JS:1823`).
  - «Save» (لـ `is_report_manager()`، `JS:2120-2157`) يحفظ الأعمدة المرئية والفلاتر كتقرير `Custom Report` عبر `frappe.desk.query_report.save_report` (`Q:854-891`) ثم ينتقل إليه.
- تحديد صفوف: `get_checked_items(only_docnames)` (`JS:2406-2416`) يعمل فقط إذا فعّل التقرير `checkboxColumn` عبر `get_datatable_options`.

### 4.4 التصدير (`export_report`، `JS:1744-1850`)

- يبدأ بـ `get_validated_visible_indexes()` (`JS:1562-1574`): يقرأ `datatable.bodyRenderer.visibleRowIndices` ويرمي خطأ إن كانت فارغة.
- الحوار: `frappe.report_utils.get_export_dialog(title, extra_fields, callback)` (`RU:173-291`) بحقول `file_format` (Excel/CSV)، `export_in_background`، وقسم CSV: `csv_delimiter` (افتراضي `,`)، `csv_quoting` (0 Minimal / 1 All / 2 Non-numeric (افتراضي) / 3 None)، `csv_decimal_sep` (افتراضي `.`)، ومعاينة `csv_preview` تُحدَّث محلياً بـ `get_csv_preview` (`RU:293-353`). الحقول الإضافية من الصفحة: `include_indentation` (شجري فقط)، `include_filters` (إن وُجدت فلاتر مطبَّقة)، `include_hidden_columns` (إن `export_hidden_cols`).
- قبل الإرسال: `make_access_log("Export", file_format)` (`JS:1552-1560`)، ثم `get_filter_values(true)` (يفرض الإلزامي)، `get_applied_filters` (`JS:1852-1866`: قاموس Label→Value بدون المخفية بالاعتماد، مع تحويل Check إلى Yes/No)، وإضافة `prepared_report_name` إن وُجد.
- `ignore_visible_idx = visible_idx.length === data.length - (add_total_row ? 1 : 0)`؛ إن صح تُرسل `visible_idx = []` (`JS:1815-1818`).
- الحمولة (`JS:1820-1836`): `cmd: "frappe.desk.query_report.export_query"`, `report_name`, `custom_columns`, `file_format_type`, `filters`, `applied_filters`, `visible_idx`, `ignore_visible_idx`, `csv_delimiter`, `csv_quoting`, `csv_decimal_sep`, `include_indentation`, `include_filters`, `export_in_background`, `include_hidden_columns`.
- الإرسال: إن `export_in_background` → `frappe.call` عادي (الخادم يضع المهمة في طابور `long` ويرسل بريداً، `Q:388-405`)؛ وإلا `open_url_post(frappe.request.url, args)` (`JS:1843`) — نموذج POST يفتح في نافذة جديدة لتنزيل الملف.
- الخادم `export_query` (`Q:373-407`) يفحص `frappe.permissions.can_export(ref_doctype, raise_exception=True)` (`Q:383-386`)، ويقرأ معاملات CSV بـ `pop_csv_params` (`apps/frappe/frappe/desk/utils.py:36-46`)، ثم `_export_query` (`Q:419-`) يعيد تشغيل التقرير بـ `run(..., are_default_filters=False)` ويطبّق `visible_idx` على النتيجة إن كانت أقل من كل الصفوف (`Q:455-466`). أي أن التصدير **يعيد تنفيذ التقرير على الخادم** ولا يستخدم بيانات المتصفح؛ الترتيب وفلاتر DataTable المضمّنة لا تُنقل إلا كمجموعة فهارس مرئية.
- `get_data_for_csv` (`JS:1868-1885`) موجودة لكنها غير مستدعاة في مسار التصدير الحالي (grep: لا استدعاء لها في `JS`).

### 4.5 الطباعة و PDF

- عنصرا القائمة «Print» و «PDF» (`JS:1942-1976`) مشروطان بـ `frappe.model.can_print(report_doc.ref_doctype)`، ويُخفيان عند غياب البيانات (`toggle_print_buttons`، `JS:2400-2404`).
- الحوار: `frappe.ui.get_print_settings(false, callback, letter_head, visible_columns, true, title)` (`PU:1-128`): حقول `orientation` (Landscape افتراضي)، `print_format` (Link إلى Print Format بشرط `print_format_for: "Report"`, `print_format_type: "JS"`, `report: <اسم التقرير>`)، `with_letter_head`، `letter_head`، `include_filters` (افتراضي 1)، `pick_columns` + `columns` (MultiCheck بالأعمدة المرئية). تُدمج القيم مع `locals[":Print Settings"]["Print Settings"]` (`PU:9`, `PU:95`)، ويُقرأ الـ letter head من `frappe.boot.letter_heads` (`PU:106-107`). `add_portrait_warning` يضيف تنبيهاً عند أكثر من 10 أعمدة (`JS:2162-2173`).
- **Print** (`print_report`، `JS:1576-1599`): يبني `filters_html` (`get_filters_html_for_print`، `JS:1717-1742`: كل فلتر بقيمته المنسّقة بـ `frappe.format`)، يختار القالب `get_custom_format` (`JS:1656-1671`): Print Format المختار (يُجلب `html`+`css` بـ `frappe.db.get_value("Print Format", ...)` `JS:1677-1691`) → وإلا `report_settings.get_pdf_format` → وإلا `report_settings.html_format` (ملف `.html` بجوار التقرير) → وإلا القالب العام `print_grid` (`get_print_template`، `JS:1673-1675`؛ يُفرض `print_grid` أيضاً إذا اختار المستخدم أعمدة). ثم `render_report_letterhead` (`JS:1693-1715`؛ يستدعي `frappe.utils.print_format.render_letterhead_for_print` على الخادم بسياق الفلاتر + `company` الافتراضية)، و `make_access_log("Print", "PDF")`، ثم `frappe.render_grid({...})` (`MT:121-176`): يعرض القالب بمحرك القوالب الصغير `frappe.render_template` (**في المتصفح**، `MT:7-`) داخل `print_template` (`apps/frappe/frappe/public/html/print_template.html`: `<html lang dir="{{ layout_direction }}">` و `print.bundle.css` بنسخة RTL عند `frappe.utils.is_rtl(lang)`، السطر 2 و 10)، ويفتح `window.open()` ويكتب HTML فيه (`MT:158-176`) — **الطباعة لا تمر عبر الخادم** إلا لجلب الـ letter head والـ Print Format.
- **PDF** (`pdf_report`، `JS:1601-1654`): نفس بناء الـ HTML في المتصفح (`JS:1615-1638`)، ثم يُرسل HTML كاملاً بـ `frappe.render_pdf(html, print_settings)` (`MT:199-236`) إلى `POST /api/method/frappe.utils.print_format.report_to_pdf` مع `orientation`، ويحوَّل على الخادم بـ `get_pdf` (wkhtmltopdf) (`apps/frappe/frappe/utils/print_format.py:261-273`) ويُنزَّل كـ blob باسم `<Report>_<قيم الفلاتر>.pdf` (`JS:1640-1652`).
- القالب العام `print_grid.html` (`apps/frappe/frappe/public/js/frappe/views/reports/print_grid.html`): عنوان + فلاتر + جدول `table-bordered`؛ رؤوس الأعمدة الرقمية `text-right` (السطر 24-26)؛ لكل خلية يُستدعى `col.formatter` أو `col.format(value, row, col, format_data)` أو `frappe.format` (السطور 54-62)، و `Check` تُطبع ✓/✗ (السطر 51-52). البيانات من `get_data_for_print` (`JS:1887-1912`): الصفوف المرئية بترتيب `rowViewOrder`، وصف مجموع من `bodyRenderer.getTotalRow()` مع `is_total_row = true` ونسخ `currency` من الصف الأول (`JS:1900-1910`). الأعمدة من `get_columns_for_print` (`JS:1914-1926`): الأعمدة المختارة أو كل الأعمدة إن وُجد قالب مخصص، وإلا المرئية.
- `print_tree.html` قالب مستقل لعرض الشجرة (`frappe.render_tree`، `MT:178-197`) غير مستخدم من `query_report.js`.

### 4.6 `get_datatable_options`

- الاستدعاء الأساسي `JS:1131-1133`؛ الاستدعاء الثاني بـ `{}` (`JS:1390-1393`) يعني أن الدالة **يجب أن تتحمل كائناً فارغاً** وأن لا تعتمد على وجود `columns`.
- الاستخدام النموذجي: `Object.assign(options, {checkboxColumn: true, events: {onCheckRow: ...}})` ثم استخدام `frappe.query_report.get_checked_items()`.

---

## 5. التنسيق

### 5.1 `frappe.format`

- `frappe.format(value, df, options, doc)` (`F:428-452`): إن كان الحقل ضمن `masked_fields` لـ `df.parent` يُعامل كـ `Data`؛ `Dynamic Link` يتحول إلى `Link` مع `_options = doc[df.options]`؛ يُستخدم `df.formatter` إن وُجد وإلا `frappe.form.get_formatter(fieldtype)` (`F:423-426`؛ يحذف المسافات من اسم النوع)؛ والناتج يمر بـ `frappe.dom.remove_script_and_style` (`F:449`).
- `Float` (`F:55-81`): الدقة = `docfield.precision || cint(sysdefaults.float_precision) || null`؛ إذا كان للحقل `options` غير فارغ يُعامل كـ `Currency` بدقة الـ Float؛ بدون `always_show_decimals` تُحذف الكسور الصفرية (`F:66-72`) — الصفحة تمرّر `always_show_decimals: true` (`JS:1406`). الناتج يُلف بـ `_right` = `<div style='text-align: right'>` ما لم تكن `options.inline`/`only_value` (`F:11-17`).
- `Int` (`F:83-92`) و `Percent` (`F:93-107`) كذلك بـ `_right`.
- `Currency` (`F:127-165`): العملة من `frappe.meta.get_field_currency(docfield, doc)` (`apps/frappe/frappe/public/js/frappe/model/meta.js:295-325`): الافتراضي `frappe.boot.sysdefaults.currency`؛ إن كان `options` بصيغة `A:B:C` تُقرأ من مستند مرتبط؛ وإلا إن وُجد `doc[options]` تُؤخذ منه (`meta.js:319-320`) — وهذا هو مسار «العملة من الصف»: أعمدة Trial Balance تعرّف `"options": "currency"` وعموداً مخفياً `currency` في كل صف (`apps/erpnext/erpnext/accounts/report/trial_balance/trial_balance.py:499-512`). **تنبيه:** إن لم يوجد `doc` ووُجد `cur_frm` يُقرأ من نموذج مفتوح آخر (`meta.js:297`, `meta.js:321-322`). الدقة: `docfield.precision` إن كانت رقماً، وإلا `cint(docfield.precision || sysdefaults.currency_precision || 2)` (`F:135-140`)؛ عند دقة > 2 تُعدَّل حسب `fraction_units` للعملة (`F:143-153`). ثم `format_currency(value, currency, precision)` (`NF:145-163`): يضيف رمز العملة (من `:Currency` المحمّلة في boot، أو الكود نفسه؛ يُخفى إن `sysdefaults.hide_currency_symbol == "Yes"`، `NF:165-177`) يميناً أو يساراً حسب `symbol_on_right`.
- `Link` (`F:171-222`): مع `for_print`/`only_value` يعيد النص فقط؛ وإلا إن `docfield.link_onclick` يُنتج `<a onclick=...>`؛ وإلا إن `frappe.model.can_read(doctype)` يُنتج `<a href="/desk/<slug>/<name>" data-doctype data-name>`؛ وإلا نصاً.
- `Date` (`F:224-236`) عبر `frappe.datetime.str_to_user`؛ `Check` (`F:167-170`) checkbox معطّل.

### 5.2 الدقة وإعدادات النظام

- `frappe.boot.sysdefaults` = `frappe.defaults.get_defaults()` (`apps/frappe/frappe/boot.py:48`) = الافتراضيات العامة (`__default`) مدموجة بافتراضيات المستخدم (`apps/frappe/frappe/defaults.py:105-118`). القيم الفعلية على `acc.dev`: `float_precision='3'`, `currency_precision=''` (فارغة → الدقة 2 في `Currency`)، `number_format='#,###.##'`, `currency='YER'`, `use_number_format_from_currency='0'`, `rounding_method="Banker's Rounding"`, `lang='ar'`.
- `format_number(v, format, decimals)` (`NF:90-143`): إن لم يُمرَّر `format` يُستخدم `get_number_format()` والدقة الافتراضية `cint(frappe.defaults.get_default("float_precision")) || 3`؛ يفصل الآلاف حسب `frappe.number_format_info[format]` (`NF:77-88`) مع حالة خاصة لـ `#,##,###.##`؛ التقريب بـ `flt` → `_round` بـ `sysdefaults.rounding_method` (`NF:204-`).
- `get_number_format(currency)` (`NF:179-188`): إن كان `sysdefaults.use_number_format_from_currency` مفعّلاً وللعملة `number_format` تُستخدم؛ وإلا `sysdefaults.number_format` وإلا `#,###.##`.
- `frappe.meta.get_field_precision` (`meta.js:328-345`) تُستخدم في النماذج لا في صفحة التقرير.

### 5.3 RTL والمحاذاة

- `frappe.utils.is_rtl(lang)` = `["ar","he","fa","ps"].includes(lang || frappe.boot.lang)` (`U:1106-1108`). تُستخدم في `direction` لـ DataTable (`JS:1125`) وفي `layout_direction` للطباعة (`JS:1636`, `MT:150`).
- DataTable مع `direction: "rtl"` يضع `dir="rtl"` على الحاوية (`DT/datatable.js:115`) ويعكس اتجاه سحب تغيير عرض العمود (`DT/columnmanager.js:183-185`). لا يغيّر محاذاة النصوص بحد ذاته.
- محاذاة الأرقام تتحقق بآليتين متراكبتين:
  1. `frappe.form.formatters._right` يلف القيمة بـ `<div style='text-align: right'>` (`F:11-17`) لأنواع Float/Int/Percent/Currency — محاذاة يمين مطلقة حتى في RTL.
  2. DataTable `prepareNumericColumns` (`DT/datamanager.js:132-142`، يُستدعى في `DT/datamanager.js:36`): إن لم يكن للعمود `align` وكانت قيمة **الصف الأول** الخام رقمية (`isNumeric = !isNaN(val)`، `DT/utils.js:79-81`) يُضبط `align = 'right'`، ثم `setColumnStyle` يكتب `text-align` على `.dt-cell--col-N` (`DT/style.js:292-304`). يمكن للتقرير فرض `align` على العمود صراحة.
- ترجمة نصوص DataTable الداخلية تمر عبر `frappe.utils.datatable.get_translations()` (`utils/datatable.js:3-22`) مع `language: frappe.boot.lang`.

---

## 6. User Settings

- **صفحة query-report لا تحفظ أي تفضيلات مستخدم:** `grep "user_settings\|localStorage\|sessionStorage"` على `JS` لا يعيد شيئاً. الحالة الوحيدة المحفوظة هي الفلاتر في الرابط (`replaceState`، §2.7) والحالة داخل الكائن الحي `frappe.query_report` طالما لم تُعد الصفحة تحميلها (`JS:155-159`).
- ما يحفظه Report Builder (`report_view.js`) للمقارنة: `frappe.model.user_settings.save(doctype, view_name, obj)` (`apps/frappe/frappe/public/js/frappe/list/list_view.js:1929-1931`) بمفاتيح `fields`, `filters`, `order_by`, `group_by`, `chart_args`, `add_totals_row` (`report_view.js:225-232`) و `last_view` (`report_view.js:222`).
- الآلية العامة (`apps/frappe/frappe/public/js/frappe/model/user_settings.js`): `save(doctype, key, value)` (السطر 9-29) يدمج القيمة في نسخة محلية ويستدعي `update` → `frappe.model.utils.user_settings.save` (السطر 36-48) الذي يكتب في cache Redis بمفتاح `<doctype>::<user>` (`apps/frappe/frappe/model/utils/user_settings.py:30-43`) ويُزامَن للجدول `__UserSettings` لاحقاً (`user_settings.py:46-62`). القراءة: `frappe.get_user_settings(doctype, key)` (السطر 51-57) من `frappe.model.user_settings[doctype]` التي تُملأ عند `frappe.model.with_doctype` من رد `getdoctype` (`model.js:236-240`، الخادم `apps/frappe/frappe/desk/form/load.py:76`). المفتاح الأول دائماً **اسم DocType**؛ لا يوجد مفتاح لاسم تقرير.

---

## 7. التنقل عند الضغط

- **من خلية إلى مستند:** أعمدة `Link` تُنتج `<a href="/desk/<slug(doctype)>/<name>">` (`F:206-216`) بشرط `frappe.model.can_read(doctype)`. المعالج العام للنقر في `R:26-71` يعترض أي `<a>` على نفس المضيف بمسار يبدأ بـ `/desk` ويحوّله إلى `frappe.set_route(pathname)` (مع نقل query string إلى `frappe.route_options`، `R:60-65`)، ويترك Ctrl/Cmd والروابط ذات `onclick` و `target=_blank` للمتصفح (`R:35-53`).
- **من خلية إلى تقرير آخر:** الأسلوب في ERPNext هو `link_onclick` على العمود (`financial_statements.js:238-241`) ثم دالة تضبط `frappe.route_options = {...}` وتستدعي `frappe.set_route("query-report", "General Ledger")` (`financial_statements.js:262-301`). `set_route` (`R:349-386`): يحوّل الوسائط (`get_route_from_arguments`, `R:388-414`، ويزيل `desk`/`app` من البداية)، يبني المسار، وإن كان `frappe.open_in_new_tab` يحفظ `route_options` في `localStorage` ويفتح تبويباً (`R:362-365`)؛ وإلا يضيف `route_options` كـ query string (كل قيمة `encodeURIComponent(JSON.stringify(value))`، `R:367-374`) و `push_state` (`R:494-503`) الذي يستدعي `route()`. الصفحة المستقبِلة تقرأ `frappe.route_options` كما في §2.7.
- يمكن تمرير كائن كوسيط ثالث لـ `set_route("List", doctype, {...})` (`R:430-432`)، أما لمسار `query-report` فلا معالجة خاصة للوسيط الثالث في `convert_from_standard_route` (`R:416-446`)؛ لذلك ERPNext تضبط `frappe.route_options` يدوياً قبل الاستدعاء (وأيضاً تمرر كائناً ثالثاً في `financial_statements.js:329` — راجع الأسئلة المفتوحة).
- نفس التقرير مع فلاتر جديدة: `load()` يكتشف `frappe.has_route_options()` (`R:693-695`) ويستدعي `refresh_report` (`JS:151-154`).
- من التقرير إلى نموذجه: عنصر «Edit» → `frappe.set_route("Form", "Report", name)` (`JS:1935-1940`) لمديري التقارير.

---

## 8. نظام bundles وإضافة صفحات وأزرار من تطبيق آخر

### 8.1 تعريف bundle وبناؤه

- الاكتشاف: esbuild يجمع كل ملف يطابق `<app>/public/**/*.bundle.{js,ts,css,sass,scss,less,styl,jsx}` مع استثناء `node_modules` و `dist` (`apps/frappe/esbuild/esbuild.js:251-269`). كل ملف مطابق نقطة دخول مستقلة تُبنى إلى `<app>/public/dist/js/<name>.bundle.<HASH>.js` وتُسجَّل في `sites/assets/assets.json` بمفتاح اسم الملف الأصلي (`esbuild.js:442-465`؛ مثال فعلي: `erpnext.bundle.js → /assets/erpnext/dist/js/erpnext.bundle.MSEESOLB.js`).
- ملف الدخول يستورد بقية الملفات بـ `import`/`require` (مثال `apps/erpnext/erpnext/public/js/erpnext.bundle.js`؛ وقوالب HTML تُستورد أيضاً وتصبح `frappe.templates[...]`).
- الأمر: `bench build --app report_view` (كما في `CLAUDE.md`).

### 8.2 التحميل في كل صفحة (`app_include_js`)

- `apps/frappe/frappe/www/desk.py:37-38` يجمع `hooks.app_include_js` من كل التطبيقات (+ `site_config.app_include_js`) ويعرضها `desk.html:65-67` بـ `include_script(path)` (`apps/frappe/frappe/utils/jinja_globals.py:98-110`) الذي يحل اسم الـ bundle إلى المسار المجزَّأ من `assets.json`. القيمة تقبل اسم bundle (`erpnext.bundle.js`) أو مساراً مطلقاً لملف غير مجمَّع (`/assets/snd_accounting/js/snd_query_report.js`) — كلاهما موجود فعلياً على `acc.dev` (تحقق `frappe.get_hooks("app_include_js")`؛ 36 عنصراً بترتيب تثبيت التطبيقات).
- الترتيب مهم: الـ bundles تُنفَّذ بترتيب التطبيقات المثبتة؛ و`frappe.standard_pages["query-report"]` تُنشئ الكائن عند أول زيارة فقط (`pageview.js:9-13`) فتلتقط آخر تعريف لـ `frappe.views.QueryReport`.

### 8.3 التحميل عند الطلب (`frappe.require`)

- `frappe.require(items, callback)` (`apps/frappe/frappe/public/js/frappe/assets.js:8-19`): يقبل نصاً أو مصفوفة؛ يمرّر كل عنصر عبر `frappe.assets.bundled_asset(path, is_rtl)` (`assets.js:145-154`): إن لم يبدأ بـ `/assets` واحتوى `.bundle.` يُبدَّل من `frappe.boot.assets_json` (المُعبَّأ في `apps/frappe/frappe/sessions.py:166`)، وللـ CSS مع RTL يُسبق بـ `rtl_`. ثم `execute` (`assets.js:109-136`) يجمّد الواجهة `frappe.dom.freeze()`، يحمّل كل ملف مرة واحدة (`_executed`، `assets.js:97-107`) عبر معالج حسب الامتداد، ويضيف `?v=` للملفات غير المجمَّعة. يعيد Promise.
- الاستخدام الصحيح لتطبيقنا: `frappe.require("report_view.bundle.js").then(...)` من نقطة خفيفة محمّلة بـ `app_include_js`، أو مباشرة من سكربت Page.

### 8.4 إضافة صفحة desk جديدة بمسار مثل `/desk/report-view/<name>`

`render_page` (`R:301-322`) يعطي ثلاثة مسارات ممكنة لمسار من جزأين:

1. **Factory:** تعريف `frappe.views.ReportViewFactory extends frappe.views.Factory` في bundle محمّل بـ `app_include_js`. لأن `to_title_case("report-view")` = `ReportView` (`U:281-289`) ووجود `route[1]` يجعل الراوتر ينشئ الـ Factory ويستدعي `show()` (`R:307-314`). `Factory.show` (`apps/frappe/frappe/public/js/frappe/views/factory.js:12-30`) يعيد استخدام `frappe.pages[route_str]` إن وُجدت وإلا يستدعي `make(route)`؛ و `frappe.make_page(double_column, page_name)` (`factory.js:37-53`) يبني الحاوية بـ `frappe.container.add_page` + `frappe.ui.make_app_page` ثم `change_to`. هذا هو نمط `report_factory.js` (`apps/frappe/frappe/public/js/frappe/views/reports/report_factory.js:4-15`) لكنه يُعيد التوجيه فقط. مفتاح الصفحة سيكون المسار الكامل `report-view/<name>` أي صفحة DOM لكل تقرير.
2. **Page DocType:** إنشاء مستند `Page` باسم `report-view` في وحدة التطبيق مع ملف `<module>/page/report_view/report_view.js`. `pageview.show("report-view")` (`pageview.js:50-64`) يجلبه بـ `frappe.desk.desk_page.getpage` (`apps/frappe/frappe/desk/desk_page.py:24-31` → `Page.is_permitted()` ثم `load_assets`) ويقيّم السكربت بـ `frappe.dom.eval` (`pageview.js:90`)، ويستدعي `frappe.pages["report-view"].on_page_load(wrapper)` ثم `on_page_show` عند كل عرض (`pageview.js:97-109`). اسم التقرير يُقرأ من `frappe.get_route()[1]`. صفحة DOM واحدة لكل التقارير (نفس نمط `query-report`). `Page.load_assets` يضيف أيضاً ملفات `page_js` من hooks التطبيقات الأخرى (`apps/frappe/frappe/core/doctype/page/page.py:194-197`). التخزين في `localStorage["_page:<name>"]` ما لم يكن `developer_mode` (`pageview.js:23-39`).
3. **`frappe.standard_pages["report-view"]`:** نفس آلية `query-report` تماماً (`pageview.js:9-15`) دون مستند Page، بدالة تُعرَّف في bundle محمّل بـ `app_include_js`. لا يمر بفحص `Page.is_permitted`.

في الحالات الثلاث، معالجة الرابط `/desk/report-view/<name>?k=v` تلقائية: `route_options` من الـ query string (`R:531-548`) وترميز `decode_component` (`R:550-561`).

### 8.5 إضافة أزرار أو سلوك لصفحة `query-report` من تطبيق آخر

- **لا توجد hook مخصصة للتقارير.** الـ hooks التي يستهلكها الخادم للـ JS هي: `app_include_js` (`desk.py:38`)، `doctype_js`/`doctype_list_js`/`doctype_tree_js`/`doctype_calendar_js` (تُلحق بـ meta الـ DocType، `apps/frappe/frappe/desk/form/meta.py:111-114`, `meta.py:284-299`)، `page_js` (لمستندات Page فقط، `page.py:194-197`)، و `webform_include_js/css`. `get_script` للتقارير لا يقرأ أياً منها (§1.3). `frappe.ui.form.on` خاصة بالنماذج ولا علاقة لها بالتقارير.
- الآليات الفعلية المتاحة من bundle محمّل بـ `app_include_js`:
  - **`frappe.query_reports[name]`:** يمكن تعريف الكائن مسبقاً أو تعديله بعد التحميل (ERPNext تفعل ذلك: `erpnext.utils.add_dimensions` تُدخل فلاتر في `frappe.query_reports[report_name].filters` بعد استدعاء الخادم، `apps/erpnext/erpnext/public/js/utils.js:330-352`). إن عُرِّف الكائن قبل الزيارة الأولى فلن يُستدعى `get_script` أصلاً (`JS:425-427`) — وهذا يعطّل سكربت التقرير الأصلي.
  - **`onload`/`after_refresh` لكل تقرير:** يستقبلان كائن الصفحة `report` ومنه `report.page.add_inner_button(label, action, group)` (`PG:622-`)، `add_custom_button_group` (`PG:778`)، `add_custom_menu_item` (`PG:360`)، `add_menu_item` (`PG:349`)، `add_action_icon` (`PG:224`)، `set_primary_action` (`PG:301`). مثال حي: `financial_statements.js:306-330` يضيف مجموعة «Financial Statements» داخل `onload`. لكن `page.clear_inner_toolbar()` يُستدعى في كل `load_report` (`JS:163`) و `page.clear_custom_actions()` في كل `refresh_report` (`JS:407`)، فالأزرار المضافة بغير هذين المسارين قد تُمسح.
  - **الاستماع لأحداث عامة:** `frappe.router.on("change", fn)` (الراوتر event emitter: `R:697`؛ يُطلق في `R:151`) أو `$(document).on("page-change")` (`container.js:78`) أو حدث `show` على `frappe.pages["query-report"]` (`container.js:81`)، ثم التعامل مع `frappe.query_report` (كائن عام، `JS:21`) — مع ملاحظة أن الحدث يسبق اكتمال `load_report` غير المتزامن، فلا تتوفر `report_settings`/`datatable` إلا بعد `after_refresh`.
  - **إعادة تعريف الصنف** `frappe.views.QueryReport = class X extends frappe.views.QueryReport {...}` — هذا ما يفعله تطبيقان مثبتان على هذا الموقع: `snd_accounting` (`apps/snd_accounting/snd_accounting/public/js/snd_query_report.js:2`) و `snd_print` (`apps/snd_print/snd_print/public/js/report_extend.bundle.js:38`، يعيد تعريف `load_report`, `get_menu_items`, ويضيف أزرار طباعة). يعمل لأن الصفحة تُنشأ عند أول زيارة (§1.1). **هذا monkey-patching ممنوع في `CLAUDE.md`** لتطبيقنا، لكن وجوده يعني أن `frappe.views.QueryReport` على `acc.dev` هو فعلياً `SndQueryReport → SndChartQueryReport → QueryReport`، وأي مقارنة إجماليات/سلوك مع «الصفحة الأصلية» تتم مع هذه السلسلة.
  - `excel_view` يوسّع الراوتر بإضافة view جديد بأسماء `frappe.router.list_views` و `frappe.views.view_modes` وتعديل prototypes (`apps/excel_view/excel_view/public/js/excel/excel_view_router.bundle.js:20-59`) — نمط لا ينطبق على مسار مستقل مثل `report-view`.

---

## 9. مثالان من ERPNext

### 9.1 Trial Balance (`apps/erpnext/erpnext/accounts/report/trial_balance/trial_balance.js`)

| ما يستخدمه | السطر | ملاحظة |
|---|---|---|
| `filters` بأنواع `Link`, `Date`, `MultiSelectList`, `Select`, `Check` | 5-121 | `company` بـ `default: frappe.defaults.get_user_default("Company")` و `reqd: 1` (7-13). |
| `on_change` على `fiscal_year` | 21-33 | يقرأ `query_report.get_values()` ثم `frappe.query_report.set_filter_value({from_date, to_date})`؛ لا يستدعي `refresh` بنفسه فالتشغيل يحدث من `set_filter_value` عند آخر مفتاح (`JS:1530-1543`). |
| `get_data` مع `frappe.db.get_link_options(..., {company: frappe.query_report.get_filter_value("company")})` | 51-57, 62-68 | اعتماد قيمة على فلتر آخر. |
| `formatter: erpnext.financial_statements.formatter` | 122 | من `erpnext.bundle.js` (يستورد `financial_statements.js`)؛ يعتمد على `data.parent_account`/`is_group_account` و `column.colIndex`. |
| `tree: true`, `name_field: "account"`, `parent_field: "parent_account"`, `initial_depth: 3` | 123-127 | `name_field` تقرؤه ERPNext فقط (§1.4). |
| `export_hidden_cols: true` | 126 | لأن أعمدة `acc_name`, `acc_number`, `currency` مخفية (`trial_balance.py:485-505`). |
| `erpnext.utils.add_dimensions("Trial Balance", 6)` | 130 | يعدّل `filters` بعد التنفيذ عبر استدعاء خادم غير متزامن. |

مستند Report على `acc.dev`: `report_type=Script Report`, `ref_doctype=GL Entry`, `add_total_row=0`, `prepared_report=0`, `letter_head=None`, `add_translate_data=0`. لذلك لا صف مجموع من الخادم ولا من DataTable (`showTotalRow=false`)، والعملة تأتي من عمود `currency` المخفي في كل صف (§5.1).

### 9.2 General Ledger (`apps/erpnext/erpnext/accounts/report/general_ledger/general_ledger.js`)

| ما يستخدمه | السطر | ملاحظة |
|---|---|---|
| `reqd: 1` على `company`, `from_date`, `to_date` | 12, 25, 33 | |
| `width: "60px"` على حقول التاريخ | 26, 34 | يُمرَّر للـ control. |
| `fieldtype: "Break"` | 60-62 | يُتجاهل في `setup_filters` (`JS:539`). |
| `Autocomplete` بخيارات من `frappe.boot.party_account_types` | 64-71 | |
| `depends_on: "party_type"` و `depends_on: "eval: !doc.disable_opening_balance_calculation"` | 77, 189 | الشكلان المدعومان في `evaluate_depends_on_value`. |
| `on_change` يضبط فلاتر أخرى (`categorize_by`, `party`, `party_name`, `tax_id`) | 51-53, 68-70, 86-107 | `party_name` و `tax_id` فلاتر `hidden: 1` (113, 144) تُرسل للخادم عبر `f.value` (`JS:1494`). |
| `Select` بخيارات `{label, value}` | 116-139 | |
| `collapsible_filters: true` | 233 | يخفي ما بعد الصف الأول ويضيف زر chevron. |
| `seperate_check_filters: true` | 234 | **خطأ إملائي** — المفتاح الذي تقرؤه الصفحة `separate_check_filters` (`JS:536`). لا أثر له. |
| `erpnext.utils.add_dimensions("General Ledger", 15)` | 237 | |

لا يعرّف General Ledger `formatter` ولا `tree` ولا `get_datatable_options`؛ التنسيق كله عبر `format_cell` الافتراضي.

---

## أسئلة مفتوحة

1. **`frappe.set_route("query-report", "Balance Sheet", {...})`** (`financial_statements.js:329`): `convert_from_standard_route` (`R:416-446`) لا يعالج الوسيط الثالث لغير `List`، فكيف تصل هذه القيم إلى الفلاتر؟ لم أتتبع `make_url` (`R:459-`) بالكامل؛ يلزم اختبار عملي في المتصفح.
2. **تأثير سلسلة الوراثة على `acc.dev`:** `snd_print` يعيد تعريف `load_report` و `get_menu_items`؛ لم أقرأ الملف كاملاً لمعرفة إن كان يغيّر `get_columns_for_print`/الإجماليات. عند مقارنة إجماليات Report View بـ «الصفحة الأصلية» يجب تحديد أي نسخة هي المرجع (Frappe النقية أم المعدَّلة بتطبيقات SND).
3. **`get_data_for_csv`** (`JS:1868-1885`) غير مستدعاة في `JS`؛ لم أتحقق إن كانت تُستدعى من تطبيق آخر على الموقع.
4. **دقة `Currency` عند `currency_precision` فارغة:** الكود يستخدم 2 (`F:138`) ثم يرفعها حسب `fraction_units` للعملة إن كانت الدقة المطلوبة > 2 فقط. لم أتحقق من قيمة `fraction_units` لعملة `YER` على الموقع ولا من سلوك `format_number` مع `#,###.##` عندما تكون القيمة بثلاثة كسور.
5. **`frappe.meta.get_field_currency` و `cur_frm`:** إذا فُتح تقرير في نفس الجلسة بعد نموذج فيه حقل `company`، فهل يمكن أن يتسرب `cur_frm.doc` إلى تنسيق عملة صفوف بلا `currency`؟ الكود يسمح بذلك (`meta.js:297`, `meta.js:321-322`) لكن `pageview.js:106` يصفّر `cur_frm` عند عرض Page؛ لم أختبره.
6. **صف المجموع في الشجرة:** الخادم يضيف صف مجموع بـ `add_total_row(..., is_tree, parent_field)` (`Q:126-127`) لكن الواجهة لا تعرض `showTotalRow` للشجرة وتترك الصف ضمن البيانات (`JS:1101-1104`). كيف يظهر هذا الصف في DataTable الشجري (بأي `indent`)؟ يحتاج تجربة على تقرير شجري مع `add_total_row=1`.
7. **حد `max_report_rows`** يُطبَّق في المتصفح فقط بعد وصول كل البيانات (`JS:1091`)؛ لم أجد في هذا الملف تقسيماً للصفحات أو تدفقاً، ولم أتحقق من الخادم في هذا المحور (المحور أ).
8. **الفلاتر المخفية بـ `depends_on`** تبقى تُرسل للخادم إن كانت لها قيمة (§2.3)؛ لم أتحقق من أن `filter.set_value(df.default || null)` (`JS:497`) يعمل لكل أنواع الـ controls (خصوصاً MultiSelectList).
