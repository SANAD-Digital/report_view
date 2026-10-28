# دليل المطوّر: الطباعة المخصصة (Custom)

هذا الدليل لمن يريد أن يطبع بيانات صفحته أو تطبيقه بمحرك صفحات Report View (الورق، الترويسة، رأس الطباعة، التوقيع، الترقيم، العلامة المائية، PDF) دون أن يكون عنده مستند أو تقرير. القرار وتفاصيله في [ADR-019](adr/019-custom-print-source.md).

## 1. اكتب القالب مرة واحدة
القالب المخصص **HTML و CSS فقط**: HTML (مع Jinja للبيانات) في حقل HTML، والأنماط في حقل CSS. أنماط CSS محصورة في المحتوى المطبوع (لا تمسّ الترويسة ولا التذييل)، وتصل كما هي إلى PDF.

1. افتح **Print Format** ← جديد.
2. «Print Format For» = **Custom**. تختفي حقول المستند والتقرير وتظهر لوحة المساعدة وزر «معاينة ببيانات تجريبية».
3. اكتب HTML بـ Jinja في حقل HTML، والأنماط في CSS. احفظ.

ما يقرؤه القالب:

| المتغير | معناه |
|---|---|
| `data` | البيانات كما أُرسلت (كائن أو قائمة) |
| `doc` | البيانات حين تكون كائناً: `doc.customer` |
| `rows` | البيانات حين تكون قائمة، أو حقلها `rows` |
| `title` | عنوان الطباعة (أو اسم القالب) |
| `company` | `data.company`، وإلا الشركة الافتراضية للمستخدم |
| `printed_by`, `printed_on` | من يطبع ومتى |
| `lang` | لغة الصفحات |
| `_()`, `frappe.format()`, `frappe.utils` | Jinja الخاص بـ Frappe كما في كل قالب |

مثال قالب:

```jinja
<h3>{{ title }}</h3>
<p>{{ _("Customer") }}: <b>{{ doc.customer }}</b> — {{ frappe.utils.formatdate(doc.date) }}</p>
<table class="table table-bordered">
  <thead><tr><th>{{ _("Item") }}</th><th class="text-right">{{ _("Amount") }}</th></tr></thead>
  <tbody>
  {% for r in doc.rows or [] %}
    <tr><td>{{ r.item }}</td><td class="text-right">{{ frappe.format(r.amount, {"fieldtype": "Currency"}) }}</td></tr>
  {% endfor %}
  </tbody>
</table>
```

> النصوص في البيانات تُطبع **مهرّبة** (`<b>` تظهر نصاً)، فلا خطر من بيانات تحمل HTML. الترويسة والتذييل ورأس الطباعة والتوقيع والترقيم لا تُكتب في القالب: تضيفها صفحة الطباعة.

### الخطوط
كل عائلة في **مكتبة خطوط Report View** تُكتب باسمها في CSS القالب، بلا `@font-face` ولا ملفات:

```css
.my-invoice { font-family: 'Cairo', sans-serif; }
.my-invoice h3 { font-family: 'Amiri', serif; font-weight: 700; }
```

- القائمة الكاملة بأسمائها وأوزانها وتراخيصها: `report_view/public/fonts/README.md` (والسجل `report_view/fonts.json`). منها: Cairo، Tajawal، Almarai، Amiri، Noto Naskh Arabic، Noto Kufi Arabic، IBM Plex Sans Arabic، Readex Pro، Lateef، Scheherazade New، Reem Kufi، Vazirmatn، Nazli، Roya، Titr، FreeFarsi، Inter، Roboto، Lato، Source Serif 4، Merriweather.
- صفحات الطباعة تحمّل `rv_fonts.css` (في Desk كله عبر `app_include_css`)، و PDF الصفحات يأخذ الخطوط من القرص؛ لا يُحمَّل إلا ملف العائلة والوزن المستعمل.
- الأوزان المشحونة غالباً 400 و 700 (و 500/600 لبعض العائلات)؛ وزن غير موجود يأخذ أقرب وجه.
- خط الصفحات كلها يُختار أيضاً من «القالب واللغة» ← «الخط» دون كتابة CSS.
- قالب Jinja يطبعه Frappe نفسه (`/printview` و wkhtmltopdf) لا يحمّل `rv_fonts.css`: ضع `@font-face` في HTML القالب برابط **مطلق** (`{{ frappe.utils.get_url('/assets/report_view/fonts/cairo/cairo-400.ttf') }}`، woff2 ثم ttf كما في `rv_fonts.css`)؛ الرابط النسبي في `src:url(...)` يفسده Frappe عند تحويل الروابط. ولا تعرّف وجهي 400 و 500 معاً هناك: wkhtmltopdf يطبع النص العادي بوجه 500.

## 2. اطبع من صفحة (JavaScript)
`report_view.print` موجود في كل صفحة Desk.

