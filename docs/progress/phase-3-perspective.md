# المرحلة 3 — إعادة محرك الحساب وعرض الجدول فوق Perspective و regular-table

- الفرع: `phase-3-perspective` (بلا commit؛ التغييرات في شجرة العمل)
- التاريخ: 2026-10-01
- المرجع: ADR-012، `docs/architecture.md` §3.2أ (N8، N9)، §8أ، §9.2، §11.1-11.3، `docs/research/perspective-experiments.md`
- كتبه وكيل `frontend-dev`

## 1. ما حُذف
| المحذوف | ملاحظة |
|---|---|
| `tabulator-tables` و `arquero` من `package.json` و `package-lock.json` | `npm uninstall tabulator-tables arquero` |
| `public/js/report_view/engine/aggregate.js`، `filter.js`، `sort.js`، `group.js`، `tree_view.js`، `engine.js` | محرك JS القديم (562 سطراً) |
| `public/js/report_view/views/grid_view.js` القديم | أُعيدت كتابته على `regular-table` |
| `public/css/rv_tabulator.css` واستيراد `tabulator.min` في `report_view.bundle.scss` | حل محله `rv_table.css` |
| تحميل `arquero.min.js` في `page/report_view/report_view.js` | الصفحة تحمّل `report_view.bundle.js` و `.css` فقط |
| `tests/js/engine.test.mjs` القديم، و Tabulator/Arquero من `tests/visual/` | |

التحقق: `grep -rnil "tabulator\|arquero" --exclude-dir=node_modules --exclude-dir=docs --exclude-dir=reference --exclude-dir=.git .` يعيد `CLAUDE.md` و `.claude/agents/frontend-dev.md` فقط (سطرا المنع). المخرجات المبنية (`public/dist`، `tests/visual/dist`) خالية منهما أيضاً.

## 2. ما بُني

### المحرك `report_view/public/js/report_view/engine/`
| الملف | المحتوى |
|---|---|
| `schema.js` (خالصة) | `perspective_type(fieldtype)`؛ `to_float` / `to_date` / `to_datetime` / `to_boolean` / `to_string` و `convert(type, value)` حسب جدول N8 (كل قيمة إلى نوعها أو `null`، و `Int` يُحمَّل `float`)؛ `sort_keys(values, collator)` و `make_collator(locale)` لأعمدة `__sort__<key>`؛ `aux_currency_keys(columns)` (مفاتيح عملة الصف غير الموجودة كأعمدة)؛ `build_table_input(columns, rows, {locale, extras})` يعيد `{schema, data, size}` بصيغة أعمدة مع `__rid` و `__kind`؛ `batches(data, total, 50000)` |
| `tree_nodes.js` (خالصة) | `tree_index(normalized)`؛ `build_nodes(normalized)`: صفوف `data` و `group_header` بترتيبها مع `__depth`، `__has_children`، `__leaves`، `__path` (مفتاح المسار)، `__top`، `__anc_1..n`؛ `build_facts(normalized)`: الأوراق مع `level_1..n` (الناقص يُملأ بعنوان الورقة نفسها)، `__path`، `__levels`، وخريطة `level_rids` (مسار العناوين ⇒ `__rid` العقدة)؛ `row_label` |
| `view_config.js` (خالصة) | `to_view_config(view_state, normalized, mode)` ⇒ `{table, config, post}` حسب جدول §8أ.2؛ `AGGREGATES` (`max`→`high`، `count_distinct`→`distinct count`)؛ `to_filter(filters, columns)` (بلا `between` وبلا `filter_op: "or"`، وما لا يُعبَّر عنه يعاد في `notices`)؛ `visible_columns`؛ `tree_depth`؛ `toggle_tree_node(view_state, normalized, rid)` |
| `perspective_engine.js` | التحميل بطريقة §8أ.1 بالضبط: `VERSION = "3.8.0"`، `BASE = /assets/report_view/node_modules/@finos/perspective/dist`، `init_server` و `init_client` بـ `fetch(...?v=3.8.0)` مرة واحدة، `new Worker(BASE + "/cdn/perspective-server.worker.js?v=…", {type: "module"})` ثم `perspective.worker(Promise.resolve(worker))`؛ `warm_up()`، `get_engine()`، `dispose_engine()`، `schedule_dispose(60000)`، `cancel_dispose()`، `debug_handles()`، وإنهاء فوري عند `beforeunload`. الصنف `EngineHandles`: `table`، `view`، `latest_view` (رقم جيل لكل خانة)، `delete`، `with_view` (حذف في `finally`)، `delete_all`، `abandon`، `is_alive`، `debug_handles`. الصنف `ReportSession`: `create` / `load` (جدول `facts`، ومعه `nodes` للتقارير الشجرية، على دفعات)، `open(view_state, mode)` ⇒ `{spec, post, view, body_rows, totals, counts, expected}`، `toggle_group`، `close_view`، `close` |
| `queries.js` | `unique_values`، `range_stats` (الاستثناء الوحيد المسمّى)، `read_total_row`، `totals`، `count_rows`، `count_groups`، `body_rows`، `set_depth`، `toggle_group`. عمود إجمالي التحليل يأتي مع عرض Pivot |

