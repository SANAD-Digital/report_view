# ADR-019: مصدر طباعة «مخصص» — قالب طباعة تأتيه بياناته من المتصل

- الحالة: مقبول
- التاريخ: 2026-10-21

## السياق
- طلب صاحب المشروع (2026-10-21): «أطبع من أماكن غير التقارير والمستندات: صفحات Desk، قوالب HTML، جداول، بيانات تأتي من أماكن أخرى. أريد أن أرسل لك البيانات واسم القالب، فتفتح صفحة الطباعة وتعرض البيانات بذلك القالب. أضف نوعاً إلى `print_format_for` في Print Format اسمه Custom: مثل بقية القوالب، لكن بياناته من API أو دالة».
- `print_format_for` في Frappe خياران: DocType (قالب لمستند، يرندره `get_html_and_style`) و Report (قالب JS لتقرير). لا مكان لقالب بلا مستند ولا تقرير.
- محرك الصفحات (ADR-014/015/016) ووضع المستند (ADR-017) لا يحتاجان إلا «مضيفاً» يعطيهما HTML القالب والترويسة ورأس الطباعة والتوقيع والترجمات وهدف PDF.

## القرار
### الخيار الثالث «Custom»
- Property Setter مشحون (`fixtures/property_setter.json`، الاسم `Print Format-print_format_for-options`) يجعل الخيارات `DocType\nReport\nCustom`. لا تعديل في Frappe.
- القالب المخصص **HTML و CSS فقط** (توضيح صاحب المشروع 2026-10-21): حقل `html` (HTML مع Jinja للبيانات) وحقل `css`، ولا شيء غيرهما؛ لا منشئ قوالب ولا JS ولا طباعة خام.
- `doc_events` على Print Format: `before_validate` = `report_view.core.custom_print.before_validate_print_format`: القالب المخصص `custom_format=1`، `standard="No"`، `print_format_type="Jinja"`، `raw_printing=0`، بلا `doc_type` ولا `report` (والوحدة «Report View» إن لم تُحدد). فحص Frappe نفسه (`validate`) يطلب حينها HTML ويتحقق من صحة Jinja.
- قالب مشحون «Report View Table» (`fixtures/print_format.json`): جدول منسّق بـ `frappe.format` لكل عمود، صفوف كائنات أو قوائم، إجمالي اختياري، وألوانه من لوحة الورق (`--pp-*`) فيتبع مظهر الصفحات.
- التثبيت على acc.dev بلا migrate: `bench --site acc.dev.sanad.digital import-doc apps/report_view/report_view/fixtures/property_setter.json` ثم `… print_format.json`.

### من يطبع بالقالب
- `guard_custom_format(name)` أول سطر في كل دالة: صلاحية **select** على Print Format (Frappe يعطيها لكل Desk User، وبها تُعرض قوالب المستندات لهم؛ `read` لا يملكها إلا System Manager)، ثم القالب بـ `frappe.get_list`: موجود، غير معطّل، `print_format_for = Custom`. غير ذلك: `PermissionError` أو `DoesNotExistError`.
- القالب لا يرى إلا ما أُرسل له، ونصوص البيانات كلها `printing.Text` (تُطبع مهرّبة). ما يجلبه القالب بنفسه بدوال Jinja (`frappe.get_list` …) يخضع لصلاحيات المستخدم كما في أي قالب طباعة؛ كاتب القالب من يملك write على Print Format (System Manager).

