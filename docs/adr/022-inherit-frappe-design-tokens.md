# ADR-022: وراثة متغيرات تصميم Frappe

- الحالة: مقبول (قرار صاحب المشروع، 2026-10-28). يستبدل قاعدة «نسخ ألوان النموذج» في `docs/brief.md` لواجهة التطبيق.
- التاريخ: 2026-10-28

## السياق
- قرار صاحب المشروع (2026-10-28): «أريد أن تكون التنسيقات في التطبيق كله موروثة من Frappe: الهوامش والألوان والخط وبقية CSS».
- قبل القرار كان `public/css/rv_tokens.css` منسوخاً من `reference/design/rv.css`: لوحة ألوان خضراء خاصة (`--pri:#1E5C45`)، وخط `IBM Plex Sans Arabic` مفروض على الواجهة، ومقاسات خاصة (صف 36px، حقل 34px)، ولوحة داكنة خاصة تُفعَّل بالصنف `.rv.dark` من زر في رأس الصفحة يحفظ اختياره في `localStorage` (`report_view:theme`) مستقلاً عن ثيم Desk. فكانت الصفحة تبدو تطبيقاً آخر داخل Desk، وتعاند بعض قواعده (حقول Frappe وأزراره ومربعات الاختيار بإطار وخلفية وخط من عندنا).
- Frappe 16 (16.53 على الـ bench) يعرّف متغيراته في نظام Espresso: `frappe/public/css/espresso/{colors,legacy,effects,radius,spacing,typography}.css` و `frappe/public/scss/common/css_variables.scss` و `scss/espresso/_typography.scss`. الثيم الداكن يُبدَّل بـ `<html data-theme="dark">` (وأيضاً الصنف `.dark`)، فيعيد Frappe تعريف المتغيرات نفسها؛ المكوّنات لا تعرف الثيم.
- ثيم الموقع (مثل snd_utilities) يغيّر هذه المتغيرات نفسها (`--snd-font-family`، `--btn-primary`، `--control-bg`، …)، فما يُبنى عليها يتبع هوية الموقع تلقائياً.

