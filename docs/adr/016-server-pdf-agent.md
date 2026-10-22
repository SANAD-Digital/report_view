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

## التقارير الطويلة (2026-10-13)
- **Chromium خاص بالمحرك**: `chromium-rv/chrome-headless-shell-linux64/chrome-headless-shell` في مجلد الـ bench (نسخة 153، أو المسار في `report_view_chromium_path` في `common_site_config.json`). لا يمس Chromium الذي يستعمله Frappe لطباعته؛ إن غاب يرجع المحرك إلى Chromium الخاص بـ Frappe.
- **دفعات**: الصفحات تُقسم إلى مستندات من 40 ورقة (الرأس والأنماط نفسها)، تُطبع 3 في وقت واحد ثم تُدمج بـ pypdf في مرور واحد. العنوان يُكتب في `<title>` قبل الطباعة فلا يُنسخ الملف مرة أخرى.
- **مهمة في الخلفية**: أكثر من 40 ورقة → مهمة في طابور `long` (مهلة 900 ث)؛ المتصفح يسأل عن التقدم كل ثانية (`pages_pdf_status`) ثم ينزّل الملف (`pages_pdf_download`، يُحذف بعد التنزيل أو بعد ساعة). المهمة وملفاتها لصاحبها فقط.
- **أنماط الصفحة المستعملة فقط**: المتصفح يرسل القواعد التي تطابق عناصر عينة من الأوراق.
- **PDF بلا وسوم وبلا روابط**: `generateTaggedPDF` مطفأ (بنية لكل خلية تكلف وقتاً وذاكرة). والروابط تُحذف من نسخة المحرك قبل الطباعة: صفحة التقرير فيها نحو 200 رابط (حساب، سند، طرف) جعلت الملف أكبر ست مرات والدمج بطيئاً، وهي تفتح صفحات Desk تحتاج دخولاً. شكل الرابط يبقى بقاعدة بلا وزن (`:where`) في أول الصفحة.
- **الطلب مضغوط**: المتصفح يرسل الصفحات gzip ملفاً (`html_gz`) بـ `CompressionStream` (عُشر الحجم؛ النص العربي في حقل نموذج يأخذ ثلاثة أضعاف بايتاته). الخادم يفك حتى `MAX_HTML_BYTES` فقط (لا قنبلة ضغط). متصفح بلا `CompressionStream` يرسل الحقل `html` كما كان.
- خطأ في طباعة المتصفح لأكثر من 16 صفحة (أوراق فارغة) سببه حذف الأوراق "الزائدة" أثناء الطباعة؛ أُصلح (`trim_filled` لا يعمل أثناء `printing`).

القياس (دفتر الأستاذ، acc.dev، عبر الموقع، من الإرسال حتى التنزيل):

| الصفحات | قبل | بعد | حجم الطلب | حجم الملف |
|---|---|---|---|---|
| 60 | 25.6 ث | 10 ث | — | 1 ميغابايت |
| 180 | 65.7 ث | 19–29 ث | 291 كيلوبايت (من 6.2 ميغابايت) | 3 ميغابايت (من 17.8) |
| 600 | 206 ث (وطلب يُرفض 413) | 61 ث | 937 كيلوبايت (من 20.5 ميغابايت) | 10 ميغابايت (من 60) |

المطابقة مع طباعة المتصفح بعد كل ذلك: قيد يومية 0%، دفتر الأستاذ 13 صفحة 0% (أقصى 0.0002%)، كشف حساب عميل 9 صفحات 0% (صفحة واحدة 0.04%).

## التشغيل في الإنتاج (2026-10-20)
بعد مراجعة الجاهزية (عمليات Chromium يتيمة، لا حد للتزامن، مهام عالقة). هذا القسم يحل محل الأرقام السابقة حيث تختلف.

