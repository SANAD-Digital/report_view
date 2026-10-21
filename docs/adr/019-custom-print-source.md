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
- PDF: `report_view.api.pdf.pages_pdf_custom(print_format, html, title)` بآلية `_pdf` نفسها (المهام، الحجم، الحدود)، وحارسه `guard_custom_format`.

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

## عقد الواجهة (API)
| الدالة | الطريقة | المعاملات | يعيد |
|---|---|---|---|
| `report_view.api.custom_print.formats` | GET | — | `[name]` القوالب المخصصة المتاحة |
| `report_view.api.custom_print.stage` | POST | `print_format`, `data` (JSON ≤ 5MB)، `title`, `letter_head`, `lang`, `heading`, `signature` | `{token, route}` |
| `report_view.api.custom_print.staged` | GET | `token` | `{print_format, data, title, options}` (لمالكه فقط) |
| `report_view.api.custom_print.get_options` | GET | `print_format`, `company` | خيارات الصفحات (القوالب، الترويسات، رؤوس الطباعة، التوقيعات، اللغات، الافتراضيات، الحدود، الشركة) |
| `report_view.api.custom_print.render` | POST | `print_format`, `data` أو `token`, `title`, `lang` | `{name, type: "Jinja", html, css, title}` |
| `report_view.api.custom_print.render_letterhead` | GET | `print_format`, `letterhead`, `company` | `{header, footer}` |
| `report_view.api.custom_print.render_heading` | POST | `print_format`, `heading`, `data`/`token`, `title`, `lang` | `{name, title, html}` |
| `report_view.api.custom_print.render_signature` | POST | `print_format`, `signature`, `data`/`token`, `title`, `lang` | `{name, type, html, css}` |
| `report_view.api.custom_print.get_translations` | POST | `print_format`, `lang`, `messages` | `{msgid: ترجمة}` |
| `report_view.api.pdf.pages_pdf_custom` | POST | `print_format`, `html` أو `html_gz`, `title` | ملف PDF أو `{job, total}` |

في المتصفح: `report_view.print(opts) → Promise<url>`، `report_view.print_table(opts)`، `report_view.print_url({print_format, method, args, …})`، `report_view.open_print(url, {new_window})`. في بايثون: `report_view.core.custom_print.print_url(print_format, data=None, title=None, method=None, args=None, absolute=False, **options)`.

## العواقب
- أي صفحة أو تطبيق يطبع بياناته بقالب واحد مكتوب مرة، بكل ما في محرك الصفحات وPDF نفسه، بلا كود طباعة خاص.
- دالة البيانات يجب أن تقبل GET (`@frappe.whitelist(methods=["GET"])` مستحسن)؛ دالة مقيدة بـ POST لا تصلح مصدراً للرابط. دالة تقبل كل الطرق وتعدّل البيانات ثم تُثبّت بنفسها (`frappe.db.commit`) خطأ في تلك الدالة، لا في هذا المصدر.
- البيانات المرحّلة في redis ساعة واحدة؛ رابط الرمز لا يُشارك (لمالكه فقط). الرابط القابل للمشاركة هو رابط الدالة.
- `select` على Print Format يكفي للطباعة بقالب مخصص؛ تقييد قالب بأدوار يحتاج قراراً لاحقاً (مثلاً حقل أدوار بـ Custom Field).