### طريقتا إرسال البيانات
1. **بيانات مباشرة**: `report_view.print({print_format, data, title, …})` ← `stage` يحفظ البيانات في redis (`frappe.cache`، المفتاح `report_view:custom_print:<token>`، ساعة واحدة، المالك = المستخدم، حد 5 ميغابايت JSON) ← المسار `/desk/rv-print/Custom/<token>`. الرمز لمالكه فقط؛ غيره يقرأ «انتهت صلاحية هذه الطباعة». من بايثون: `report_view.core.custom_print.print_url(print_format, data=…, title=…)`.
2. **بيانات من دالة**: `report_view.print({print_format, method, args})` أو الرابط `/desk/rv-print/Custom/<format>?method=…&args=<json>` (قابل للحفظ، البيانات حيّة). صفحة الطباعة تستدعي الدالة **من المتصفح** بـ `frappe.call` و **GET**: فحوص الدالة نفسها (whitelist والصلاحيات) هي التي تعمل، ولا يستدعيها Report View نيابة عن المستخدم أبداً. GET لأن Frappe لا يُثبّت (commit) شيئاً في طلبات GET، والدوال المعدِّلة المقيدة بـ POST ترفضه: رابط مصنوع لا يغيّر بيانات. ثم تُرحَّل النتيجة بـ `stage` مرة واحدة وتُقرأ بعدها بالرمز.
- `report_view.print_table({title, columns, rows, totals})` يطبع أي جدول بالقالب «Report View Table» بلا كتابة قالب.

### الرندرة
- `render` يرندر HTML القالب بـ Jinja المعزول من Frappe (`get_jenv` + `safe_render_flags`) بسياق: `data`، `doc` (البيانات إن كانت كائناً)، `rows` (القائمة أو `data.rows`)، `title`، `company` (`data.company` أو الافتراضية)، `printed_by`، `printed_on`، `lang`، `print_format`، و`filters` فارغ (لرؤوس الطباعة المشحونة). يعيد `{name, type, html, css, title}`.
- CSS القالب **محصور في المحتوى المرندر**: `scoped_css` يضعه داخل `.rv-page-flow{…}` (CSS nesting، كما تُحصر أنماط التوقيع في `.rv-signature`)، فلا يصل إلى الترويسة والتذييل وبقية الصفحة؛ `@font-face` و`@import` تبقى في الأعلى، و`@page` يُحذف (الصفحات هي الورق)، و`</style` يُزال. الصفحات تطبع هذا الـ CSS مع الأوراق، فيصل كما هو إلى PDF الخادم.
- خطأ القالب: رسالة مترجمة للمستخدم، والتفاصيل في Error Log، ورقم السطر ونوع الخطأ في developer_mode فقط. (`frappe.render_template` يضع القالب والـ traceback في الرسالة؛ لذلك لا يُستخدم هنا.)
- اللغة: `lang` (لغة مفعّلة) تُطبَّق على `frappe.local.lang` أثناء الرندرة وتعود بعدها.
- حد المعدل كـ `api._rate_limit`: `stage` 30/دقيقة، `render` ورأس الطباعة والتوقيع 60/دقيقة لكل مستخدم.

### صفحة الطباعة
- `rv-print` نفسها: المسار الثاني `Custom` يجعلها في «الوضع المخصص» (`CustomPrintHost` في `doc_print.js`) بمحرك الصفحات نفسه وشريط أدواته (الورق، الترويسة، رأس الطباعة، التوقيع، الترقيم، الحدود، العلامة المائية، التكبير، الطباعة، PDF). وضع المستند لم يتغير؛ الانتقال بين الوضعين يبني الصفحات من جديد.
- قائمة القوالب: القوالب المخصصة فقط؛ تغيير القالب يرندر البيانات نفسها. الترويسة تُرندر بـ `doc = {company}`. التوقيعات: من نوع Document للكل (بلا نوع مستند). الإعدادات تُحفظ لكل مستخدم وقالب (`Report View Print:Custom:<format>`) ويغلبها قالب المتصل واختياراته (`letter_head`، `heading`، `signature`، `lang`).
- PDF: `report_view.api.pdf.pages_pdf_custom(print_format=None, html, title, token=None)` بآلية `_pdf` نفسها (المهام، الحجم، الحدود)، وحارسه `resolve`: القالب المحفوظ (`guard_custom_format`)، أو الرمز لمالكه للقالب المرسل (القسم «القالب المرسل» أدناه).

