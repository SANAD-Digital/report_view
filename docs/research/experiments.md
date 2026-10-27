# المحور هـ — ثلاث تجارب حاسمة (PDF عربي، Excel RTL، حجم أكبر تقرير)

> **ملاحظة (2026-10-27):** الأدلة الخام المذكورة هنا (`docs/research/artifacts/` و `tests/experiments/`) حُذفت من المستودع العام لأنها مخرجات تشغيل على موقع التطوير؛ هي باقية في تاريخ git قبل commit التنظيف.

- التاريخ: 2026-09-30
- الـ bench: `<bench>` — frappe 16.28.0، erpnext 16.29.0، Python 3.14.7 (`env/bin/python`)
- الموقع: `$SITE` (خادم الويب يعطي 500؛ كل التجارب نُفّذت بسكربتات مباشرة عبر `frappe.init` + `frappe.connect`، قراءة فقط، مع `frappe.db.rollback()` في النهاية)
- الملفات الناتجة: `<bench>/apps/report_view/docs/research/artifacts/`
- السكربتات المؤقتة: `/tmp/claude-1001/-home-snd-frappe-bench-apps-report-view/80b6fc89-9d79-4ce6-8bf4-88166e120282/scratchpad/` (`exp1_wk.py`, `exp1_chrome.py`, `exp2_xlsx.py`, `exp3_survey.py`, `exp3_run.py`, `arabic_table.html`)

## 0. الأدوات المتاحة فعلاً على الخادم

| الأداة | الحالة |
|---|---|
| `wkhtmltopdf` | `/usr/local/bin/wkhtmltopdf` — الإصدار `0.12.6.1 (with patched qt)` |
| Chromium للمولّد chrome | موجود مسبقاً في `<bench>/chromium/chrome-linux/headless_shell` — `Google Chrome for Testing 133.0.6943.35` (تاريخ المجلد 2026-05-11) |
| `pdftoppm` / `pdftocairo` / `gs` / ImageMagick | غير مثبتة |
| `soffice` / `libreoffice` | غير مثبتة |
| مكتبات Python في env الـ bench | `pypdfium2` و `PyMuPDF 1.28.0` و `pypdf` و `pdfplumber` و `PIL` متاحة (استُخدم `pypdfium2` لتحويل الصفحة الأولى إلى PNG)؛ `openpyxl 3.1.5`؛ `xlsxwriter` أيضاً |
| الخطوط (`fc-list`) | 8 ملفات فقط، كلها عائلة DejaVu (`DejaVu Sans`, `DejaVu Sans Bold`, `DejaVu Sans Mono`, `DejaVu Serif`). `fc-list :lang=ar` يعيد `DejaVuSans.ttf` و `DejaVuSans-Bold.ttf` و `DejaVuSansMono*.ttf`. لا يوجد Noto Naskh Arabic ولا Amiri ولا Arial. خط Print Settings (`font = "effra", sans-serif`) غير مثبت على النظام. |

اعتماديات Frappe المعلنة (`apps/frappe/pyproject.toml`): `pypdf==6.13.3` (سطر 24)، `openpyxl~=3.1.5` (52)، `xlsxwriter~=3.2.9` (53)، `pdfkit~=1.0.0` (56). ملاحظة: `frappe/utils/xlsxutils.py` يكتب ملفات Excel عبر `xlsxwriter` (السطر 12) ويقرأ عبر `openpyxl` (السطر 13).

## 1. التجربة الأولى — PDF عربي

### 1.1 كيف يختار Frappe المولّد (من الكود المثبت)