- **عمر Chromium**: يبدأ في جلسة (مجموعة عمليات) خاصة به (`start_new_session`) ومعه `prctl(PR_SET_PDEATHSIG, SIGKILL)` (عبر `preexec_fn` و`ctypes`)، فيموت إذا قُتل العامل الذي شغّله (مهلة gunicorn، مهلة RQ، OOM، إعادة تشغيل). الإغلاق يرسل SIGTERM ثم SIGKILL للمجموعة كلها ويحذف الملف الشخصي. الملفات الشخصية في `<bench>/tmp/rv-chromium-*` (مجلد واحد لكل العمال مهما كان `TMPDIR`)، وفي كل منها `rv-owner` (رقم العملية التي شغّلته ووقت بدئها).
- **المهل**: طلب متزامن 60 ثانية كلها (منها حتى 10 ثوانٍ انتظاراً لمحرك)، أقل بوضوح من `-t 120` في gunicorn. المهمة: مهلة RQ ‏900 ثانية (`JOB_TIMEOUT`)، وميزانيتها داخلها 840 ثانية (منها حتى 240 انتظاراً لمحرك)، والباقي لحفظ الملف والحالة. عند انتهاء المهلة أو الإلغاء أو فشل دفعة تتوقف كل الدفعات خلال ثانية (`abort`).
- **حد التزامن**: `report_view_pdf_slots` في `common_site_config.json` (الافتراضي 2) خانات على مستوى الـ bench كله في redis (`SET NX EX` بانتهاء = المهلة + 30 ث؛ خانة صاحبها عملية منتهية على المضيف نفسه تُسترد فوراً). الطلب المتزامن ينتظر حتى 10 ثوانٍ ثم يرد `RVPdfBusy` (HTTP 429) برسالة مترجمة «المحرك مشغول، حاول بعد دقيقة». **مهمة واحدة لكل مستخدم**: مهمة ثانية أثناء الأولى تُرفض بـ `RVPdfBusy`.
- **حدود المدخلات**: HTML بلا أوراق `.rv-page` يُرفض (`RVInvalidInput`) بدل طباعته؛ `pageRanges = 1-(الحد+1)` في `printToPDF` فلا يطبع Chromium أكثر من صفحة واحدة فوق `print_max_pages`؛ جسم أكبر من 4 ميغابايت يذهب إلى مهمة مهما كان عدد أوراقه.
- **الشبكة**: فوق اعتراض `Fetch`، لا شبكة لـ Chromium أصلاً: `--proxy-server=127.0.0.1:9` مع `--proxy-bypass-list=<-loopback>`، و`--host-resolver-rules=MAP * ~NOTFOUND`، و`--disable-features=NetworkPrediction,Prerender2,SpeculationRules,IsolateOrigins,site-per-process,…` مع `--disable-site-isolation-trials` (كل الإطارات في عملية الصفحة)، و`Target.setAutoAttach` (‏`waitForDebuggerOnStart`) يطبق الاعتراض وتعطيل السكربتات على أي إطار أو عامل يحصل على هدف خاص به. مستند `data:` (إطار) محجوب. اختبار `test_no_request_leaves_the_engine` يعيد فحص الـ SSRF من المراجعة (16 متجهاً، مستمع محلي يجب ألا يصله اتصال).
- **حالة المهمة** (`pages_pdf_status`): الحقول القديمة كما هي (`state` ∈ queued/running/done/failed، `done`، `total`، `error`) وأضيف: `stage` (queued: تنتظر عاملاً، waiting: تنتظر محركاً، rendering، done، failed، cancelled)، `error_code` (timeout، limit، busy، lost، no_worker، cancelled، failed)، `updated_at`، `seconds_since_update`، `cancellable`، `downloadable`. المهمة تكتب نبضاً كل ثانيتين؛ تُعلن `failed/lost` إذا فشلت مهمة RQ أو أوقفت، أو لم تنبض 60 ثانية، و`no_worker` إذا بقيت في الطابور 120 ثانية بلا عامل يخدمه. نص الخطأ يُترجم عند السؤال بلغة المستخدم، والخطأ الحقيقي في Error Log فقط (لا تفاصيل CDP للمستخدم). المهمة الملغاة تُقرأ `state = failed` مع `error_code = cancelled` حتى تتوقف الصفحات القديمة عن السؤال.
- **الإلغاء** (`pages_pdf_cancel`، POST، لصاحب المهمة فقط): مهمة في الطابور لا تبدأ، والجارية تتوقف خلال ثوانٍ، والمنتهية يُحذف ملفها. الرد بشكل `pages_pdf_status`.
- **التنزيل**: الملف لا يُحذف عند التنزيل (تنزيل منقطع يُعاد)؛ يبقى حتى ساعة من إنشائه أو حتى الإلغاء.
- **التنظيف كل ساعة**: `report_view.core.pdf.cleanup_stale` في `scheduler_events["hourly"]` في hooks.py: يقتل عمليات Chromium الخاصة بالمحرك الأقدم من 960 ثانية وصاحبها غير موجود (مع مجموعتها)، ويحذف الملفات الشخصية التي لا تستعملها عملية حية وصاحبها غير موجود أو أقدم من ذلك (وفي مجلد النظام المؤقت أيضاً، حيث كانت سابقاً)، وملفات المهام في `private/rv_pdf` الأقدم من ساعة.
- **طابور خاص**: `report_view_pdf_queue` في إعدادات الموقع (الافتراضي `long`). في الإنتاج يُعرّف طابور وعامله، وعدد العمال = عدد الخانات:
  ```json
  // common_site_config.json
  "workers": {"rv_pdf": {"timeout": 900, "background_workers": 2}},
  "report_view_pdf_queue": "rv_pdf",
  "report_view_pdf_slots": 2
  ```
  ثم `bench setup supervisor` (أو `bench worker --queue rv_pdf` في التطوير). اسم طابور غير معرّف في `workers` يُسجَّل تحذيراً ويرجع إلى `long`.