### نموذج Print Format
- `public/js/print_format_form.js` (عبر `doctype_js`): عند Custom يبقى حقلا HTML و CSS، وتُخفى حقول المستند والتقرير ونوع القالب (JS) والطباعة الخام و`format_data` والقيمة المطلقة والهوامش والخطوط ورقم الصفحة ومولّد PDF واللغة الافتراضية والوحدة و«قياسي» (زر «Edit Format» لا يظهر لأن `custom_format=1`)، وتظهر لوحة مساعدة بلغة المستخدم (متغيرات السياق وأمثلة جاهزة للنسخ)، وزر «معاينة ببيانات تجريبية» يفتح نافذة فيها حقل Code بـ JSON قابل للتعديل ثم يفتح الطباعة في تبويب.

### الـ hooks المضافة
```python
fixtures = [..., {"dt": "Property Setter", "filters": [["name", "in", ["Print Format-print_format_for-options"]]]},
                 {"dt": "Print Format", "filters": [["name", "in", ["Report View Table"]]]}]
doc_events = {"Print Format": {"before_validate": "report_view.core.custom_print.before_validate_print_format"}}
doctype_js = {..., "Print Format": "public/js/print_format_form.js"}
```
ويستورد `report_view_entry.bundle.js` (المحمّل في كل Desk) ملف `custom_print.js` الصغير ليوجد `report_view.print` في كل صفحة.

## تعديل (2026-10-21): قالب مرسل مع البيانات (html + css)
- طلب صاحب المشروع: «أضف html و css إلى `report_view.print({...})`: الخيار إمّا قالب (`print_format`) أو html + css».
- **إمّا أو**: `print_format` و`html` لا يجتمعان ولا يغيبان معاً (رسالة مترجمة) في `report_view.print`، `report_view.print_url`، و`core.custom_print.print_url(..., html=None, css=None)`.
- **الترحيل**: القالب المرسل يُرحَّل مع بياناته (`stage(html=…, css=…)`: html ≤ 200 KB و css ≤ 100 KB، ويُترجم مرة عند الترحيل فيُعرف خطؤه مبكراً). رابط الدالة لا يحمل قالباً مرسلاً: مع `method` تستدعي الصفحة المتصلة الدالة بنفسها (GET) ثم ترحّل القالب والبيانات وتفتح رابط الرمز.
- **الأمان — بيئة معزولة خاصة**: القالب المرسل يأتي من المتصفح، فلا يُرندر ببيئة Jinja الخاصة بـ Frappe (فيها `frappe.db.get_value` وأمثالها تقرأ أي سجل بلا فحص صلاحية). يُرندر في `jinja2.sandbox.ImmutableSandboxedEnvironment` بلا loader (فـ `include`/`import`/`extends` تفشل) وبلا أي globals؛ السياق وحده: `data`، `doc`، `rows`، `title`، `company` (اسم)، `printed_by`، `printed_on`، `lang`، `_()` (الترجمة)، `format_value(value, fieldtype, options)` (تنسيق Frappe على حقل عادي: أرقام وتواريخ وعملة برمز من ثلاثة أحرف، بلا مستند ولا بحث روابط)، و`range()` (مجموع عناصره في الرندرة الواحدة ≤ 100000)، مع مرشّحات Jinja القياسية. لا `frappe` ولا قاعدة بيانات ولا `get_doc`/`get_list`؛ السمات الخاصة (`__class__` …) يمنعها الصندوق، و`.__` في القالب مرفوض، والبيئة الثابتة تمنع تعديل القوائم والقواميس. `None` يُطبع فارغاً. نصوص البيانات تبقى `Text` (مهرّبة). أخطاء القالب كما في القوالب المحفوظة: رسالة مترجمة، والتفاصيل في developer_mode فقط.
- القوالب **المحفوظة** تبقى ببيئة Frappe كما هي (يكتبها من يملك write على Print Format).
- **الصلاحية**: أي مستخدم Desk (System User) يطبع قالباً مرسلاً بلا صلاحية على Print Format؛ الرمز لمالكه فقط؛ حدود المعدل كما في `stage`/`render`.
- **الواجهات**: `resolve(print_format, token)` أول سطر في كل دالة: قالب محفوظ مسمّى، وإلا قالب الطباعة المرحّلة (محفوظ أو مرسل). لذلك `print_format` صار اختيارياً في `get_options`، `render`، `render_letterhead`، `render_heading`، `render_signature`، `get_translations`، ومعها `token`. `staged` يعيد `inline: true` و`print_format: null` (القالب نفسه لا يعود للمتصفح). `render` لقالب مرسل يعيد `{name: "", type, html, css (محصور), title, inline: true}`. `pages_pdf_custom(print_format=None, html, title, token=None)`: حارسه القالب المحفوظ، أو الرمز لمالكه للقالب المرسل.
- **صفحة الطباعة**: منتقي القوالب يعرض القالب المرسل اختياراً حالياً («القالب المرسل»، القيمة الفارغة)، ويمكن الانتقال إلى قالب مخصص محفوظ (البيانات نفسها) والعودة. الإعدادات تحت `Report View Print:Custom:Sent template`. الإعدادات المسبقة (ADR-020): السياق Custom بهدف فارغ — الإعدادات العامة لكل القوالب المخصصة؛ `guard_target` يقبل الهدف الفارغ لـ Custom بحارس القالب المرسل (`guard_inline`)، فتظهر القائمة للقالب المرسل (اختبار `test_a_sent_template_offers_the_general_custom_presets`).