قواعد `EngineHandles` المنفَّذة (§8أ.3): كل مقبض يُسجَّل ويُعاد داخل `Proxy`؛ أي نداء على مقبض محذوف يرمي خطأً فوراً؛ `handle.delete()` المباشر يرمي (الحذف عبر المدير فقط)؛ `delete()` مرتين يرمي؛ حذف الجدول يحذف عروضه أولاً؛ النداءات الجارية على مقبض تُنتظر قبل حذفه؛ `view` يكتمل إنشاؤه بعد بدء حذف جدوله يحذف نفسه.

### العرض
| الملف | المحتوى |
|---|---|
| `views/grid_view.js` | `GridView` على `<regular-table>`: `read()` نموذج بيانات افتراضي (`setDataListener`) يقرأ نوافذ `view.to_columns`؛ `read_records()` يحدد نوع كل صف (صف تقرير بـ `__rid`، أو مجموعة حسبها Perspective)؛ `style()` (`addStyleListener`) يضبط أصناف الرؤوس والصفوف والخلايا ومحتواها؛ `render_total()` الإجمالي العام عنصراً مثبّتاً خارج التمرير؛ `click()` / `toggle_group()` للطي والفتح؛ `show()` يبدّل الـ `view` ثم يرسم |
| `views/rtl_adapter.js` | `apply_rtl(rt)`: المحوّلان (عكس إشارة `scrollLeft`، ونقل قيد `sticky` إلى اليمين داخل Shadow DOM) |
| `css/rv_table.css` | ربط `rv.css` بعناصر `regular-table` (`thead th.rv-hb/.rv-hd`، `tbody tr.rv-tr.group.d0-2`، `td.num/.dr/.cr/.zero/.neg/.band-end`، خلية العنوان `.rv-lc`، ظل العمود المثبّت، الإجمالي). خصائص منطقية فقط، وكل الألوان متغيرات |
| `format.js` | أضيف `node_label_html` (عنوان عقدة شجرية في العرض المعاد تجميعه، بلا formatter التقرير) |

### الربط `index.js`
استُبدل موضع المحرك والعرض فقط: `open_session()` يحمّل الجدولين، `render_view()` يفتح الـ `view` الجديد ثم يبدّله في الجدول ثم يحذف القديم، `close_session()` عند تبديل التقرير وإعادة التشغيل والخطأ ومغادرة الصفحة، `reopen()` عند العودة، `toggle_tree()`، `update_status()` (§8أ.5)، `expected` لنموذج التصدير من `view` (§8أ.6)، `debug_totals()` بالشكل نفسه، `debug_handles()`. التجميع البسيط (MultiSelectList) يعدّل `state.group.by` ثم `render()`. الإطار والفلاتر وشريط الأدوات وشريط الحالة والحالات والتصدير لم تتغير. المحوّل JS (`adapter/`) لم يتغير.

### الاختبارات
- `tests/js/schema.test.mjs` (9)، `tree_nodes.test.mjs` (3)، `view_config.test.mjs` (8)، `engine.test.mjs` (15، في node عبر `@finos/perspective`)، مع `normalize.test.mjs` و `state.test.mjs` السابقين.
- `tests/visual/`: `serve.mjs` (خادم يخدّم `/assets/report_view/node_modules/…` بنوع `application/wasm`، ومخرجات `bench build`)، `harness_page.mjs`، `harness.mjs`، `harness_built.mjs`، `build.mjs` (هدف es2017 مثل Frappe)، `screens.spec.js` (17 اختباراً).

