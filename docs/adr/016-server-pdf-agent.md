# ADR-016: وكيل PDF في الخادم يطبع صفحات المتصفح نفسها

- الحالة: مقبول
- التاريخ: 2026-10-12

## السياق
- وضع «صفحات» (ADR-014) يبني أوراق الطباعة (`.rv-page`) في المتصفح ويطبعها بـ `window.print()` بعد نقلها إلى `.rv-print-root` مع `@page{size:<w>mm <h>mm;margin:0}`. المطلوب الآن زر PDF يعطي ملفاً **مطابقاً لهذه الطباعة تماماً**، للتقارير وللمستندات.
- خطة ADR-004 (قالب Jinja في الخادم يُطبع بـ wkhtmltopdf أو chrome) تعني تخطيطاً ثانياً يختلف عن الصفحات المعروضة، وwkhtmltopdf (Qt WebKit قديم) لا يفهم CSS الصفحات الحالي.
- Frappe 16 يشحن Chromium خاصاً به (`frappe/utils/pdf_generator/`): `ChromePDFGenerator` يشغّل `headless_shell` ويعطي رابط DevTools، و`CDPSocketClient` يتكلم بروتوكول CDP عبر websocket، و`frappe.utils.pdf.get_chrome_pdf` يحرر المتصفح في `finally` بـ `_close_browser()`. Chromium موجود في `<bench>/chromium` (`find_or_download_chromium_executable`).
- اعتراض الشبكة في Frappe (`Page.intercept_request_for_local_resources`) يخدم ملفات الموقع من القرص، لكنه **يمرر إلى الشبكة** كل طلب لا يخص الموقع، ويضع كوكي الجلسة `sid` في المتصفح. هذا مقبول لقالب يكتبه الخادم، وغير مقبول لـ HTML يرسله العميل.

## الخيارات
1. قالب Jinja في الخادم (خطة ADR-004): تخطيط ثانٍ يجب أن يبقى مطابقاً للمتصفح يدوياً.
2. **المتصفح يرسل المستند النهائي** (كل CSS داخل `<style>`، الصور `data:`، الخطوط تحت `/assets/`، و`<base href>` برابط الموقع)، والخادم يطبعه بـ Chromium الخاص بـ Frappe بإعدادات طباعة Chrome نفسها.
3. مكتبة Python لقيادة Chromium (playwright أو pyppeteer): اعتماد جديد يحتاج موافقة، ولا يضيف شيئاً على ما في Frappe.
4. استخدام `get_chrome_pdf`/`Browser` كما هما: يقبلان HTML قالب Frappe (رأس وتذييل وخيارات wkhtmltopdf) ولا يسمحان بتعطيل JavaScript ولا بسياسة شبكة مغلقة.

## القرار
الخيار 2، فوق أصناف Frappe نفسها (لا مكتبة جديدة):

- `report_view/core/pdf.py`: `html_to_pdf(html, *, title=None) -> bytes` (و`render_pdf` يعيد معها الروابط المحجوبة والمخدومة).
  - **التشغيل والتحرير** كما في `get_chrome_pdf`: `ChromePDFGenerator()` ثم `add_browser(id)`، وفي `finally`: `remove_browser(id)` ثم `generator._close_browser()`. الاتصال بـ `CDPSocketClient(generator._devtools_url)`، وسياق متصفح معزول (`Target.createBrowserContext`) يُتلف بـ `Target.disposeBrowserContext` ثم `disconnect()` مهما حدث.
  - **الصفحة**: تعطيل JavaScript (`Emulation.setScriptExecutionDisabled`) ووسائط `print` واعتراض كل الطلبات (`Fetch.enable` بنمط `*`) **قبل** أي محتوى. ثم انتقال إلى جذر الموقع يُجاب بمستند فارغ من الذاكرة (لتأخذ الصفحة أصل الموقع فلا تُعامل الخطوط كطلبات من أصل آخر)، ثم `Page.setDocumentContent`، وانتظار `load` ثم `document.fonts.ready` وكل الصور (تقييم DevTools يعمل مع تعطيل سكربتات الصفحة)، ثم `Page.printToPDF` بـ `printBackground` و`preferCSSPageSize` وهوامش صفر و`displayHeaderFooter=false` و`scale=1`.
  - **العنوان**: Chromium يأخذه من `<title>`؛ إن أُرسل `title` مختلف يُكتب في بيانات الملف بـ pypdf.
- `report_view/api/pdf.py` (POST فقط):
  - `pages_pdf_report(report_name, html, title=None)`: `guard_report` ثم `guard_print` ثم الطباعة.
  - `pages_pdf_document(doctype, name, html, title=None)`: صلاحية `print` على نوع المستند ثم على المستند نفسه (`frappe.has_permission(doctype, "print", doc=doc)`)، ثم الطباعة.
  - الرد تنزيل كما في `frappe.utils.print_format.download_pdf`: `response.filename` (العنوان بعد حذف المحارف غير الصالحة)، `filecontent`، `type = "pdf"`.

