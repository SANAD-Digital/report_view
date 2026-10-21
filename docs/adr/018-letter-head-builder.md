# ADR-018: منشئ ورق الشركة (Letter Head Builder)

- الحالة: مقبول
- التاريخ: 2026-10-21

## السياق
- طلب صاحب المشروع (2026-10-20) أداة احترافية لإنشاء ورق الشركة بالسحب والإفلات، تأخذ بياناتها من سجل الشركة. عُرضت ثلاثة تصورات على اللوحة (https://claude.ai/artifact/R8dNNcEUzphLfi4AWRxN3U): أ — محرر حر بالمليمتر، ب — أنماط جاهزة ببيانات الشركة، ج — خانات ثابتة (عربي · شعار · إنجليزي). القرار (2026-10-21): **دمج الثلاثة**، لكل منها ميزته.
- كل مسارات الطباعة في Frappe (صفحة الطباعة، PDF بـ wkhtmltopdf و Chrome و weasyprint، طباعة التقارير، وصفحات Report View) تقرأ من `Letter Head` حقلين فقط: `content` و `footer`، وترندرهما Jinja بسياق `{doc}`. لا يوجد منشئ مرئي في Frappe 16، و Print Designer مؤرشف.
- `Letter Head.before_insert` يجعل `source = "Image"`، و `validate → set_image()` يكتب فوق `content`/`footer` في وضع الصورة.
- wkhtmltopdf يعطّل JavaScript ولا يقيس الترويسة (الهامش العلوي من `.print-format{margin-top}` في الصفحة، وإلا 15mm)، ومحركه QtWebKit بلا grid ولا flex gap ولا متغيرات CSS. الموضع المطلق والجداول ووحدات mm/pt تعمل.
- كتابة `Letter Head`: دور System Manager فقط.
- التفاصيل والمصادر: تقرير البحث `5-letterhead-research.md` (لوحة التدقيق).

## القرار

### الدمج
- **ب — الأنماط**: أول ما يراه من يبدأ ورقاً جديداً معرض أنماط مرسومة ببيانات شركته الحقيقية (6 أنماط). النمط ينتج «تخطيطاً» (JSON أدناه) لا HTML.
- **ج — الخانات**: كل شريط (الترويسة والتذييل) فيه ثلاث خانات ثابتة: يمين ووسط ويسار. العنصر الموضوع في خانة **يتدفق** تحت ما قبله، والحقل الفارغ يختفي فيرتفع ما بعده. هذا هو الوضع الافتراضي، وهو ما يجعل الورق ثنائي اللغة سليماً في كل طابعة.
- **أ — الحر**: أي عنصر يمكن فكّه من خانته ليصير **حراً** بموضع وحجم بالمليمتر (شبكة 1mm، أدلة محاذاة، مقابض تحجيم، أسهم لوحة المفاتيح). العناصر الحرة تعيش مع الخانات في الشريط نفسه.
- المحرر واحد: لوحة عناصر، والورقة كاملة (الترويسة فوق، التذييل تحت، والمتن باهت)، ولوحة خصائص، وطبقات، وتراجع/إعادة. السحب من اللوحة إلى خانة يضع العنصر فيها، وإلى مكان فارغ يجعله حراً.

### المخزن
- **DocType جديد `Letter Head Layout`** (وحدة Report View، تسمية بحقل `letter_head`):
  `letter_head` (Link Letter Head، فريد، إلزامي)، `company` (Link Company، اختياري: فارغ = شركة المستند)، `template` (Data: اسم النمط الذي بدأ منه)، `layout` (JSON)، `layout_version` (Int)، `generated_hash` (Data، للقراءة).
  الصلاحيات: كتابة System Manager، قراءة Desk User (كـ Letter Head).
- **`Letter Head` يبقى قياسياً**: المنشئ يكتب فيه `content` و `footer` بمصدر `HTML` (بعد الإدخال إذا كان جديداً)، و `header_height`/`footer_height` إن وُجد الحقلان (snd_print). إزالة Report View تترك ورقاً يعمل (يضيع التعديل فقط).
- **الخادم وحده يولّد HTML** من التخطيط بعد التحقق منه (لا HTML ولا Jinja من المتصفح). المتصفح يرسم التخطيط نفسه بقيم الشركة للمعاينة الفورية بالبنية نفسها (العقد أدناه).
- إن تغيّر `content`/`footer` يدوياً بعد آخر توليد (`generated_hash` لا يطابق) يرفض الحفظ إلا بـ `overwrite=1`، والمحرر يسأل.

### الواجهة البرمجية (`report_view.api.letterhead`)
| الدالة | الطريقة | ما تفعله |
|---|---|---|
| `builder_context(company=None, letter_head=None)` | GET | بيانات الشركة (حقول القائمة المسموحة أدناه + العنوان + الشعار + الاسم العربي من Translation)، الشركات التي يقرؤها المستخدم، الخطوط، الحدود، `can_write`، وتخطيط `letter_head` إن وُجد مع `hand_edited` |
| `preview(layout, company=None)` | POST | يتحقق ويولّد ويرندر Jinja بسياق `{doc: {company}}`، يعيد `{header, footer, warnings}` |
| `save(layout, letter_head=None, name=None, company=None, make_default=0, overwrite=0)` | POST | ينشئ أو يحدّث Letter Head و Letter Head Layout، يعيد `{letter_head}` |
| `qr_svg(text)` | GET | SVG لرمز QR (pyqrcode، تابع لـ Frappe) للمعاينة؛ عند الحفظ يُضمَّن SVG في HTML |

كل دالة تتحقق من الصلاحية في أول سطر: `builder_context`/`preview`/`qr_svg` قراءة Letter Head و Company؛ `save` كتابة Letter Head (وكتابة Company لـ `make_default`). القراءة بـ `frappe.get_list`. حدود: التخطيط ≤ 64KB، ≤ 60 عنصراً في الشريط، النص ≤ 500 حرف.

### عقد التخطيط (JSON، `v: 1`)
```json
{
  "v": 1,
  "font": "IBM Plex Sans Arabic",
  "colors": {"primary": "#1E5C45", "text": "#17211C", "muted": "#5B6660"},
  "header": {"h": 35, "pad_top": 6, "slots": {"right": 34, "center": 26, "left": 34}, "elements": []},
  "footer": {"h": 15, "pad_top": 3, "slots": {"right": 40, "center": 20, "left": 40}, "elements": []}
}
```
- `font`: اسم عائلة من **مكتبة الخطوط** (`report_view/fonts.json`، القسم «الخطوط» أدناه)؛ أي اسم آخر يُرفض في الخادم، والمتصفح يعيده إلى الافتراضي `IBM Plex Sans Arabic`.
- `colors.*`: `#RRGGBB`.
- `h`: الترويسة 10–80mm، التذييل 0–50mm (0 = بلا تذييل). `pad_top` 0–20mm. `slots.<s>`: عرض الخانة بنسبة مئوية من عرض الشريط 0–70 (0 = خانة مغلقة)، والمجموع ≤ 100.
- **العنصر**:
```json
{"id": "e1", "type": "field", "slot": "right",
 "x": 0, "y": 0, "w": 60, "h": 0,
 "style": {"size": 9, "weight": 400, "color": "muted", "align": "start", "gap": 1},
 "props": {}}
```
  - `id`: `[a-z0-9]{1,12}` فريد في التخطيط. `slot`: `"right" | "center" | "left" | null` (null = حر).
  - `x`,`w`: بالمليمتر على عرض مرجعي **180mm** (A4 عمودي بلا هوامش 15mm)، ويُكتبان في HTML **نسباً مئوية** (`x/180*100%`) فيتكيف التصميم مع أي عرض. `y`,`h`: مليمتر. في الخانة تُهمل `x`,`y`؛ و `w`,`h` تُستعمل للشعار والصورة و QR (الحجم) وللخط (الطول، 0 = عرض الخانة).
  - `style.size`: 6–40pt؛ `weight`: 400/500/600/700؛ `color`: `primary|text|muted|#RRGGBB`؛ `align`: `start|center|end` (للحر؛ في الخانة محاذاة الخانة)؛ `gap`: مسافة بعده في الخانة 0–10mm.
- **الأنواع و `props`**:
  | النوع | props |
  |---|---|
  | `text` | `text` (≤500، أسطر بـ `\n`)، `dir`: `auto|rtl|ltr` |
  | `field` | `token` (من القائمة)، `label` (≤60، يُكتب قبل القيمة)، `hide_empty` (افتراضي true) |
  | `logo` | — (شعار الشركة؛ الحجم `w`×`h`، احتواء) |
  | `image` | `src` (يبدأ بـ `/files/` لملف عام أو `/assets/`)، `fit`: `contain|cover` |
  | `line` | `thick` 0.2–3mm، `style`: `solid|dashed|double` |
  | `band` | `fill` (لون)، `radius` 0–10mm (حر فقط عادة) |
  | `qr` | `source`: `website|text`، `text` (≤300) |
  | `page` | `format`: `ar|en|both` (في التذييل) |
- **الحقول المسموحة (`token`)**: `company_name`، `company_name_ar` (ترجمة الاسم أو الاسم)، `abbr`، `tax_id`، `phone_no`، `fax`، `email`، `website`، `registration_details`، `country`، `address` (العنوان كاملاً بأسطره)، `address_line1`، `city`.

### عقد HTML (الخادم يولّد، والمتصفح يرسم البنية نفسها بقيم حقيقية)
```html
<!-- rv-lh v1 header h=35 -->
<div class="rvlh" data-rv-lh="header" data-h="35" dir="ltr" style="position:relative;width:100%;height:35mm;overflow:hidden;box-sizing:border-box;font-family:'IBM Plex Sans Arabic',sans-serif;color:#17211C;line-height:1.35;-webkit-print-color-adjust:exact;print-color-adjust:exact">
  <!-- slot right: right:0; slot left: left:0; slot center: left:50%; margin-left:-(w/2)% -->
  <div data-slot="right" dir="rtl" style="position:absolute;top:6mm;right:0;width:34%;text-align:right">
    {% if _v %}<div data-el="e1" style="font-size:9pt;font-weight:400;color:#5B6660;margin:0 0 1mm">label <bdi dir="ltr">{{ _v|e }}</bdi></div>{% endif %}
  </div>
  <div data-el="e9" style="position:absolute;left:10%;top:28mm;width:80%;height:0.6mm;...">…</div>
</div>
```
- الشركة: `company` ثابت في التخطيط، وإلا `doc.company` إن كان `doc` معرّفاً، وإلا `Global Defaults.default_company`. القيم بـ `frappe.get_cached_doc` و `frappe.db.get_value` (globals Frappe الأساسية فقط، بلا دالة من Report View). كل قيمة `|e`. الأرقام والبريد والموقع داخل `<bdi dir="ltr">`.
- بلا JavaScript، بلا grid ولا flex ولا متغيرات CSS ولا transform. كل التنسيق inline، إلا `<style>` واحداً في أول كل شريط (القسم «الخطوط»). الخانة اليمنى `dir="rtl"`، اليسرى `dir="ltr"`، الوسطى `dir="auto"`.
- رقم الصفحة: `<span class="page"></span>` و `<span class="topage"></span>` (عرف Frappe في PDF)، وصفحات Report View تملؤهما.
- الصورة والشعار: رابط نسبي عام (`/files/…`)؛ الخاص يُرفض مع تحذير (لا يظهر في PDF).

### الخطوط (2026-10-21)
- **مكتبة خطوط تُشحن مع التطبيق** في `report_view/public/fonts/<slug>/` (كل مجلد بترخيصه)، وسجلّها الوحيد `report_view/fonts.json`: `{family, slug, scripts, category, weights: {"400": {woff2, ttf}, …}, licence, source}`. يقرؤه بايثون (`core/fonts.py`) والمتصفح (`fonts_registry.js` يستورد الملف نفسه في الحزمة)، و `scripts/build_fonts.py` يتحقق منه ويولّد `public/css/rv_fonts.css` و `public/fonts/README.md` (القائمة والتراخيص والمستبعد).
- **ما يُشحن**: خطوط SIL OFL من مستودع google/fonts الرسمي (عربية ولاتينية، 400 و 700، و 500/600 لـ Cairo و IBM Plex Sans Arabic و Readex Pro و Inter و 500 لـ Tajawal)، وخطوط FarsiWeb (GPL أو «توزيع بلا تعديل») و FreeFarsi (GPL) من frappe_jodit_editor. **لا يُشحن** ما لا يُسمح بتوزيعه: سلسلة «B …» (Borna Rayaneh)، DecoType Naskh Variants، PT Bold Heading، Iranian Sans. DejaVu Sans يبقى خطاً مثبتاً على الخادم بلا ملف.
- **الصيغة**: كل وجه woff2 ثم TrueType (`src: url(…woff2) format('woff2'), url(…ttf) format('truetype')`): المتصفحات تأخذ woff2، و wkhtmltopdf (QtWebKit لا يقرأ woff2) يتخطاه إلى TrueType — مُقاس. الخطوط التي يمنع ترخيصها أي تعديل تُشحن ملفها الأصلي فقط.
- **Desk**: `app_include_css = ["/assets/report_view/css/rv_fonts.css"]` (hook جديد): `@font-face` لكل وجه، والملف لا يُحمَّل إلا حين تُستعمل عائلته. صفحة `/printview` في Frappe بلا hook للأنماط، فالورق يحمل خطه بنفسه:
- **الورق**: أول كل شريط `<style>` فيه `@font-face` **لخط التخطيط وحده**، للأوزان التي تستعملها عناصره فقط، بروابط **مطلقة** من Jinja: `{{ frappe.utils.get_url('/assets/report_view/fonts/')|e }}`، ثم القاعدة `.rvlh[data-rv-lh] *{font-family:inherit}` (نمط طباعة للموقع قد يضع خطاً على `.letter-head *`). خط الخادم (DejaVu Sans) بلا `@font-face`.
- **wkhtmltopdf لا يفرّق بين 400 و 500**: إن عُرّف الوجهان طبع كل نص عادي بوجه 500. لذلك لا يعرّف الورق وجه 500 مع 400 (نص 500 يُطبع عادياً)، والوزن غير الموجود يأخذ أقرب وجه بقواعد CSS (`core/fonts.py print_weights`).
- **مُقاس على acc.dev** (`frappe.get_print(..., as_pdf=True)`، قيد `ACC-JV-2026-00015`): wkhtmltopdf يضمّن Cairo-Regular/Bold و Nazli/Nazli-Bold و Roya و Titr-Bold و IBMPlexSansArabic؛ Chrome (مولّد Frappe) يرسم الترويسة بالخط نفسه (يضمّنه Type 3 في PDF الترويسة)؛ محرك PDF في Report View يخدم woff2 من القرص ويضمّن الخط (`/assets/` مسموح من أي مضيف).
- **صفحات Report View**: «الخط» في «القالب واللغة» (`font` في الإعدادات، فارغ = خط القالب، ويُنقّى بالسجل) يضع `--pp-font` على الصفحات.

### الدخول
- زر «تصميم بالمنشئ» في نموذج Letter Head (`doctype_js`)، وصفحة Desk جديدة `rv-letterhead` (`/desk/rv-letterhead[/<letter head>]`)، ورابط «تصميم ورق جديد» بجانب اختيار الترويسة في الصفحات.

### صفحات Report View
- ترويسة فيها `[data-rv-lh]` تُعامل «تصميماً ثابتاً»: ارتفاع شريطها من `data-h`، ولا تنطبق عليها قيود `fit-wide` و `max-height` على الصور والعناصر.

## العواقب
- hook جديد: `doctype_js = {"Letter Head": "public/js/letter_head_form.js"}`.
- DocType جديد وصفحة جديدة تُثبَّتان بـ `bench migrate` أو `reload-doc`.
- wkhtmltopdf مع «تكرار الترويسة والتذييل» لا يقيس الترويسة: قالب الطباعة يحتاج `.print-format{margin-top: <h+5>mm}`. المنشئ يعرض هذا السطر جاهزاً للنسخ مع ارتفاع التصميم. مولّد Chrome يقيس الترويسة بنفسه.
- مكتبات جديدة: لا. السحب بـ Pointer Events، و QR بـ pyqrcode (تابع لـ Frappe).
- hook جديد: `app_include_css = ["/assets/report_view/css/rv_fonts.css"]` (مكتبة الخطوط). حجم المكتبة نحو 24MB على القرص؛ لا يُحمَّل منها في المتصفح إلا ما يُستعمل.
- إزالة Report View تُبقي الورق يعمل لكن بخط بديل (روابط الخطوط من `/assets/report_view/`).

## ملاحظات الخادم (2026-10-21)
- الملفات: `core/letterhead.py` (التحقق والتوليد)، `api/letterhead.py` (الواجهة)، DocType `Letter Head Layout`، والاختبارات `tests/test_letterhead.py`.
- **التحقق صارم**: أي مفتاح غير معروف في أي مستوى يُرفض (لا يُتجاهل)؛ الأرقام تُقصّ إلى حدودها؛ مجموع الخانات > 100 يُرفض. العنصر الحر بعرض 0 يأخذ باقي الشريط (`180 - x`).
- **رمز QR ثابت** يُرسم عند الحفظ: النص، أو موقع الشركة الثابتة، وإلا موقع شركة المعاينة (`preview_company` في `save`)، وإلا الشركة الافتراضية. حجمه `h` وإلا `w` (مربع).
- **الشعار يُطبع إن كان عاماً فقط** (`/files/` أو `/assets/`)، وإلا لا يظهر ويحذّر المنشئ — القاعدة نفسها للصورة، فالمعاينة وكل PDF متطابقة.
- الاحتواء بـ `max-width`/`max-height` (QtWebKit بلا `object-fit`)، والتغطية بخلفية `background-size:cover`.
- ورق كُتب يدوياً ولم يكتبه المنشئ قط (بلا `Letter Head Layout`) وفيه HTML يُعدّ «معدّلاً يدوياً»: لا يُستبدل إلا بـ `overwrite=1`. الرفض بخطأ `RVLetterHeadEdited` (HTTP 409).
- كلمات رقم الصفحة («صفحة … من …» / "Page … of …") ثابتة حسب `format` لا تمر بـ `_()`: الورق ثنائي اللغة لا يتغير بلغة الطباعة.
- عند إنشاء ورق جديد يُحذف تنبيه Frappe «أرفق صورة» الصادر من `before_insert`، لأن المصدر يصير HTML مباشرة بعده.

### wkhtmltopdf (مُقاس على acc.dev، Frappe 16، قيد `ACC-JV-2026-00015`)
- **«تكرار الترويسة والتذييل» مفعّل**: Frappe يستخرج `#header-html`/`#footer-html` إلى `--header-html`/`--footer-html` ولا يضع `margin-top` إطلاقاً (افتراضي wkhtmltopdf ≈ 10mm)، فترويسة 35mm تُقصّ من أعلاها. الترويسة تُرسم ملتصقة بأسفل الهامش، وصفحتها تضيف 15mm (حشوة قالب Frappe). المطلوب في قالب الطباعة: `.print-format { margin-top: <h+15>mm; margin-bottom: <f+10>mm; }` (التذييل يضيف سطر رقم الصفحة الخاص بـ Frappe). جُرّب 40mm ← اسم الشركة مقصوص؛ 50mm ← سليم. لذا `print_format_css` يعيد `h+15` لا `h+5`. أرقام الصفحات (`.page`/`.topage`) تُملأ في التذييل.
- **التكرار معطّل**: الترويسة جزء من متن الصفحة الأولى فقط، والهامش 15mm، والتذييل يأتي بعد المتن مباشرة (لا في أسفل الصفحة) وأرقام الصفحات فارغة.
- **`<style>.print-format{margin-top:…}</style>` داخل محتوى الورق**: مع التكرار المفعّل **لا يصل** (يُستخرج مع `#header-html` قبل قراءة الأنماط، فلا يُضبط الهامش)؛ مع التكرار المعطّل **يصل** لكنه يدفع المتن كله بما فيه الورق نفسه، فلا فائدة. لذلك لا يضعه المولّد، ويبقى في قالب الطباعة كما في «العواقب».