## 3. نتائج الاختبارات والبناء
```
npm run -s test:js
  → tests 52, pass 52, fail 0

node tests/visual/build.mjs && npx playwright test -c tests/visual
  → 17 passed (23.2s)، بلا أخطاء ولا تحذيرات console
    (المستثنى الوحيد: تحذير Perspective «Unknown browser detected» في headless shell، ADR-012)

bench build --app report_view        (قُرئت المخرجات كاملة؛ لا ERROR ولا ✘)
  report_view/dist/js/report_view.bundle.4SPQK2P3.js      245.88 Kb   (كان 995 Kb)
  report_view/dist/css/report_view.bundle.JE4CLCJP.css     67.02 Kb   (كان 102 Kb)
  report_view/dist/css-rtl/report_view.bundle.VFGSIAXO.css 67.02 Kb
  DONE  Total Build Time: 1.050s
sites/assets/assets.json و assets-rtl.json: المسارات الثلاثة تشير إلى ملفات موجودة.
curl على الموقع: الـ bundle و CSS ⇒ 200؛ perspective-server.wasm و perspective-js.wasm ⇒ 200 application/wasm؛
  perspective-server.worker.js ⇒ 200؛ arquero.min.js ⇒ 404.

npx playwright test   (tests/e2e على الموقع)
  → 1 passed (smoke)، 6 skipped (trial_balance: لا RV_E2E_USER ولا مستخدمو rv_*)،
    5 failed في login.spec.js (مستخدمو rv_* غير موجودين؛ حالة سابقة لا علاقة لها بهذا العمل)
```
ما تثبته الاختبارات:
- **(أ) الشجرة «كما هي»:** 31 صفاً بترتيب التقرير، كل الآباء الـ 15 والأعمدة الستة بقيمها، والإجمالي = صف `'Total'`.
- **(ب) التجميع:** على المستويات (شجرة معاد تجميعها بفلتر) مجاميع كل أب = جمع يدوي لأوراقه، و31 صفاً بلا نسخ مكررة للأوراق القصيرة؛ وعلى بُعد (`party`) مجاميع كل مجموعة = جمع يدوي، والمجموعات بترتيب `Intl.Collator`، وصفوف الحقائق تحتها بترتيب التقرير.
- **(ج) AR:** مجاميع الأعمدة = صف مجموع Frappe.
- **(د) دورة الحياة:** في node: لا مقبض ولا جدول مستضاف بعد 20 تبديلاً بين تقريرين، والذاكرة المستعملة لا تكبر. في المتصفح: بعد 20 إعادة تشغيل وتغيير حالة يبقى جدولان و `view` واحد بالضبط، وبعد مغادرة الصفحة صفر، وبعد إنهاء الـ worker والعودة يعمل المحرك من جديد.
- **المتصفح:** التمرير الأفقي في RTL و LTR يُبقي عمود العنوان مثبّتاً ويصل آخر عمود والإجمالي متراصف مع الرؤوس؛ التمرير العمودي يقرأ نوافذ ويصل آخر صف؛ الطي في الشجرة فلتر محرك (`["__anc_1", "not in", [0]]`) ولا يغيّر الإجمالي؛ فتح وطي مجموعة عبر `view.expand/collapse`.
- **الـ bundle الذي كتبه `bench build`** نفسه يُحمَّل في المنصة (`?built=1`) ويعرض الصفحة ويجلب ملفي WASM والـ worker من `/assets/report_view/node_modules/…?v=3.8.0`.

## 4. مطابقة الإجماليات (المحرك مقابل مرجع التقرير، من الحالات المشتركة)
| الحالة | الشكل | المرجع | النتيجة |
|---|---|---|---|
| Trial Balance 2026 | شجرة «كما هي» | صف `'Total'` | افتتاحي 0 / 0، حركة 30,303,624 / 30,303,624، ختامي 7,553,469 / 7,553,469 — مطابق في الستة |
| Trial Balance 2026 | تجميع أو فلتر متصفح | لا مقابل في رد التقرير (N9) | الحركة 30,303,624؛ الختامي 24,653,599 = مجموع الأوراق (يساوي التقرير مع `show_group_accounts=0`) |
| Accounts Receivable | مسطح | صف مجموع Frappe | invoiced 92، paid 66,148، outstanding −66,056، age 1,801، range1 −11,965، range2 −53,622، range3 −469 — مطابق (الأعمدة الفارغة في المرجع بلا مقارنة) |
| Accounts Receivable (group_by_party) | مسطح | آخر `internal_total` | مطابق في 9 أعمدة (invoiced، paid، credit_note، outstanding، range1-5) |
| General Ledger (حسب الحساب، وموحّد) | مسطح | آخر `internal_total` | debit و credit = 2,521,940 مطابق؛ `balance` رصيد متراكم مستثنى (ADR-008) |
| Stock Balance، Stock Projected Qty | مسطح | صف مجموع Frappe | مطابق في كل عمود له قيمة مرجعية |

