# المرحلة 3 — جزء الواجهة

كتبه المنسّق من التقرير النهائي لوكيل `frontend-dev` ومن إصلاحات المنسّق بعده.

## ما بُني
| المسار | المحتوى |
|---|---|
| `report_view/report_view/page/report_view/` | مستند Page `report-view` (وحدة Report View، دور `Desk User`)؛ `report_view.js` يحمّل Arquero ثم `report_view.bundle.js` و `.css` بـ `frappe.require` |
| `public/js/report_view/adapter/` | `columns.js`، `classify.js`، `tree.js`، `normalize.js`، `enrich.js`: المحوّل حسب §3 المعدّل |
| `public/js/report_view/engine/` | `aggregate.js`، `filter.js`، `sort.js`، `group.js` (Arquero)، `tree_view.js`، `engine.js`؛ إجمالي الشجرة = مجموع الجذور بلا فلتر عرض، والمجموعات من الأوراق، ولا إجمالي لعملات مختلطة؛ `expected()` يبني كتلة `expected` لنموذج التصدير |
| `public/js/report_view/state/` | `view_state.js`، `url.js` (المعامل `rv` بـ base64url، يُحذف فوق 2,000 حرف، تحديث بعد 300 ms) |
| `api.js`، `format.js` | نداءات الخادم وقراءة `exc_type`؛ Excel بـ `fetch` لعرض خطأ JSON؛ `frappe.format` بـ `{inline: true}` والـ formatter الأصلي للصفوف الأصلية فقط |
| `filters/facade.js`، `report_filters.js` | كائن الواجهة ADR-006 (يُعاد عند الإخفاء، ويرمي لأي عضو غير مدعوم في وضع التطوير)؛ الفلاتر بـ `make_control` مع default و reqd و depends_on و on_change و get_query وقيم الرابط، و `js_filters` مع كل تشغيل |
| `views/grid_view.js` | Tabulator بـ dataTree، أشرطة الرؤوس، عمود أول مثبّت، `bottomCalc` يعيد قيم المحرك، `textDirection` للـ RTL؛ التجميع بعنصر MultiSelectList |
| `components/states.js` | تحميل، خطأ، لا نتائج، too_large، prepared_pending/missing، فلاتر ناقصة، تقرير غير مفعّل |
| `index.js`، `register.js`، `configs/trial_balance.js`، `report_view.bundle.js` | الصفحة، التسجيل، إعداد ميزان المراجعة |
| `public/css/` | `rv_tokens.css` (من `rv.css`)، `rv_components.css` (خصائص منطقية فقط)، `report_view.bundle.scss` |
| `tests/js/` | `normalize.test.mjs`، `engine.test.mjs`، `state.test.mjs` |
| `tests/e2e/trial_balance.spec.js` | كتبه المنسّق (انظر أدناه) |

## النتائج
```
npm run test:js          → pass 27, fail 0
bench build --app report_view → DONE (report_view.bundle.js 972 KB، bundle.css 45 KB)
npx playwright test trial_balance → 6 skipped
```
- الحالات المشتركة الأحد عشر: ناتج المحوّل JS يطابق `expected` تماماً دون تعديل الحالات.
- الإجماليات في `engine.test.mjs`: ميزان المراجعة (الشجرة) = صف `'Total'`؛ AR = صف مجموع Frappe؛ AR حسب الطرف و GL = آخر مجموع داخلي. `balance` و `age` مستثنيان (ADR-008).
- Playwright: الاختبارات الستة تُتخطى برسائل واضحة لأن `RV_E2E_USER` غير معرّف ومستخدمي `rv_*` غير موجودين.

## إصلاحات المنسّق
- **البناء كان يفشل** (ذكر الوكيل أنه نجح دون قراءة المخرجات): `@import` في `report_view.bundle.css` لا يُحل في مجلد البناء المؤقت ⇒ حُوّل إلى `.scss` بمسارات SCSS. ومصدر Arquero 8 يستورد `@uwdata/flechette` بأرقام BigInt و `for await`، وهدف البناء في Frappe es2017 ثابت ⇒ Arquero يُحمَّل من `node_modules/arquero/dist/arquero.min.js` كملف مستقل، ويُحقن في المحرك بـ `use_arquero` (مع الرجوع إلى `globalThis.aq`). الاختبارات في node تمرّر الحزمة نفسها.
- مستند الصفحة زُامن بـ `bench --site $SITE reload-doc report_view page report_view`؛ الضيف يُحوَّل إلى تسجيل الدخول.
- ترجمات نصوص الواجهة (34) أُضيفت إلى `report_view/locale/ar.po`.