## عقد الواجهة (API)
| الدالة | الطريقة | المعاملات | يعيد |
|---|---|---|---|
| `report_view.api.custom_print.formats` | GET | — | `[name]` القوالب المخصصة المتاحة |
| `report_view.api.custom_print.stage` | POST | `print_format` **أو** `html` (≤ 200KB) + `css` (≤ 100KB)، `data` (JSON ≤ 5MB)، `title`, `letter_head`, `lang`, `heading`, `signature` | `{token, route}` |
| `report_view.api.custom_print.staged` | GET | `token` | `{print_format, inline, data, title, options}` (لمالكه فقط) |
| `report_view.api.custom_print.get_options` | GET | `print_format`, `company` | خيارات الصفحات (القوالب، الترويسات، رؤوس الطباعة، التوقيعات، اللغات، الافتراضيات، الحدود، الشركة) |
| `report_view.api.custom_print.render` | POST | `print_format`, `data` أو `token`, `title`, `lang` | `{name, type: "Jinja", html, css, title}` |
| `report_view.api.custom_print.render_letterhead` | GET | `print_format`, `letterhead`, `company` | `{header, footer}` |
| `report_view.api.custom_print.render_heading` | POST | `print_format`, `heading`, `data`/`token`, `title`, `lang` | `{name, title, html}` |
| `report_view.api.custom_print.render_signature` | POST | `print_format`, `signature`, `data`/`token`, `title`, `lang` | `{name, type, html, css}` |
| `report_view.api.custom_print.get_translations` | POST | `print_format`, `lang`, `messages` | `{msgid: ترجمة}` |
| `report_view.api.pdf.pages_pdf_custom` | POST | `print_format`, `html` أو `html_gz`, `title` | ملف PDF أو `{job, total}` |

بقية الدوال تقبل `token` بدل `print_format` لطباعة بقالب مرسل.

في المتصفح: `report_view.print(opts) → Promise<url>` (`opts`: `print_format` أو `html` + `css`)، `report_view.print_table(opts)`، `report_view.print_url({print_format, method, args, …})`، `report_view.open_print(url, {open_in})`. في بايثون: `report_view.core.custom_print.print_url(print_format=None, data=None, title=None, method=None, args=None, absolute=False, html=None, css=None, **options)`.