## 5. الصور (`docs/progress/screens/phase-3-perspective/`)
| الملف | الحالة |
|---|---|
| `tb-tree-light-rtl.png`، `tb-tree-dark-rtl.png`، `tb-tree-light-ltr.png`، `tb-tree-compact-rtl.png` | ميزان المراجعة شجرة: فاتح وداكن RTL، فاتح LTR، مضغوط |
| `tb-tree-390-rtl.png`، `tb-tree-390-dark-ltr.png` | عرض 390px |
| `tb-group-root-type-rtl.png`، `ar-group-party-rtl.png` | تجميع بمستوى واحد |
| `tb-pending-rtl.png` | شريط الخادم «معلّق» |
| `ar-scroll-x-rtl.png` | **جديد:** بعد تمرير أفقي في RTL |
| `tb-tree-collapsed-rtl.png`، `tb-group-collapsed-rtl.png` | **جديد:** بعد طي أب في الشجرة، وبعد طي مجموعة |
| `tb-filter-levels-rtl.png` | **جديد:** شجرة بفلتر متصفح (معاد تجميعها على المستويات) |
| `tb-tree-built-bundle-rtl.png` | **جديد:** الصفحة من مخرجات `bench build` |

فتحت الصور وقارنتها بصور `docs/progress/screens/phase-3/`. تطابقها في: الأشرطة وخط نهاية كل شريط، الفواصل القصيرة، ارتفاعات الرؤوس والصفوف، صفوف المجموعات (السهم، الرقم الرمادي ثم الاسم، العدّاد، خلفية العمق)، ألوان المدين والدائن، «—» للصفر، الإجمالي المثبّت، ظل العمود المثبّت، الداكن، المضغوط، LTR، 390px.

ما يختلف عن الصور السابقة:
| الفرق | السبب |
|---|---|
| شريط الحالة في الشجرة «الصفوف 31 من 31» بدل «16 من 16» | §8أ.5: عدد صفوف الـ `view` من حجم جدوله (جدول العقد 31) |
| إزاحة 1px في موضع الصفوف | خط أسفل الرأس جزء من خلية الرأس |
| لا تغيير لعرض الأعمدة بالسحب | كان يأتي من Tabulator؛ في المعمارية عنصر #39 في 5أ، ومقبض المكتبة يفترض LTR فأُخفي |

## 6. انحرافات عن المعمارية وأسبابها
1. **صفوف الحقائق تحت المجموعات = `__rid` كآخر مستوى في `group_by`.** §8أ.2 لا يذكره. بدونه لا يعرض `view` المجمَّع إلا المجاميع، والصور المرجعية تعرض صفوف التقرير تحت كل مجموعة. القياس في node: 100 ألف صف، `group_by [بُعد, __rid]` ⇒ 0.5-0.8 ث (تحت هدف الثانية، بهامش ضيق).
2. **كل عمود فرز يُدرج في `columns` كعمود تقني.** مفاجأة جديدة غير موثّقة في تجارب المحور «و»: في `view` مجمَّع مع عمود فرز مخفي، `to_columns({start_col, end_col})` يعيد أعمدة خاطئة، ومع عمودَي فرز مخفيين يسقط آخر عمود حتى بلا نافذة. تُضاف إلى §8أ.2 و §7.12.
3. **طي الشجرة «كما هي»:** فلتر `["__depth", "<=", D]` ما دام المستخدم لم يطوِ شيئاً، ثم `not in` على `__anc_i` للآباء المطوية التي كل أسلافها مفتوحة. أعمدة الأسلاف `float` (قيم `__rid`) لا نصوص؛ ثبت أن `not in` على `float` يمرّر `null`. و `tree.expanded` في حالة العرض = قائمة `__rid` الآباء المفتوحة (`null` = حسب العمق).
4. **`expected.row_count` = عدد الحقائق التي تمر من الفلاتر** (حجم جدول الحقائق، أو `num_rows()` لـ `view` مؤقت بالفلتر نفسه)، لا `num_rows()` للعرض الرئيسي كما في §8أ.6. السبب: الخادم يقارنه بـ `len(facts)` (`core/export/model.py:178`، `core/engine.py:305`)، وعدد صفوف الشجرة المطوية أو العرض المجمَّع لا يساويه. **يحتاج قراراً في عقد الخادم** (لم أعدّل الخادم).
5. **شريط الحالة في العرض المجمَّع:** «المعروض» = الحقائق التي تمر من الفلاتر، لا `num_rows() − 1`، لأن الأخير يعدّ صفوف المجموعات فيعطي «21 من 16».
6. **جدول العقد يشمل صفوف `group_header`** (عقد شجرية بلا قيم)، وأعمدة تقنية زائدة عن قائمة N9: `__leaves` (عدّاد الأوراق)، `__path`، `__top` (أعلى صفوف `data`، لإجمالي شجرة بلا صف مرجعي)؛ وفي الحقائق `__path` و `__levels`.
7. **الشجرة غير المنتظمة في العرض المعاد تجميعه:** أول مستوى مملوء بعنوان الورقة يُعرض كصف الورقة ويبقى مطوياً (`queries.set_depth` يطويه بعد `view.set_depth`)، فلا تظهر النسخ.
8. **تفاصيل داخلية في `regular-table` 0.9.1 غير المحوّلين:** تعبئة `_column_sizes.indices` بعرض الأعمدة مسبقاً (مدى التمرير الأفقي صحيح قبل رسم العمود)، ومتغيرا `--regular-table--transform-y/clip-y` في CSS خاص بنا للتمرير العمودي الجزئي. المكتبة تفترض ارتفاع صف الرأس = ارتفاع صف البيانات؛ رؤوسنا أقصر (30 و 34 مقابل 37)، فيبقى فراغ حتى 10px أسفل آخر صف عند نهاية التمرير.
9. **الفرز في الشجرة «كما هي» بلا أثر** (مفتاح المسار أولاً، كما في §8أ.2 ومحرك التصدير). والقيم الفارغة في أعمدة `__sort__` آخراً تصاعدياً وأولاً تنازلياً.
10. **العملات المختلطة:** `unique` على عمود العملة مع عمود `expressions` بـ `distinct count`. مجموعة فيها عملة واحدة وصفوف بلا عملة تُعدّ مختلطة (كان المحرك القديم يتجاهل الفارغ).