- `frappe.utils.pdf.get_pdf(html, options=None, output=None)` (`apps/frappe/frappe/utils/pdf.py:106-151`) يستدعي `pdfkit.from_string` (السطر 118) أي **wkhtmltopdf دائماً**؛ لا يقرأ `Print Settings.pdf_generator` ولا يقبل معاملاً لاختيار المولّد. يضيف `disable-javascript` و `disable-local-file-access` (السطر 110) و `disable-smart-shrinking` لأن الإصدار > 0.12.3 (السطور 113-114). الهوامش الافتراضية 15mm يمين/يسار (`prepare_options`, السطور 217-221) وحجم الصفحة من `Print Settings.pdf_page_size` (السطور 231-233، وهو A4 على الموقع).
- المولّد chrome موجود في نفس الملف: `get_chrome_pdf(print_format, html, options, output, pdf_generator=None)` (`pdf.py:167-186`)، ولا يعمل إلا إذا مُرِّر `pdf_generator == "chrome"` (السطر 173 يعيد `None` خلاف ذلك). مسجّل كـ hook في `apps/frappe/frappe/hooks.py:100` (`pdf_generator = "frappe.utils.pdf.get_chrome_pdf"`).
- مسار الطباعة القياسي `frappe.utils.print_utils.get_print(...)` (`print_utils.py:15-101`) يقبل معاملاً `pdf_generator: Literal["wkhtmltopdf","chrome"] | None` (السطر 27)؛ وإن لم يُمرَّر يأخذ القيمة من **Print Format** (`frappe.get_cached_value("Print Format", print_format, "pdf_generator")`, السطور 51-55) وليس من Print Settings. إن كانت القيمة ≠ `wkhtmltopdf` يستدعي hooks `pdf_generator` (السطور 79-101) ثم يعود إلى `get_pdf` (wkhtmltopdf). `Print Settings.pdf_generator` تُستخدم في الواجهة فقط (`apps/frappe/frappe/printing/page/print/print.js:709-713`) وفي `www/printview.py:98,121` كقيمة افتراضية لـ `form_dict.pdf_generator`.
- **الخلاصة:** يمكن استدعاء chrome برمجياً دون تغيير إعدادات الموقع عبر `get_chrome_pdf(print_format, html, {}, None, pdf_generator="chrome")` أو `get_print(..., pdf_generator="chrome")`. الشرط: وجود Chromium؛ `find_or_download_chromium_executable()` (`print_utils.py:196-229`) يبحث في `common_site_config.chromium_path` ثم في `<bench>/chromium/chrome-linux/headless_shell`، **وإن لم يجده يحمّله من الإنترنت ويكتبه في مجلد الـ bench** (السطر 221-222). على هذا الخادم كان موجوداً مسبقاً فلم يحدث تحميل.
- ملاحظة: `Browser.__init__` (`pdf_generator/browser.py:13`) يقرأ `print_designer` من Print Format باسم يجب تمريره؛ العمود غير موجود في `tabPrint Format` على هذا الموقع لكن `get_cached_value` أعاد `None` بلا خطأ. مرّرت `"Sales Invoice Format"` (أول Print Format موجود).

### 1.2 مدخلات التجربة

`arabic_table.html`: `<html lang="ar" dir="rtl">`، عنوان عربي، سطر فترة، جدول 7 أعمدة (تاريخ القيد، الحساب، رقم القيد، مدين، دائن، الرصيد، ملاحظات)، 5 صفوف بأسماء حسابات عربية حقيقية من الموقع (`1100 - النقدية الحاضرة - TAE`, `1310 - المدينون (العملاء) - TAE` ...)، أرقام بفواصل آلاف وكسرين (`1,234,567.89`)، رقم سالب (`-129,500.50`)، صفَّا مجموع فرعي وصف مجموع كلي، سطر مختلط عربي/إنجليزي (اسم Sales Invoice، بريد المستخدم، تاريخ ISO، `ERPNext v16.29.0`)، وسطر أرقام عربية-هندية (`١٬٢٣٤٬٥٦٧٫٨٩`). CSS: خلايا الأرقام `direction: ltr; text-align: left`، الرؤوس محاذاة يمين. `font-family: "Noto Naskh Arabic","Amiri","Arial","DejaVu Sans",sans-serif` (فقط DejaVu متاح فعلاً).

### 1.3 النتيجة — wkhtmltopdf: **نجح**