## انحرافات
- `test:js` = `node --test 'tests/js/*.test.mjs'` لأن Node 24 لا يقبل مجلداً.
- `public/js/report_view/package.json` بـ `"type": "module"` ليستورد node الوحدات؛ جذر المستودع `commonjs`.
- المحوّل JS يقبل الترجمات العربية لـ «Opening» و «Closing (Opening + Total)» و «Total»؛ بايثون يقبل الإنجليزية فقط. الحالات المشتركة بالإنجليزية فلا يظهر الفرق.
- `configs/trial_balance.js` يضيف `bands` و `columns[*].band/side` للرؤوس المجمّعة؛ غير مذكورة في §5.1 وتُضاف إليه في المرحلة 4.

## أسئلة مفتوحة
- التجميع يبني المجموعات من الأوراق، فالعمودان الختاميان فيه مجموع أرصدة صافية (24,653,599) لا يقابل صف الأصل (7,553,469). مطابق لـ N4.7 لكنه قد يربك المستخدم.
- §13.2: من الكود `_right` في `formatters.js:11-17` يعيد القيمة المجردة عند `inline`. لم يُتحقق في المتصفح.

## لم يُنجز
- لا تحقق في المتصفح إطلاقاً: RTL/LTR، فاتح/داكن، 390px، console. السبب غياب حساب دخول للاختبار.
- لا لقطات شاشة.

---

## مطابقة التصميم — الخطوة 1

قرار صاحب المشروع: تقديم مطابقة التصميم على بقية المرحلة 3. المرجع: `reference/prototype/rv.css` و `Main.dc.html` (العناصر 1-16، 25، 32، 35، 45-52، 66) وجدول الربط في `Tokens.dc.html`.

### ما تغيّر
| الملف | التغيير |
|---|---|
| `public/css/rv_components.css` | طبقة المكوّنات من `rv.css` كاملة (الأسطر 61-585) أساساً للتنفيذ. الخصائص الفيزيائية حُوّلت إلى منطقية (مقبض المفتاح، حواف التحديد، علامة التبويب الجانبي، رأس اللوحة، جهة الدرج، الأشرطة الأفقية)، ومحاذاة الأرقام الخاصة بـ RTL في النموذج لها مرآة LTR في آخر الملف |
| `public/css/rv_tabulator.css` (جديد) | ربط Tabulator حسب `Tokens.dc.html`: `.tabulator-header` = `.rv-head`، مجموعة الأعمدة = `.rv-hg` وعنوانها = `.rv-band`، `.tabulator-row` = `.rv-row` (+ `group d0-2` / `foot` / `bold`)، `.tabulator-cell` = `.rv-c` (+ `num dr cr zero neg band-end`)، صف `bottomCalc` = `.rv-row.total`، العمود المثبّت بظل الحافة، الفواصل القصيرة للرؤوس وخط نهاية الشريط. كل محدد يبدأ بـ `.rv .tabulator` ليتقدّم على `tabulator.min.css` وقواعده الخاصة بـ RTL |
| `public/css/rv_page.css` (جديد) | إطار الصفحة داخل Frappe، عناصر Frappe داخل `.rv-field` بشكل `.rv-input`، الحالات، و 390px |
| `public/css/rv_tokens.css` | `--font` يرجع إلى `--font-stack` في Desk إن لم يتوفر IBM Plex Sans Arabic |
| `components/header.js` (جديد) | مسار التنقل (الوحدة › التقارير › التقرير)، العنوان ووسم النوع من `get_meta`، سطر المعلومات (الشركة، الفترة `from_date–to_date` أو «بتاريخ» أو السنة المالية، العملة من المحرك، وقت آخر تشغيل بـ `frappe.format`)، مفتاح الكثافة، زر الثيم، Excel حسب `perms.can_export` |
| `components/toolbar.js`، `status_bar.js`، `icons.js` (جديدة) | مبدّل العرض (جدول مفعّل؛ Pivot ورسوم `aria-disabled` بتلميح «قريباً»)، التجميع بعنوان واحد؛ شريط الحالة «الصفوف X من Y · المجموعات N»؛ الأيقونات SVG بـ `currentColor` |
| `index.js` | الإطار الجديد؛ شريط الخادم بعلامته وملاحظته وزر «تشغيل التقرير»؛ حالة «معلّق» حين تختلف الفلاتر عن آخر تشغيل، ولا تشغيل تلقائي بعد أول تشغيل (قبله يبقى السلوك الأصلي)؛ الثيم يتبع `data-theme` في Desk (قيمة محلولة فاتح/داكن حتى في الوضع التلقائي، `theme_switcher.js:156-162`) والزر يحفظ اختياراً محلياً في `localStorage["report_view:theme"]`؛ الكثافة في `state.ui.density` و `localStorage["report_view:density"]`؛ ارتفاع الجدول يملأ النافذة ويُعاد حسابه مع تغيّر شريط الخادم |
| `filters/report_filters.js` | كل فلتر `.rv-field`: عنوان فوق عنصر Frappe (`make_control` بـ `only_input`)، علامة `*` للإلزامي؛ Check يبقى بعنوان Frappe بجانب المربع |
| `filters/facade.js` | `refresh()` من سكربت التقرير يمر بمنطق «معلّق» نفسه |
| `format.js` | الصفر (بدقة إعدادات النظام: `precision` للعمود ثم `currency_precision`/`float_precision`، كما في `frappe.form.formatters`) يظهر «—» بصنف `.zero`؛ السالب `.neg`؛ خلية «رقم + اسم» `.rv-acc` مع إبقاء رابط formatter التقرير؛ عدّاد `.rv-gcount` |
| `views/grid_view.js` | `dataTreeExpandElement/CollapseElement` = `.rv-caret`، `dataTreeBranchElement: false` (المسافة البادئة `--ind`)، `.rv-caret-sp` للأوراق، `columnHeaderVertAlign: "bottom"`، `selectableRows: false` (كان سبب الرمادي عند المرور/النقر: `tabulator-selectable:hover` الافتراضي)، `layout: "fitData"` بعرض 320px للعمود الأول (أضيق على الجوال) و 138px للأرقام |
| `configs/trial_balance.js` | أشرطة «الرصيد الافتتاحي/حركة الفترة/الرصيد الختامي»، عناوين «مدين/دائن»، `side: dr/cr`، `tree.number_key/name_key` |
| `engine/engine.js`، `tree_view.js` (للعرض فقط) | `fact_count`، `group_count`، `currency` في ناتج `apply`؛ `__count` (عدد الأوراق) لآباء الشجرة. لا تغيير في أي حساب |
| `state/view_state.js` | `ui.density` في المخطط (§7.1) |
| `locale/ar.po` | 37 نصاً جديداً؛ حُذف «Refresh» و «{0} rows» (لم يعودا مستخدمين) |
| `tests/visual/` (جديد) | `harness.html` + `harness.mjs` + `stubs.mjs` + `build.mjs` + `screens.spec.js` + `playwright.config.js`؛ `tests/visual/dist/` في `.gitignore` |
| `tests/js/engine.test.mjs` | اختبار للعدّادات الجديدة |