### بيانات مباشرة
```js
report_view.print({
	print_format: "Delivery List",
	data: { customer: "Acme", date: "2026-10-21", rows: [{ item: "Paper", amount: 125 }] },
	title: __("Delivery list"),
	// اختياري: letter_head, heading, signature, lang ("ar" / "en"), open_in: "same" | "tab"
});
```
تُحفظ البيانات على الخادم ساعة واحدة لك وحدك (حتى 5 ميغابايت)، وتُفتح `/desk/rv-print/Custom/<token>`.

### بيانات من دالة (رابط حيّ يمكن حفظه)
```js
report_view.print({
	print_format: "Delivery List",
	method: "my_app.api.delivery_rows",
	args: { from_date: "2026-10-01" },
	title: __("Deliveries"),
});
```
صفحة الطباعة تستدعي الدالة من المتصفح بـ **GET**، فتعمل صلاحيات الدالة نفسها. اكتب الدالة هكذا:

```python
@frappe.whitelist(methods=["GET"])
def delivery_rows(from_date: str) -> dict:
	rows = frappe.get_list("Delivery Note", filters={"posting_date": [">=", from_date]}, fields=["name as item", "grand_total as amount"])
	return {"customer": _("All customers"), "date": from_date, "rows": rows}
```

والرابط نفسه يُحفظ أو يوضع في قائمة أو Workspace:

```
/desk/rv-print/Custom/Delivery%20List?method=my_app.api.delivery_rows&args={"from_date":"2026-10-01"}&title=Deliveries
```

### قالب مرسل مع البيانات (بلا قالب محفوظ)
بدل `print_format` أرسل `html` و `css` (أحدهما فقط: القالب المحفوظ أو المرسل):

```js
report_view.print({
	html: `<h3>{{ title }}</h3>
	<table class="lines">
	{% for r in rows %}<tr><td>{{ r.item }}</td><td>{{ format_value(r.amount, "Currency", "SAR") }}</td></tr>{% endfor %}
	</table>`,
	css: ".lines td { padding: 2mm; border-bottom: 1px solid #ccc }",
	data: { rows: [{ item: "Paper", amount: 125 }] },
	title: __("Quick list"),
	// أو method + args: تستدعي صفحتك الدالة (GET) ثم ترسل القالب مع نتيجتها
});
```

- يُحفظ مع بياناته ساعة لك وحدك (HTML حتى 200 KB و CSS حتى 100 KB)، ولا يُحمل في رابط دالة.
- **الفرق المهم**: القالب المرسل يُرندر في صندوق معزول: يقرأ **البيانات المرسلة فقط** و`_()` و`format_value(value, fieldtype, options)` و`range()` ومرشّحات Jinja. لا `frappe` ولا قاعدة بيانات ولا `include`. إن احتجت قراءة سجلات (`frappe.db.get_value`…) فاحفظ القالب كـ Print Format مخصص.
- في صفحة الطباعة يظهر «القالب المرسل» في منتقي القوالب، ويمكن تجربة قالب محفوظ على البيانات نفسها ثم العودة.
- من بايثون: `print_url(html="<p>{{ doc.x }}</p>", css="…", data={"x": 1})`.

### أي جدول بلا قالب
```js
report_view.print_table({
	title: __("Stock"),
	subtitle: __("Main warehouse"),
	columns: [
		{ label: __("Item"), fieldname: "item" },
		{ label: __("Qty"), fieldname: "qty", fieldtype: "Float" },
		{ label: __("Value"), fieldname: "value", fieldtype: "Currency", options: "SAR" },
	],
	rows: [{ item: "A", qty: 2, value: 40 }, ["B", 5, 75]], // كائنات أو قوائم بترتيب الأعمدة
	totals: true, // يجمع Int و Float و Currency، أو كائن بالإجماليات جاهزة {qty: 7}
});
```
يستخدم القالب المشحون «Report View Table». وقالبك المخصص يقرأ البيانات نفسها إن مرّرت `print_format`.

## 3. اطبع من بايثون
دالة على الخادم تجهّز البيانات وتعيد رابط الطباعة للمتصفح:

```python
from report_view.core.custom_print import print_url

@frappe.whitelist()
def print_open_tasks():
	rows = frappe.get_list("ToDo", filters={"status": "Open"}, fields=["name", "description"])
	return print_url("Task List", data={"rows": rows}, title=_("Open tasks"))
```
```js
frappe.call("my_app.api.print_open_tasks").then((r) => report_view.open_print(r.message));
```
- `print_url(print_format, data=…)` يرحّل البيانات للمستخدم الحالي ويعيد `/desk/rv-print/Custom/<token>`.
- `print_url(print_format, method="my_app.api.rows", args={…})` يعيد رابط الدالة الحيّ.
- `absolute=True` يعيد الرابط كاملاً (للبريد مثلاً — رابط الدالة فقط، لأن رابط الرمز لصاحبه وحده).
- `letter_head=`, `heading=`, `signature=`, `lang=` تختار ما حول القالب.