## 7. ما لم يكتمل
- **صفوف التقرير الملخِّصة في العرض المسطح.** العرض المسطح يقرأ جدول الحقائق، فصفوف `opening` و `closing` و `internal_total` (General Ledger مثلاً) لا تظهر على الشاشة، وكانت تظهر سابقاً بلا فلتر ولا فرز، ومحرك التصدير في الخادم ما زال يبقيها. الإجماليات متطابقة، والصفوف نفسها تختلف بين الشاشة و Excel. يحتاج قراراً (جدول «صفوف كما هي» للتقارير غير الشجرية مثلاً).
- **فلاتر لا يعبّر عنها Perspective:** `not_contains`، والبحث الحر `*`، و«فارغ أو قيم» في فلتر القيم، وفلتر القيم على عمود غير نصي. تُسقَط وتُعاد في `post.notices` ولا تُعرض للمستخدم بعد (لا واجهة فلاتر في هذه المرحلة؛ تصل عبر `rv` في الرابط فقط). الخادم يطبّقها، فالتصدير يرفض بـ `RVExportMismatch`.
- `group.expanded` كقائمة مسارات غير مطبّق (`all` و `none` فقط)، وطي المجموعات لا يُحفظ في حالة العرض.
- لا نص «جارٍ تجهيز المحرك» في حالة التحميل (§8).
- الأبعاد المشتقة من التاريخ (`__year`…) و `quick_filters` و `derived_columns` خارج هذه المرحلة.
- **لم يُتحقق على الموقع بمستخدم حقيقي** (لا حساب دخول): التحميل داخل Desk، وعناصر Frappe الحقيقية، و console الموقع. المثبت: الـ bundle المبني يعمل في المنصة، والأصول تُخدَّم من الموقع بالأنواع الصحيحة.
- Firefox و Safari غير مختبرين (كما في ADR-012).
- اختبارات بايثون لم تُشغَّل (لم يُلمس الخادم).

## 8. ملاحظة تشغيلية
شغّلت `npx playwright test` (مجلد `tests/e2e`) مرة واحدة على `acc.dev`. اختبار `login.spec.js` الموجود يحاول الدخول بخمسة مستخدمين `rv_*` غير موجودين، ففشلت خمس محاولات دخول على الموقع واستغرق التشغيل 5.2 دقيقة. لم أنشئ مستخدمين ولم أكتب في قاعدة البيانات.

## 9. المطلوب من صاحب المشروع
- قرار في البند 4 من الانحرافات (معنى `expected.row_count` في عقد الخادم).
- قرار في عرض صفوف `opening` / `closing` / `internal_total` للتقارير غير الشجرية.
- مستخدم اختبار للتحقق داخل Desk.