## ما وُجد في Frappe 16
| المجموعة | المتغيرات (القيمة الفاتحة ← الداكنة) |
|---|---|
| الأسطح | `--bg-color` و `--fg-color` و `--card-bg` = `--surface-base` (أبيض ← gray-950)، `--subtle-accent` = surface-gray-1، `--subtle-fg` و `--control-bg` و `--fg-hover-color` و `--sidebar-select-color` و `--btn-default-bg` = surface-gray-2، `--btn-ghost-hover-bg` = surface-gray-3، `--btn-default-hover-bg` = surface-gray-4، `--highlight-color` = surface-gray-1، `--modal-bg` و `--popover-bg` = `--bg-color` |
| النص | `--text-color` = ink-gray-8 (#171717 ← #d9d9d9)، `--heading-color` = ink-gray-9، `--text-muted` = ink-gray-6 (#525252 ← #999)، `--text-light` و `--disabled-text-color` = ink-gray-5 (#7c7c7c ← #7a7a7a)، `--placeholder-color` = ink-gray-3 |
| الحدود | `--border-color` و `--table-border-color` = outline-gray-1، `--dark-border-color` = outline-gray-2، `--outline-gray-1..9` |
| الأساسي | `--primary` (#171717، لا يتبدل)، `--primary-color` = gray-900، `--btn-primary` = surface-gray-10 (gray-900 ← gray-50)، والنص عليه `--neutral` = ink-base (أبيض ← gray-950) |
| السلالم | `--{gray,blue,green,red,orange,amber,yellow,cyan,teal,violet,pink,purple}-50..950`، و `--ink-<لون>-1..10` (حبر يُقرأ على السطح، يتبدل في الداكن)، و `--surface-<لون>-1..10`، و `--outline-<لون>-1..10`، و `--bg-<لون>` و `--text-on-<لون>` |
| التنبيهات | `--alert-bg-{danger,info,success,warning}` و `--alert-text-*` (red/blue/green/yellow، تتبدل في الداكن) |
| الخط | `--font-stack` ("InterVariable", "Inter", … sans-serif)، `--text-2xs` 11، `--text-xs` 12، `--text-sm` 13، `--text-base` 14، `--text-lg` 16، `--text-xl` 17، `--text-2xl` 18، …؛ `--font-weight-{regular 420, medium 500, semibold 600, bold 700, black 800}` (والأسماء القديمة `--weight-*` بدائل مهجورة) |
| المسافات | `--padding-{xs 5, sm 7, md 15, lg 20, xl 30, 2xl 40}`، `--margin-{xs 5, sm 10, md 15, lg 20, xl 30, 2xl 40}`، `--spacing` 0.25rem، `--input-padding` 6px 8px |
| الأنصاف | `--radius-0..9` و `--radius-{sm 4, (بلا لاحقة) 8, md 10, lg 12, xl 16, 2xl 20, full}`. **`--border-radius-*` لم تعد موجودة في 16.53** (كانت مستعملة في `rv_page.css` و `rv_desk.bundle.scss` فصُحّحت) |
| الظلال | `--shadow-{sm,(بلا لاحقة),md,lg,xl,2xl}` = `--elevation-*` (القيم نفسها في الثيمين)، `--shadow-xs`، `--card-shadow` = shadow-sm، `--modal-shadow` = shadow-md، `--btn-shadow` = shadow-xs، `--focus-default` (حلقة التركيز، تتبدل في الداكن) |
| المقاسات | `--input-height` 28px، `--btn-height` 28px، `--list-row-height` 30px، `--checkbox-size` 14px، `--navbar-height` 48px، `--page-head-height` 48px. جدول تقارير Frappe (frappe-datatable) خلايا 33px ورؤوس 35px **بلا متغير** |
| الثيم | `frappe.ui.ThemeSwitcher.prototype.toggle_theme(theme)` يكتب `<html data-theme-mode>` ويحفظ `User.desk_theme` بـ `frappe.core.doctype.user.user.switch_theme`؛ `desk.js` يراقب `data-theme-mode` فيستدعي `frappe.ui.set_theme()` الذي يكتب `data-theme` |

## القرار
- **كل رمز من رموز واجهة التطبيق يُعرَّف من متغير Frappe**: `var(--frappe-var)`، وقيمة ثابتة فقط حيث لا متغير لـ Frappe (مكتوب بجانبها). الأسماء `--rv` نفسها باقية (`--bg --surface* --line* --tx* --pri* --hover --sel --sh-* --r-* --fs* --rh --ctl --pad --gap`) فلا يتغير أي مكوّن في معناه، والمقابلة في `rv_tokens.css`:

| رمز Report View | من Frappe |
|---|---|
| `--font` | `--font-stack` (الخط لا يُفرض على المكوّنات، يورث من Desk) |
| `--bg` / `--surface` / `--surface-2` / `--surface-3` / `--hdr` | `--bg-color` / `--card-bg` / `--subtle-accent` / `--subtle-fg` / `--subtle-fg` (رأس جدول Frappe) |
| `--line` / `--line-2` / `--line-3` | `--border-color` / `--dark-border-color` / `--outline-gray-3` |
| `--tx` / `--tx-2` / `--tx-3` / `--tx-4` | `--text-color` / `--ink-gray-7` / `--text-muted` / `--text-light` |
| `--pri` / `--pri-h` / `--pri-tx` / `--on-pri` | `--btn-primary` / `--surface-gray-9` / `--heading-color` / `--neutral` |
| `--pri-soft` / `--pri-soft-2` | `--sidebar-select-color` / `--surface-gray-3` |
| `--btn-bg` / `--btn-bg-h` / `--btn-ghost-h` (جديدة) | `--btn-default-bg` / `--btn-default-hover-bg` / `--btn-ghost-hover-bg` |
| `--ctl-bg` / `--ctl-line` / `--ctl-line-f` / `--focus` (جديدة) | `--control-bg` / بلا إطار (كـ `.form-control`) / `--outline-gray-4` / `--focus-default` |
| `--hover` / `--sel` / `--sel-line` | `--fg-hover-color` / `--surface-blue-2` / `--ink-blue-7` |
| `--grp` / `--grp-0` / `--foot` / `--total` | `--subtle-accent` / `--subtle-fg` / `--subtle-accent` / `--subtle-fg` |
| `--dr` / `--dr-soft` / `--cr` / `--cr-soft` | `--ink-blue-9` / `--surface-blue-1` / `--ink-red-8` / `--surface-red-1` |
| `--ok` / `--err` / `--warn` (+ `-soft`) / `--neu` | `--ink-green-9` / `--ink-red-8` / `--ink-amber-9` (`--surface-<لون>-1`) / `--text-muted` |
| `--c1..--c7` | `--ink-blue-8` `--ink-red-7` `--ink-green-8` `--ink-amber-8` `--ink-violet-7` `--ink-cyan-8` `--ink-gray-5` |
| `--sh-1` `--sh-2` `--sh-pop` `--sh-menu` `--sh-drawer` `--sh-open` `--sh-mini` | `--shadow-sm` `--card-shadow` `--shadow-lg` `--shadow-lg` `--shadow-2xl` `--shadow-sm` `--shadow-sm` |
| `--r-xs` `--r-sm` `--r` `--r-lg` `--r-xl` | `--radius-1` `--radius-3` `--radius` `--radius-md` `--radius-lg` |
| `--fs` `--fs-sm` `--fs-xs` | `--text-base` `--text-sm` `--text-xs` |
| `--fs-chart` (نص رسوم ECharts) | `--text-2xs` (مقاس قيم Frappe Charts) |
| `--ctl` / `--ctl-sm` / `--bh` | `--input-height` / `calc(--input-height − 4px)` / `--list-row-height` |
| `--rh` / `--hh` / `--fh` | 33px / 35px / 35px (مقاسات جدول تقارير Frappe، بلا متغير) |
| `--cp` / `--gap` / `--pad` | `--padding-sm` / `--margin-sm` / `--padding-md` |
| `--scrim` | `--gray-800` بشفافية 40% (لون خلفية نوافذ Frappe) |

- **الكثافة**: «مريح» = مقاسات Frappe. «مضغوط» يبقى خياراً من Report View مشتقاً منها (`--input-height` للصف، `--text-sm` للخط، `--padding-xs` و `--margin-xs`، والحقل `calc(--input-height − 4px)`). رموز الصفوف التي يقرؤها `css_int` (`--rh --cp --bh --hh --fh`) متغير واحد أو طول، لا `calc()`.
- **الثيم الداكن يتبع Frappe تلقائياً**: لا لوحة داكنة في `rv_tokens.css` ولا صنف `.rv.dark`؛ متغيرات Frappe تتبدل تحت `[data-theme=dark]` والرموز مبنية منها. القاعدة الوحيدة تحت `[data-theme=dark] .rv` لما لا متغير له في Frappe (ظل الورقة على المسرح الداكن، وظل حافة الأعمدة المثبتة).
- **زر الثيم في رأس الصفحة باقٍ**، ويبدّل ثيم **Frappe** نفسه للمستخدم كما يفعل محوّل ثيمات Frappe (`util.set_desk_theme` ← `ThemeSwitcher.prototype.toggle_theme`، ثم `frappe.ui.set_theme`)، فيتغير Desk كله والصفحة معه ويُحفظ في `User.desk_theme`. تفضيل `report_view:theme` المحلي أُلغي. لوحة الرسوم تعيد الرسم عند تغير `data-theme` على `<html>`.
- **مستقل عن الثيم عمداً**:
  - رموز الورقة المطبوعة `--pp-*`: الطباعة لا تصير داكنة. وخط الورقة الافتراضي حين لا يُختار خط `--pp-font-0` = `'IBM Plex Sans Arabic', var(--font-stack)` (الخط العربي الذي كانت الطباعة تخرج به، لا يتغير ناتج الطباعة).
  - ألوان تصميم ورق الشركة في المنشئ: بيانات (`letterhead/render.js`).
  - `--dr`/`--cr` ولوحة الرسوم `--c1..c7` تبقى بمعناها، لكن من سلالم ألوان Frappe (`--ink-<لون>-N` التي يبدلها Frappe للداكن). التباين المقاس (WCAG) للنص على `--surface` و `--hdr` و `--total`: الفاتح `--dr` 6.7/6.0/6.0، `--cr` 6.7/6.0/6.0، `--ok` ≥ 6، `--warn` 7.1/6.4؛ الداكن `--dr` 11.4/9.2، `--cr` 6.9/5.6/5.6، `--ok` ≥ 9، `--warn` 10.9/8.8. لوحة الرسوم على السطح ≥ 4.5 إلا `--c4` (كهرماني) 3.9 في الفاتح، وهو لعلامات الرسم فقط (WCAG 1.4.11 يطلب 3:1). `--tx-4` (`--text-light`) 4.2:1 كما في Frappe، للقيم الصفرية والتلميحات والنص البديل.
- **أُزيل ما يعاند Desk**: `font-family` على المكوّنات (الأزرار والحقول ومربعات النص)، وإعادة رسم حقول Frappe في فلاتر التقرير (الإطار والخلفية والخط والارتفاع والتركيز: تبقى `.form-control` كما يرسمها Frappe بارتفاع الكثافة فقط)، وخلفية زر الرابط، وإطار قائمة MultiSelect وخلفيتها وظلها، ومربع الاختيار الأصلي بلون العلامة (يرسمه Frappe الآن)، و `accent-color`، وخلفية `.rv` نفسها. أزرارنا (`.rv-btn`) وحقولنا (`.rv-input`، البحث، حقل الفترة، فلاتر الأعمدة، منتقي الخط، القوائم) صارت بشكل `.btn` و `.form-control` في Frappe: بلا إطار، خلفية `--btn-default-bg` / `--control-bg`، نصف قطر `--radius`، وحلقة `--focus-default`.
- **حزمة الاختبار البصري** تحمّل CSS Desk المبني (كما كانت)، و `dist/fonts.css` يعرّف `--font-stack` كما يغذيه ثيم موقع: Inter من Frappe ثم الخط العربي للتطبيق، فتُرسم الصور نفسها على كل جهاز. المعامل `pref=dark` صار يضبط `data-theme`.

## العواقب
- الصفحة جزء من Desk: الخط والألوان والحدود والأزرار والحقول ومقاساتها من Frappe، وأي ثيم موقع يغيّر متغيرات Frappe يغيّرها هنا دون عمل. هوية التطبيق الخضراء القديمة (`#1E5C45`) لم تعد في الواجهة؛ بقيت لوناً افتراضياً لتصميم الورقة المطبوعة («حديث») فقط.
- ترقية Frappe قد تعيد تسمية متغير (كما سقطت `--border-radius-*` في 16.53): متغير غير معرَّف يجعل الرمز فارغاً. يُراجَع `rv_tokens.css` مع كل ترقية رئيسية (قائمة المتغيرات أعلاه).
- الرموز تُحسب على `.rv` من متغيرات العنصر نفسه، فداخل نافذة Frappe (حيث يغيّر Frappe `--control-bg` و `--border-color` في الداكن) تتبع الرموز النافذة تلقائياً.
- `reference/design/` يبقى مرجعاً للتخطيط والسلوك والمكوّنات، لا للألوان والخط والمقاسات.
