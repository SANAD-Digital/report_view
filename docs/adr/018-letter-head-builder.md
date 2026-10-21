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
- `font`: من القائمة `["IBM Plex Sans Arabic", "DejaVu Sans"]` (المثبتتان على خادم PDF، فالمعاينة والـPDF بالخط نفسه).
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
- بلا JavaScript، بلا grid ولا flex ولا متغيرات CSS ولا transform. كل التنسيق inline. الخانة اليمنى `dir="rtl"`، اليسرى `dir="ltr"`، الوسطى `dir="auto"`.
- رقم الصفحة: `<span class="page"></span>` و `<span class="topage"></span>` (عرف Frappe في PDF)، وصفحات Report View تملؤهما.
- الصورة والشعار: رابط نسبي عام (`/files/…`)؛ الخاص يُرفض مع تحذير (لا يظهر في PDF).

### الدخول
- زر «تصميم بالمنشئ» في نموذج Letter Head (`doctype_js`)، وصفحة Desk جديدة `rv-letterhead` (`/desk/rv-letterhead[/<letter head>]`)، ورابط «تصميم ورق جديد» بجانب اختيار الترويسة في الصفحات.

### صفحات Report View
- ترويسة فيها `[data-rv-lh]` تُعامل «تصميماً ثابتاً»: ارتفاع شريطها من `data-h`، ولا تنطبق عليها قيود `fit-wide` و `max-height` على الصور والعناصر.

## العواقب
- hook جديد: `doctype_js = {"Letter Head": "public/js/letter_head_form.js"}`.
- DocType جديد وصفحة جديدة تُثبَّتان بـ `bench migrate` أو `reload-doc`.
- wkhtmltopdf مع «تكرار الترويسة والتذييل» لا يقيس الترويسة: قالب الطباعة يحتاج `.print-format{margin-top: <h+5>mm}`. المنشئ يعرض هذا السطر جاهزاً للنسخ مع ارتفاع التصميم. مولّد Chrome يقيس الترويسة بنفسه.
- مكتبات جديدة: لا. السحب بـ Pointer Events، و QR بـ pyqrcode (تابع لـ Frappe).