- **Chromium الاحتياطي**: لا نستعمل `ChromePDFGenerator` ولا دواله الخاصة بعد الآن: إن غاب `chromium-rv` يؤخذ مسار Chromium الخاص بـ Frappe بدالته العامة `find_or_download_chromium_executable` ويُشغَّل بالطريقة نفسها أعلاه، مع تحذير في `logs/report_view.log` مرة لكل عملية. الاعتماد الوحيد الباقي على Frappe هو `CDPSocketClient`.
- **التثبيت**: `apps/report_view/scripts/install_chromium.sh` ينزّل Chrome for Testing `chrome-headless-shell` ‏153.0.8010.12 (مثبت بـ SHA-256 للأرشيف وللملف) إلى `<bench>/chromium-rv`، ويتحقق منه، ويطبع حزم apt المطلوبة؛ لا يفعل شيئاً إن كانت النسخة نفسها موجودة، ولا يستبدل نسخة أخرى إلا بـ `--force`.
- **ما بقي**: `--no-sandbox` باقٍ (`kernel.apparmor_restrict_unprivileged_userns = 1`): حذفه يحتاج ملف AppArmor لـ `chrome-headless-shell` أو تشغيل المحرك بمستخدم نظام لا يقرأ `site_config.json`.

## تعديل (2026-10-21): تثبيت Chromium مع التطبيق
- Chromium الخاص بنا (Chrome for Testing «chrome-headless-shell»، نحو 260MB، Linux x86-64 فقط) **لا يُخزَّن في المستودع**، بل يُنزَّل مع التثبيت إلى `<bench>/chromium-rv` بالسكربت المثبَّت الإصدار والبصمة `scripts/install_chromium.sh` (مصدر رقم الإصدار الوحيد).
- hooks جديدة: `after_install` و `after_migrate` → `report_view.install` → `core/chromium.ensure()`: يثبّته إن غاب أو كان إصدار آخر، ولا يُفشل التثبيت أبداً (يسجّل تحذيراً، ويبقى PDF على Chromium الخاص بـ Frappe). مسار يحدده الموقع (`report_view_chromium_path`) يُترك كما هو. التثبيت واحد في كل مرة على الـbench (قفل ملف).
- أمر bench: `bench report-view-install-chromium [--force]` (لا يحتاج `--site`).
- في `Report View Global Settings`: قسم «محرك PDF» يعرض الحالة (مثبت بالإصدار المعتمد / إصدار آخر / غير مثبت والبديل مستعمل) وزر تثبيت يعمل في الخلفية على طابور `long` (System Manager فقط، `api/chromium.py`).
- حزم النظام (libnss3 وغيرها) لا تُثبَّت تلقائياً (تحتاج sudo)؛ السكربت يطبع أمر `apt-get` كاملاً.

## تعديل (2026-10-22): التثبيت لا يوقف migrate، وحالته للـ bench كله
- `after_install` (`report_view.install.after_install`) يثبّت Chromium في الحال (`core/chromium.ensure()`) بحد أقصى 300 ث (`INSTALL_APP_TIMEOUT`)، وبعد فحص اتصال بمصدر التنزيل (`reachable()`). إذا تعذّر الاتصال لا ينتظر: يسجّل تحذيراً ويطبع الأمر اليدوي، ويبقى PDF على Chromium الخاص بـ Frappe.
- `after_migrate` (`report_view.install.after_migrate`) **لا يثبّت أبداً في الحال**: `core/chromium.ensure_in_background()` يضع وظيفة `install_job` على طابور `long` (معرّف ثابت `deduplicate=True`، وظيفة واحدة للـ bench) إن كان التثبيت لازماً. إذا لم يرد Redis لا يضعها (كان `frappe.enqueue` سيشغّلها داخل migrate) ويسجّل الأمر اليدوي فقط.
- الحالة للـ bench كله، لا للموقع: قفل ملف (`flock`) يمنع تثبيتين معاً، وملف آخر نتيجة (`rv-chromium-install.last.json`)، كلاهما في `<bench>/tmp`. كل المواقع ترى الحالة نفسها في «محرك PDF» في `Report View Global Settings`.
- الدالتان تستدعيان أيضاً `core/letterhead.check_pdf_body_html_hook()`: hook `pdf_body_html` يفوز فيه آخر تطبيق مثبّت، فإن غلب تطبيق آخر hook التطبيق يُسجَّل تحذير بأن هوامش ورق الشركة المبني بالمنشئ في wkhtmltopdf لن تُضاف ما لم يستدعِ ذلك التطبيق الـ hook السابق (ADR-018).
- السجل الكامل للـ hooks في ADR-007.