- الملف: `docs/research/artifacts/arabic-table-wkhtmltopdf.pdf` (31,841 بايت، صفحة واحدة) + الصورة `arabic-table-wkhtmltopdf.png` (1190×1684، مقياس 2 عبر pypdfium2).
- الزمن (`time.perf_counter` حول `get_pdf(html)` ثلاث مرات متتالية في نفس العملية): **0.647s / 0.283s / 0.284s**.
- الخطوط المضمّنة في الـ PDF (من `/Resources/Font` عبر pypdf): `DejaVuSans`, `DejaVuSans-Bold` فقط.
- فحص الصورة (Read على PNG):
  - **الربط/التشكيل بين الحروف العربية: سليم.** الكلمات متصلة صحيحاً (دفتر الأستاذ العام، النقدية الحاضرة، المدينون، تكلفة البضاعة المباعة، المجموع الكلي). لا حروف مفكوكة ولا معكوسة. (استخراج النص بـ pypdf يُظهر الحروف بأشكالها الظاهرية المعكوسة — وهذا طبيعي في مخرجات wkhtmltopdf ولا يؤثر على العرض، لكنه يعني أن البحث النصي داخل الـ PDF بالعربية غير موثوق.)
  - **الاتجاه: صحيح.** العنوان محاذى يميناً؛ ترتيب الأعمدة من اليمين لليسار (تاريخ القيد أقصى اليمين، ملاحظات أقصى اليسار)؛ `colspan` في صفوف المجاميع يمتد من اليمين.
  - **الأرقام والمحاذاة: سليمة.** فواصل الآلاف والكسور صحيحة، الرقم السالب `-129,500.50` بإشارة على اليسار، خلايا الأرقام محاذاة يسار LTR كما في CSS. الأرقام العربية-الهندية ظهرت، والفاصل `U+066C` رُسم كعلامة صغيرة مرتفعة (شكل الخط لهذا المحرف).
  - **ملاحظات:** (أ) الخط DejaVu Sans شكله العربي بسيط وغير نسخي؛ ليس خط تقارير محاسبية محترم. (ب) في السطر المختلط انكسر التاريخ `2026-09-30` عند نهاية السطر فظهر `-2026` في آخر السطر الأول و `09-30` في بداية الثاني — مشكلة التفاف داخل فقرة RTL، تُحل بـ `white-space: nowrap` أو `unicode-bidi: isolate` للرموز اللاتينية. (ج) أسماء الحسابات المختلطة (`1100 - النقدية الحاضرة - TAE`) التفّت بحيث ذهب `TAE` لسطر ثانٍ؛ الترتيب البصري صحيح حسب قواعد bidi لكنه يربك القارئ عند الالتفاف — نفس الحل. (د) رأس `تاريخ القيد` انكسر لسطرين بسبب ضيق العمود.

### 1.4 النتيجة — chrome: **نجح (بدون تغيير إعدادات الموقع)**

- الاستدعاء: `frappe.utils.pdf.get_chrome_pdf("Sales Invoice Format", html, {}, None, pdf_generator="chrome")`.
- الملف: `docs/research/artifacts/arabic-table-chrome.pdf` (38,660 بايت، صفحة واحدة) + `arabic-table-chrome.png` (1192×1684).
- الزمن: **1.723s** أول مرة (تشمل تشغيل `headless_shell`)، **0.344s** الثانية (المولّد يُغلق Chromium بعد كل استدعاء: `generator._close_browser()` في `pdf.py:186`، ورسالة `Headless Chromium closed successfully.` تُطبع على stdout، كما تُطبع `Function get_chrome_pdf took ...` من المزخرف `measure_time` في `pdf.py:154-167` — ضجيج في السجلات).
- الخطوط المضمّنة: `AAAAAA+DejaVuSans-Bold`, `BAAAAA+DejaVuSans` (مجموعات فرعية).
- فحص الصورة: نفس النتائج الإيجابية (ربط سليم، اتجاه صحيح، أرقام ومحاذاة سليمة). الفروق: التفاف أفضل في عمود الملاحظات (`قيد افتتاحي` و `فاتورة شراء` في سطر واحد)، حدود الجدول أكثر انتظاماً، والصف الكلي يُظهر الخط السميك العلوي كما في CSS. نفس مشكلة انكسار `2026-09-30` في السطر المختلط (`في -2026` / `30-09`)، فهي مشكلة bidi/التفاف لا مشكلة محرك.

### 1.5 خلاصة التجربة الأولى