## الأمان
- **لا JavaScript**: يُعطَّل قبل وضع المحتوى، فلا تعمل `<script>` ولا معالجات الأحداث.
- **سياسة الشبكة** (كل طلب يمر على `Fetch.requestPaused`، ولا شيء يخرج إلى الشبكة):
  - `data:`: يُسمح.
  - `GET` على مضيف الموقع نفسه (`frappe.utils.get_url()` ومضيف الطلب الحالي، http أو https) ومساره يبدأ بـ `/assets/` أو `/files/`: يُقرأ الملف من القرص ويُعاد (`sites/assets` بمقارنة مسار نصية لأن مداخلها روابط bench إلى مجلدات `public` للتطبيقات كما يفعل Frappe؛ و`public/files` بعد حل الروابط الرمزية). ملف غير موجود أو مسار يخرج من المجلد = محجوب.
  - كل ما سوى ذلك محجوب (`BlockedByClient`): المضيفات الأخرى، `localhost` والعناوين الداخلية، `/private/files`، `/api`، `file://`، أي طلب غير `GET`، وأي مستند (iframe) بعد المستند الفارغ الأول.
  - لا كوكي جلسة في المتصفح (لا نستعمل `Page.set_cookies` من Frappe)، فلا شيء يُطلب باسم المستخدم.
- **حدود**: حجم HTML حتى 40 ميغابايت (`RVInvalidInput`)؛ مهلة كلية 120 ثانية لكل أوامر CDP (`RVPdfTimeout` برسالة مترجمة)؛ عدد الصفحات حتى `Report View Global Settings.print_max_pages` (`RVLimitExceeded`).
- **الصلاحيات**: كما في CLAUDE.md: التقرير بـ `guard_report` و`guard_print`، والمستند بصلاحية `print` صريحة. لا نأخذ بدائل `frappe.www.printview.validate_print_permission` (صلاحية `read` وحدها، صلاحية الموقع، مفتاح المشاركة) لأن Report View يشترط `print` للطباعة.

## العواقب
- لا hook ولا مكتبة جديدة؛ اعتماد على واجهات Frappe الداخلية (`ChromePDFGenerator._set_devtools_url` و`_close_browser` و`CDPSocketClient`) كما يستعملها `get_chrome_pdf`؛ تغيّرها في إصدار لاحق يُكسر هنا ويظهر في `tests/test_pdf.py`.
- كل طلب يشغّل Chromium ويغلقه (سلوك Frappe الحالي): نحو 0.6 ث لصفحتين و1 ث لثلاثين صفحة على acc.dev (التشغيل البارد الأول نحو 1.8 ث).
- حجم الطلب: HTML بصور `data:` قد يتجاوز حد حجم الطلب في nginx/Frappe قبل حدنا (40 ميغابايت)؛ يُضبط حد الخادم إن لزم.
- ADR-004 (قالب Jinja للـ PDF) لم يعد طريق PDF الصفحات؛ المطابقة مع طباعة المتصفح مضمونة لأن التخطيط واحد.

## ملاحظة التكامل (2026-10-12)
- سمات `<html>` و`<body>` تُنسخ إلى المستند المرسل كما هي: تطبيق على الموقع (`snd_utilities`) يضع خط الطباعة في متغير مضمّن على `<html>` (`--snd-font-family`)؛ دونه رسم الخادم العربية بخط احتياطي (DejaVu) فاختلف التفاف الخلايا.
- مقارنة بكسل ببكسل لـ PDF الخادم مع طباعة المتصفح: نفس عدد الصفحات ومقاسها وتقطيع الصفوف (قيد يومية 1/1، ميزان المراجعة 2/2، دفتر الأستاذ 26/26)؛ الفرق 0.7–7% من البكسلات، من تنعيم الحروف وتباعد الأرقام اللاتينية بين نسختي Chromium.

## حجم الطلب (2026-10-12)
- الحدود: nginx `client_max_body_size 50m`، وFrappe `max_file_size` (افتراضياً 25 ميغابايت) لكل طلب.
- كان المستند المرسل يدمج كل أنماط Desk نصاً (1.5 ميغابايت ثابتة) وصورة الترويسة في كل صفحة. الآن ما يقرؤه المحرك من ملفات الموقع العامة بنفسه (`/assets`، `/files`) يُرسل رابطاً بترتيبه في الصفحة: ملفات الأنماط، الصور العامة، الخطوط. يُدمج فقط ما لا يصل إليه: كتل `<style>` الخاصة بالصفحة، والصور الخاصة (data: مرة واحدة كمتغير CSS تقرؤه صور الصفحات بـ `content`).
- القياس: قيد يومية 1600 ← 55 كيلوبايت؛ دفتر الأستاذ 26 صفحة 2967 ← 534 كيلوبايت (نحو 20 كيلوبايت للصفحة، فحد 600 صفحة نحو 12 ميغابايت). المطابقة مع طباعة المتصفح لم تتغير.

## نسخة Chromium (2026-10-12)
- مقارنة من مستند واحد متطابق (كشف حساب عميل، 6 صفحات، إطار مزدوج وعلامة مائية): Chromium 153 بقواعد المحرك نفسها = طباعة المتصفح **بفرق 0%** في كل الصفحات؛ Chromium 133 الذي يشحنه Frappe = فرق 3.4–5.8% (تباعد الحروف اللاتينية والأرقام، ويُضمّن الخط Type3).
- الفرق إذن من نسخة Chromium على الخادم لا من المستند أو الكود. Frappe يقبل `chromium_path` في `common_site_config.json` لاختيار ملف Chromium.
- `/assets/` تُخدم من قرص الـ bench أياً كان المضيف في الرابط (ملفات الـ bench المبنية نفسها، بلا شبكة)؛ `/files/` لهذا الموقع فقط.