### المنصة البصرية
`build.mjs` يبني بـ esbuild الموجود لدى frappe صفحة Report View الحقيقية (`index.js` وكل المكوّنات و CSS التطبيق كما في الحزمة) مع: `desk.bundle.css` المبني في هذا الـ bench (RTL للعربية)، ترجمات frappe و erpnext و report_view من ملفات `.po`، وخط IBM Plex Sans Arabic من ملفات woff2 الموجودة في الـ bench (للاختبار فقط، لا يُشحن). `stubs.mjs` بديل صغير لـ `__` و `frappe.format` (دقة Float = 3 مثل موقع صاحب المشروع، Currency = 2) و `make_control` يولّد DOM عناصر Frappe نفسه. البيانات من `trial_balance_fy2026.json` و `accounts_receivable_frappe_total.json`، والإثراء (`root_type`) مولّد من أول رقم في الحساب، و formatter تقرير الميزان محاكاة لشكل `erpnext.financial_statements.formatter` (رابط + خط عريض للمجموعات).

### الصور (`docs/progress/screens/phase-3/`)
| الملف | الحالة |
|---|---|
| `tb-tree-light-rtl.png` | ميزان المراجعة شجرة، فاتح، عربي |
| `tb-tree-dark-rtl.png` | داكن (ثيم Desk داكن) |
| `tb-tree-light-ltr.png` | إنجليزي LTR |
| `tb-tree-compact-rtl.png` | مضغوط |
| `tb-group-root-type-rtl.png` | تجميع بمستوى واحد (نوع الجذر) |
| `ar-group-party-rtl.png` | الذمم المدينة مجمّعة حسب الطرف |
| `tb-tree-390-rtl.png`، `tb-tree-390-dark-ltr.png` | عرض 390px (الثاني بزر الثيم الداكن، إنجليزي) |
| `tb-pending-rtl.png` | شريط الخادم «معلّق» بعد تغيير فلتر |