| المعيار | wkhtmltopdf 0.12.6.1 | chrome (headless_shell 133) |
|---|---|---|
| الربط العربي | سليم | سليم |
| الاتجاه RTL | سليم | سليم |
| الأرقام والمحاذاة | سليمة | سليمة |
| زمن الطلب الدافئ (صفحة واحدة) | 0.28s | 0.34s (+1.4s تشغيل بارد) |
| حجم الملف | 31.8 KB | 38.7 KB |
| الخط | DejaVu Sans (الوحيد المتاح) | DejaVu Sans (الوحيد المتاح) |
| يحتاج تغيير إعدادات؟ | لا | لا (يحتاج فقط وجود Chromium في `<bench>/chromium` أو `chromium_path`) |

## 2. التجربة الثانية — Excel RTL مع تجميع: **نجح (تحقق برمجي فقط)**

- الملف: `docs/research/artifacts/rtl-grouped.xlsx` (6,330 بايت). أُنشئ بـ `openpyxl 3.1.5` من env الـ bench في 0.021s (`exp2_xlsx.py`).
- المحتوى: ورقة `دفتر الأستاذ`؛ صف عنوان مدمج `A1:G1`؛ رأس من مستويين (`A2:C2` "بيانات القيد"، `D2:F2` "المبالغ (ريال يمني)"، `G2:G3` "ملاحظات")؛ مجموعتان (أصول متداولة 3 صفوف، قائمة الدخل صفان) بصفوف تفصيل `outlineLevel = 1` وصف مجموع فرعي لكل مجموعة بمعادلة `=SUBTOTAL(9, D4:D6)` ودمج `A:C`؛ صف مجموع كلي `=D7+D10`؛ سطر ملاحظة مختلط مدمج `A12:G12`؛ تجميد الرؤوس `A4`؛ تنسيق أرقام `#,##0.00` على أعمدة مدين/دائن/الرصيد؛ عروض أعمدة.
- التحقق بإعادة الفتح بـ `openpyxl.load_workbook` وبقراءة XML الخام من داخل الأرشيف:

| الخاصية | القيمة المقروءة |
|---|---|
| `ws.sheet_view.rightToLeft` | `True` — وفي XML: `<sheetView rightToLeft="1" workbookViewId="0">` |
| `ws.sheet_properties.outlinePr` | `summaryBelow=True`, `summaryRight=False` — XML: `<outlinePr summaryBelow="1" summaryRight="0"/>` |
| المدى المدمج (8) | `A1:G1, A2:C2, D2:F2, G2:G3, A7:C7, A10:C10, A11:C11, A12:G12` — `<mergeCells count="8">` |
| `freeze_panes` | `A4` — XML: `<pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/>` |
| مستويات الطي | الصفوف 4,5,6,8,9 بـ `outlineLevel="1"` (صفوف المجاميع 7 و10 والكلي 11 بلا مستوى) |
| `number_format` للعمود D من 4 إلى 11 | `#,##0.00` في كل الخلايا |
| نوع القيمة | `D4 = 1234567.89` من نوع `float` (رقم حقيقي لا نص) |
| المعادلات | `=SUBTOTAL(9,D4:D6)` و `=D7+D10` محفوظة كمعادلات؛ `workbook.xml` يحوي `fullCalcOnLoad="1"` فتُحسب عند الفتح |

- **الفحص البصري لم يتم:** `soffice`/`libreoffice` غير مثبتين على الخادم، ولا توجد أداة أخرى لتحويل xlsx إلى PDF/PNG. القيم المحسوبة للمعادلات غير موجودة في الملف (openpyxl لا يحسب)، لذا أي قارئ لا يحسب المعادلات سيرى الخلايا فارغة.

## 3. التجربة الثالثة — الحجم

### 3.1 حدود Frappe ذات الصلة (من الكود المثبت)