## العواقب
- أي صفحة أو تطبيق يطبع بياناته بقالب واحد مكتوب مرة، بكل ما في محرك الصفحات وPDF نفسه، بلا كود طباعة خاص.
- دالة البيانات يجب أن تقبل GET (`@frappe.whitelist(methods=["GET"])` مستحسن)؛ دالة مقيدة بـ POST لا تصلح مصدراً للرابط. دالة تقبل كل الطرق وتعدّل البيانات ثم تُثبّت بنفسها (`frappe.db.commit`) خطأ في تلك الدالة، لا في هذا المصدر.
- البيانات المرحّلة في redis ساعة واحدة؛ رابط الرمز لا يُشارك (لمالكه فقط). الرابط القابل للمشاركة هو رابط الدالة.
- `select` على Print Format يكفي للطباعة بقالب مخصص؛ تقييد قالب بأدوار يحتاج قراراً لاحقاً (مثلاً حقل أدوار بـ Custom Field).

## تعديل (2026-10-21): مكان فتح الطباعة
- خيار `open_in: "same" | "tab"` في `print` و `print_table` و `open_print` (و `new_window: true` القديم = `"tab"`).
- الافتراضي حقل جديد في `Report View Global Settings`: `custom_print_open_in` (Same tab / New tab، الافتراضي Same tab).
- يجب أن يُعرف الافتراضي عند الضغطة نفسها (المتصفح يمنع تبويباً يُفتح بعد طلب)، فيصل في بيانات الإقلاع: hook جديد `extend_bootinfo = "report_view.core.settings.boot_session"` يضيف `frappe.boot.report_view = {custom_print_open_in}` فقط.

## تعديل (2026-10-22): حدود وقيود
- `render_letterhead` و `get_translations` محدودتان بـ 60 طلباً في الدقيقة لكل مستخدم كبقية الدوال.
- ورق الطباعة يُرندر لشركة يقرؤها المستخدم فقط: شركة أخرى (من `company` أو من بيانات طباعة مرحّلة) تُستبدل بشركته الافتراضية (`core.custom_print.render_letterhead`)، لأن ورق المنشئ يقرأ سجل الشركة (الرقم الضريبي والعنوان والشعار) عند الطباعة. اسم شركة غير موجود يُطبع كما هو (لا سجل يُقرأ).
- قواعد عنوان الطباعة في المتصفح (الرمز، مسار الدالة، مفاتيح الخيارات) في وحدة واحدة `public/js/report_view/custom_print_rules.js` يستوردها `custom_print.js` (و `doc_print.js`)، واختبار `tests/js/custom_print_rules.test.mjs` يطابقها بـ `_TOKEN` و `_METHOD` و `_OPTION_KEYS` في `core/custom_print.py`.

## تعديل (2026-10-27): الـ Property Setter عند التحديث وإلغاء التثبيت
- الـ Property Setter المشحون يثبّت خيارات `print_format_for` على `DocType\nReport\nCustom`. إن أضاف Frappe خياراً رابعاً في إصدار لاحق فهذا السجل يخفيه حتى يُحدَّث الملف `fixtures/property_setter.json` بالخيار الجديد. عند ترقية Frappe تُقارن خيارات الحقل في `print_format.json` الخاص بـ Frappe بهذا الملف.
- إلغاء التثبيت لا يحتاج hook: `bench remove-app` يحذف كل سجل وحدته `Report View` (`frappe/installer.py`، `_delete_linked_documents`)، والـ Property Setter وحدته `Report View` (يتحقق منه `tests/test_hooks.py`)، والقالب المخصص يأخذ الوحدة `Report View` إن لم تُحدد (`before_validate_print_format`). يبقى بعد إلغاء التثبيت قالب مخصص اختار له كاتبه وحدة أخرى: قيمة `print_format_for` فيه `Custom` ولا خيار بهذا الاسم، فلا يُطبع ولا يظهر في قوائم المستندات والتقارير، ويُحذف يدوياً.