## المتغيرات
اختيارات يغيّرها من يطبع في صفحة الطباعة، فيُرندر القالب بها من جديد (ADR-024). تعمل في كل قالب طباعة: قالب مستند، قالب تقرير، وقالب مخصص.

1. في نموذج القالب اضغط **«إضافة متغيرات»**: جدول فيه لكل متغير التسمية، اسم المتغير (`[a-z][a-z0-9_]`، حتى 40)، النوع، الخيارات، القيمة الافتراضية (والوصف اختياري).
   - **Check**: مفتاح؛ القيمة 1 أو 0.
   - **Select**: قائمة؛ الخيارات سطراً سطراً، والافتراضية أحدها.
   - **Link**: سجل يُبحث عنه بحقل Link من Frappe؛ الخيارات = اسم الـ DocType. لا يُقبل إلا سجل يملك المستخدم قراءته.
   - **Float** / **Int**: رقم.
   - حتى 30 متغيراً. أسماء محجوزة: `doc`، `data`، `rows`، `filters`، `columns`، `title`، `company`، `lang`، `frappe`، `_`، `variables`.
2. «تطبيق» ثم **احفظ القالب** (الخادم يفحص المتغيرات عند الحفظ).
3. في القالب تُقرأ بـ `variables`:

```jinja
{% if variables.show_details %}
	<table>…</table>
{% endif %}
<p class="{{ variables.layout }}">{{ variables.copies }}</p>
{% if variables.customer %}{{ frappe.db.get_value("Customer", variables.customer, "customer_name") }}{% endif %}
```
قالب تقرير من نوع JS يقرؤها بالاسم نفسه: `{%= variables.show_details %}`.

- في صفحة الطباعة تظهر أداة **«المتغيرات»** في شريط الأدوات (مجموعة «المحتوى») متى كان للقالب المختار متغيرات: عنصر لكل متغير، يبدأ بالقيمة المحفوظة أو الافتراضية. تغيير قيمة يعيد رندرة القالب وحده بعد لحظة.
- القيم تُحفظ مع إعدادات الطباعة للمستخدم، لكل قالب، وتدخل في الإعدادات المسبقة (مثل القالب نفسه).
- القيم القادمة من المتصفح تُفحص على الخادم: مفتاح مجهول يُسقط، الأرقام تُحوَّل (حد 10¹²)، Select من خياراته فقط، Link سجل موجود يقرؤه المستخدم. النصوص تُطبع مهرّبة.
- طباعة Frappe الأصلية وPDF الخاص بها يرندران القالب بالقيم الافتراضية، فقالب يقرأ `variables` لا ينكسر هناك.
- القالب المرسل مع البيانات (`html` + `css`) لا متغيرات له.

## 4. المعاينة والأخطاء
- زر «معاينة ببيانات تجريبية» في نموذج القالب: الصق JSON كما سترسله صفحتك، فتُفتح الطباعة في تبويب.
- قالب فيه خطأ: يرى المستخدم «تعذّر عرض قالب الطباعة…»، والتفاصيل في **Error Log**. في developer_mode تظهر رسالة الخطأ ورقم السطر.
- رمز انتهت ساعته أو لمستخدم آخر: «انتهت صلاحية هذه الطباعة».

## 5. من يستطيع
- يطبع بالقالب كل مستخدم Desk (صلاحية select على Print Format)، والقالب يجب أن يكون مخصصاً وغير معطّل.
- ما تجلبه دالة البيانات أو القالب بنفسه يخضع لصلاحيات المستخدم.
- ورق الشركة يُطبع بالشركة `company` (أو `data.company`) إن كان المستخدم يقرؤها، وإلا بشركته الافتراضية: ورق المنشئ يقرأ سجل الشركة (الرقم الضريبي، العنوان، الشعار).
- PDF: زر PDF في صفحة الطباعة (`report_view.api.pdf.pages_pdf_custom`) بالآلية نفسها لبقية الطباعة.

## أين تُفتح الطباعة
- `open_in: "same"`: في الصفحة نفسها (زر «رجوع» في صفحة الطباعة يعيدك إلى صفحتك).
- `open_in: "tab"`: في تبويب جديد، وصفحتك تبقى كما هي.
- بلا `open_in`: الافتراضي من **Report View Global Settings → فتح الطباعة المخصصة في** (الافتراضي «نفس التبويب»).
- `new_window: true` القديم يبقى يعمل ويعني `open_in: "tab"`.
- يعمل الخيار نفسه في `report_view.print` و `report_view.print_table` و `report_view.open_print(url, { open_in })`.