- **عتبة التحويل التلقائي إلى Prepared Report: 15 ثانية** — `apps/frappe/frappe/core/doctype/report/report.py:188` (`threshold = 15`). في `execute_script_report` (السطور 186-216) يُشغَّل `threading.Timer(interval=15, function=enable_prepared_report)` (السطور 193-198) إن لم يكن `prepared_report` ولا `disable_prepared_report_automation` مفعّلين؛ وإذا تجاوز التنفيذ 15s تُنفَّذ `enable_prepared_report(report, site)` (السطور 504-509) التي **تكتب في قاعدة البيانات** `Report.prepared_report = 1` مع `commit` — في خيط منفصل باتصال جديد. (في سكربت البحث استبدلتها بدالة فارغة في الذاكرة حتى لا يحدث أي write؛ لم تُستدع أصلاً لأن كل التقارير أسرع بكثير.)
- زمن التنفيذ يُحفظ في Redis: `frappe.cache.hset("report_execution_time", self.name, execution_time)` (`report.py:214`) — كتابة في الكاش لا في قاعدة البيانات (حدثت أثناء التجربة، قيمها أدناه).
- مسار الـ Prepared Report في `run`: `is_prepared_report = report.prepared_report and not sbool(ignore_prepared_report) and not custom_columns` (`apps/frappe/frappe/desk/query_report.py:274`). على الموقع التقريران الوحيدان بـ `prepared_report = 1` هما `Stock Balance` و `Quantity Stock Balance`.
- حدود زمنية للـ Prepared Report: `REPORT_TIMEOUT = 25 * 60` و `FAILURE_THRESHOLD = 6 * 60 * 60` (`apps/frappe/frappe/core/doctype/prepared_report/prepared_report.py:23-24`)، ويمكن تجاوز الأول بحقل `Report.timeout` (`prepared_report.py:79-84`).
- **حد عدد الصفوف في المتصفح:** `System Settings.max_report_rows` (على الموقع = 100000؛ الافتراضي في الكود 100000) — `apps/frappe/frappe/public/js/frappe/views/reports/query_report.js:1091`: إن تجاوزت الصفوف الحد لا يُعرض الجدول وتظهر رسالة "too big to display in browser, you can export". حد عميل فقط؛ الخادم يعيد كل الصفوف.
- `generate_report_result` مزخرفة بـ `@frappe.read_only()` (`query_report.py:78`) — تحوّل الاتصال للـ replica فقط إن كان `conf.read_from_replica` مفعّلاً (`frappe/__init__.py:497-518`).
- لا يوجد أي مفتاح في `frappe.conf` يحدّ حجم التقرير أو زمنه في `query_report.py` أو `report.py` (بحث `frappe.conf|local.conf` لم يجد شيئاً سوى `developer_mode`). التصدير في الخلفية (`export_query`, `query_report.py:373-407`) يعتمد على اختيار المستخدم `export_in_background` من الحوار (`query_report.js:1799-1837`) لا على عتبة حجم في الخادم.

### 3.2 حجم البيانات على الموقع (قراءة فقط)

عدد الصفوف الفعلي (`COUNT(*)`):

| الجدول | الصفوف |
|---|---|
| GL Entry | **614** (منها 76 ملغاة؛ من 2026-03-18 إلى 2026-09-29؛ كلها لشركة `SND Accounting`) |
| Payment Ledger Entry | 273 |
| Payment Entry | 229 |
| Sales Invoice | 41 (SND Accounting: 22 مرحّلة، 12 ملغاة، 6 مسودة؛ SND Accounting 2: مسودة واحدة) |
| Sales Invoice Item | 44 |
| Journal Entry / Account | 15 / 33 |
| Stock Ledger Entry | 14 (2026-04-14 إلى 2026-08-04) |
| Purchase Invoice / Item | 5 / 8 |
| Account | 483 (5 شركات: SND Accounting, SND Accounting 2, SND Accounting3, تجربة قراءة الفواتير, شركة اختبار العهد والإخلاءات) |
| Customer / Supplier / Item | 39 / 8 / 9 |
| Fiscal Year | واحدة فقط: 2026 |

أكبر الجداول عموماً (من `information_schema.tables`، تقديرية): `tabComment` 22,016، `tabDocField` 16,434، `tabDeleted Document` 15,476، `tabWhatsapp Log` 12,950، `tabVersion` 8,160، `tabError Log` 1,461 (127 MB). **لا يوجد تقرير Frappe/ERPNext يعمل فوق هذه الجداول**، فأكبر تقرير مالي ممكن هو دفتر الأستاذ العام بحوالي ألف صف.

### 3.3 قياسات `frappe.desk.query_report.run` (كـ Administrator، `ignore_prepared_report=True`)

الشركة: `SND Accounting` (الوحيدة التي لها قيود). الفترة: 2026-01-01 إلى 2026-12-31 ما لم يُذكر غيره. الحجم = `len(json.dumps(result, ensure_ascii=False).encode())` للرد الكامل (columns + result + message + chart + report_summary ...). كل قياس مرتين في نفس العملية؛ العمود الرئيسي هو القياس الثاني.