### ما يطابق التصميم
- رؤوس رمادية فاتحة (`--hdr`) بأشرطة «الرصيد الافتتاحي/حركة الفترة/الرصيد الختامي» وخط نهاية كل شريط، فواصل قصيرة بين الرؤوس.
- صفوف مجموعات بسهم `.rv-caret` وعدّاد دائري `.rv-gcount`، وخلفية `--grp-0` للعمق الأول و `--grp` لما بعده، ووزن 600.
- أرقام `tabular-nums` داخل `<bdi class="rv-n">` بمحاذاة نهاية السطر؛ مدين `--dr` أزرق ودائن `--cr` عنابي؛ الأصفار «—» بلون `--tx-4`؛ السالب `--cr`.
- «الإجمالي العام» مثبّت أسفل الجدول بخلفية `--total` وخط `--line-3` وأرقام 700 ملونة، مع عدد الصفوف.
- العمود الأول «الحساب» مثبّت على اليمين (RTL) / اليسار (LTR) بظل الحافة، رقم الحساب رمادي `--tx-3` ثم الاسم.
- الإطار العلوي، شريط الخادم بعلامته وحالة «معلّق» (`--warn-soft`)، مبدّل العرض، شريط الحالة، الكثافة، الداكن، RTL/LTR، 390px.
- الألوان كلها متغيرات؛ لا لون ثابت في JS.

### ما يختلف ولماذا
| الفرق | السبب / البديل |
|---|---|
| لا صف «إجمالي …» (المجموع الفرعي `.rv-row.foot`) تحت كل مجموعة | يولّده المحرك كصف ابن أخير (`__kind: "group_footer"`)، وهو #47 في المرحلة 5أ؛ CSS `.foot` جاهز ومطبّق الآن على صفوف `internal_total/opening/closing` للتقرير |
| لا فلاتر عائمة ولا قوائم أعمدة ولا فرز من الرأس، ولا بحث بالشرائح ولا المفضلة ولا بطاقات الملخص ولا لوحة مجموعات بالسحب | عناصر المراحل 5أ-5هـ (§11.1)؛ التجميع الحالي عنصر MultiSelectList من Frappe في شريط الأدوات |
| عناوين الأعمدة المُثرية («نوع الجذر»، «نوع الحساب») ظاهرة وقيمها بالإنجليزية (Asset) | الإثراء يعطي `fieldtype: "Data"` فلا يترجم `frappe.format` القيمة؛ التصميم يخفي الأبعاد افتراضياً. إخفاؤها الافتراضي وترجمة قيم Select في المحوّل خارج هذه الخطوة |
| عنوان «Account» في الصور بالإنجليزية | الحالة المشتركة مسجّلة بالإنجليزية؛ على الموقع يأتي العنوان مترجماً من الخادم (`_()` في ERPNext). أسماء أعمدة الفترات مثل «Jul 2026» (Sales Analytics) تأتي من ERPNext وتمر بـ `__()` كما هي بلا ترجمة خاصة |
| وسم النوع بالعربية («تقرير النصي») بدل «Script Report» بالإنجليزية في التصميم | القاعدة: كل نص ظاهر يمر بـ `__()`، وترجمة Frappe لـ Script Report هي هذه |
| رمز العملة قد يظهر في خلايا Currency على الموقع | `frappe.format` يتبع `hide_currency_symbol` في إعدادات النظام؛ التصميم بلا رمز. لم أغيّره (قاعدة التنسيق) |
| الخط: IBM Plex Sans Arabic غير مضمّن في التطبيق | الصور تستخدمه (من ملفات الـ bench، للاختبار فقط). على الموقع يرجع `--font` إلى خط Desk. تضمين الخط يحتاج قراراً (أصل جديد) |
| القوائم المنسدلة لعناصر Frappe (awesomplete، datepicker، MultiSelectList) تبقى بألوان Desk | ليست تحت `.rv`؛ إذا اختار المستخدم الداكن بالزر و Desk فاتح تبقى فاتحة |
| الأرقام في صفوف المجموعات 700 لا 600 | formatter تقرير ERPNext يلفّها بـ `font-weight: bold` مضمّن؛ نتركه كما في الأصل (§9.3) |
| على 390px يُقتطع اسم الحساب | العمود المثبّت 50% من العرض (170px على الأقل)؛ عرض الجوال الخاص (#86-91) في 5هـ |
| مسار التنقل داخل الصفحة يكرر مسار Frappe في رأس الصفحة | التصميم يضعه في الصفحة؛ ونستدعي `frappe.breadcrumbs.add(module)` كما تفعل query-report |

### الأوامر والنتائج
```
npm run -s test:js                                   → tests 28, pass 28, fail 0
node tests/visual/build.mjs && npx playwright test -c tests/visual
                                                     → 9 passed (8 لقطات + اختبار «معلّق»)، بلا أخطاء ولا تحذيرات console
bench build --app report_view                        → DONE، بلا ERROR (report_view.bundle.js 995 KB، bundle.css 102 KB)
bench compile-po-to-mo --app report_view --locale ar --force → MO file created
```

### لم يُتحقق منه
- لا تحقق على `$SITE` نفسه (لا حساب دخول): سلوك عناصر Frappe الحقيقية (awesomplete، datepicker) داخل `.rv-field`، و console الموقع، ومسار التنقل في رأس Desk. المنصة البصرية تستخدم CSS Desk الحقيقي و DOM العناصر نفسه، لا JS Frappe.