| التقرير / الفلاتر | الصفوف | الأعمدة | زمن 1 | **زمن 2** | حجم الرد (بايت) | تجاوز 15s؟ |
|---|---|---|---|---|---|---|
| General Ledger — Categorize by Voucher (Consolidated)، كل الحسابات | 523 | 17 | 0.155s | **0.029s** | 358,967 | لا |
| General Ledger — Categorize by Account + show_cancelled_entries + show_remarks | 686 | 18 | 0.047s | **0.037s** | 447,822 | لا |
| General Ledger — Categorize by Voucher (غير مجمّع)، 2026-03-18..2026-09-29 | **1,010** | 17 | 0.037s | **0.035s** | **473,123** | لا |
| Stock Ledger — كل السنة | 14 | 23 | 0.091s | **0.013s** | 12,142 | لا |
| Trial Balance — FY 2026 مع قيود الإقفال | 17 | 10 | 0.130s | **0.036s** | 9,497 | لا |
| Trial Balance — show_zero_values | 75 | 10 | 0.032s | **0.050s** | 36,434 | لا |
| Accounts Receivable — 2026-09-30، Due Date، 30/60/90/120 | 196 | 25 | 0.096s | **0.038s** | 181,127 | لا |
| Accounts Receivable — Posting Date + show_future_payments + remarks | 196 | 29 | 0.058s | **0.053s** | 193,372 | لا |
| Accounts Payable | 6 | 24 | 0.070s | **0.023s** | 7,752 | لا |
| Payment Ledger — كل السنة | 675 | 10 | 0.023s | **0.013s** | 115,780 | لا |
| Sales Register | 23 | 24 | 0.057s | **0.024s** | 17,278 | لا |
| Item-wise Sales Register | 25 | 26 | 0.040s | **0.023s** | 18,451 | لا |
| Gross Profit — group_by Invoice | 47 | 17 | 0.350s | **0.035s** | 25,640 | لا |
| Balance Sheet — شهري، تراكمي | 23 | 16 | 0.146s | **0.081s** | 16,495 | لا |
| Profit and Loss Statement — شهري | 19 | 17 | 0.058s | **0.058s** | 13,487 | لا |
| Stock Balance (prepared_report=1، تم تجاوزه بـ ignore_prepared_report) | 6 | 16 | 0.034s | **0.013s** | 3,965 | لا |
| Trial Balance (Simple) — Query Report | 361 | 7 | 0.017s | **0.010s** | 63,990 | لا |
| Sales Analytics — شهري حسب العميل | 7 | 15 | 0.041s | **0.008s** | 4,054 | لا |
| Document Share Report — Report Builder | 0 | 0 | 0.002s | **0.004s** | 165 | لا (انظر الملاحظة) |
| Employee Information — Report Builder | 0 | 0 | 0.004s | **0.005s** | 165 | لا (انظر الملاحظة) |

- **أكبر تقرير على الموقع:** General Ledger بتصنيف "Categorize by Voucher" (غير مجمّع) = 1,010 صف / 473 KB / 0.035s. لا تقرير يقترب من عتبة الـ 15 ثانية ولا من `max_report_rows`.
- الفرق بين القياس الأول والثاني هو تدفئة الكاش (meta، الترجمات، `get_report_doc`) لا البيانات.
- قيم `report_execution_time` في Redis بعد التجربة (زمن `execute` فقط بلا تسلسل): General Ledger 0.0247، Trial Balance 0.0315، Accounts Receivable 0.0368، Balance Sheet 0.0754، Profit and Loss 0.0516، Stock Ledger 0.0044، Payment Ledger 0.0048.
- ملاحظة على Report Builder: `query_report.run` → `get_report_result` (`query_report.py:61-74`) يتعامل فقط مع `Query Report` و `Script Report` و `Custom Report`؛ لتقارير Report Builder يعيد `None` فيصبح الرد `{"result": [], "columns": [] ...}` بلا خطأ. تقارير Report Builder تمر عبر مسار آخر (`Report.get_data` → `run_standard_report`, `report.py:243-260,299`) وواجهة `frappe.desk.reportview`، أي أنها **خارج** `query_report.run` — يجب أخذ ذلك في الحسبان في نطاق report_view.
- ملاحظة على General Ledger: فلتر `company` إلزامي (`erpnext/accounts/report/general_ledger/general_ledger.py:58-59`) فلا يمكن تشغيله "لكل الشركات" في استدعاء واحد؛ وشرط `from_date`/`to_date` في السطور 61-64 و85-86.

## 4. آثار جانبية سجّلتها التجارب (للعلم)

- لم يُنفَّذ أي insert/save/commit. استُدعي `frappe.db.rollback()` في نهاية كل سكربت.
- كتابات في Redis فقط: `report_execution_time` (من `report.py:214`) و `wkhtmltopdf_version` (من `pdf.py:437`).
- `frappe.log_error` استُبدل في السكربتات بدالة طباعة احترازاً (لم تُستدع فعلاً).
- المولّد chrome يشغّل عملية `headless_shell` ويغلقها في كل استدعاء ويطبع على stdout.
- مجلد `artifacts/` يحوي أيضاً ملفات لم أنشئها ولم ألمسها (`run_reports.py`, `run_reports_variants.py`, `query_report_run_tb_gl_ar.txt`, `query_report_run_variants_and_prepared.txt`) — أُنشئت في نفس الوقت من عملية أخرى (محور آخر من المرحلة 1 على الأرجح).

## 5. أسئلة مفتوحة

1. **الخط العربي:** الخادم لا يملك إلا DejaVu. هل سيُثبَّت خط عربي احترافي (Noto Naskh Arabic / Amiri / IBM Plex Arabic) على خادم الإنتاج؟ وهل يُسمح بتضمين خط عبر `@font-face` مع base64 داخل HTML التقرير (لأن `disable-local-file-access` مفعّل في `pdf.py:110` ولا يمكن الاعتماد على http عند تعطل الويب)؟ لم أختبر ذلك.
2. **chrome في الإنتاج:** المولّد عمل هنا لأن `<bench>/chromium` موجود مسبقاً. إن لم يوجد على خادم آخر فسيحاول Frappe التحميل من الإنترنت وقت الطلب (`print_utils.py:221-222`). هل هذا مقبول؟ ولم أقس سلوك chrome تحت تزامن (`chromium_max_concurrent` افتراضياً 1، `chrome_pdf_generator.py:75`).
3. **رؤوس/تذييل الصفحات والفواصل** (`thead` مكرر عبر الصفحات، ترقيم الصفحات، `page-break-inside: avoid` للمجاميع) لم تُختبر لأن الجدول التجريبي صفحة واحدة. تجربة متعددة الصفحات مطلوبة قبل اعتماد أي محرك.
4. **Excel بصرياً:** لا LibreOffice على الخادم، فلم أتحقق من أن Excel/LibreOffice يعرضان RTL والطي كما هو متوقع؛ التحقق كان على XML فقط. كذلك لم أختبر توليد نفس الملف بـ `xlsxwriter` (المكتبة التي يستخدمها Frappe فعلياً للتصدير في `xlsxutils.py`) — هل يريد المشروع البناء فوق `XLSXStyleBuilder` الموجود أم فوق openpyxl؟
5. **الحجم:** الموقع صغير جداً (614 قيد أستاذ). لا يمكن من هذه البيانات استنتاج سلوك التقارير عند عشرات آلاف الصفوف (زمن التسلسل JSON، حجم الرد، `max_report_rows`، عتبة 15s). يلزم موقع ببيانات أكبر أو بيانات اصطناعية — وهذه فجوة مسجّلة أصلاً في `docs/progress/phase-0.md`.
6. تقارير **Report Builder** لا تمر عبر `query_report.run` (تعيد نتيجة فارغة). هل هي داخل نطاق report_view؟ إن كانت كذلك فمسارها (`frappe.desk.reportview.get` / `Report.get_data`) يحتاج بحثاً منفصلاً.
7. استخراج النص من PDF wkhtmltopdf يعطي حروفاً عربية بترتيب ظاهري معكوس (مقطع 1.3). لم أتحقق هل نص PDF chrome قابل للنسخ/البحث بشكل صحيح.
