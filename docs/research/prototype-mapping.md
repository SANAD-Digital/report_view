# مقابلة البروتوتايب مع Perspective

- التاريخ: 2026-10-01
- المصدر: `reference/prototype/Main.dc.html` (المنطق في `class Component`، الأسطر 1101-1836)، `Mobile.dc.html`، `States.dc.html`، `Tokens.dc.html`، `rv.css`.
- القاعدة: البروتوتايب مرجع **للمنطق والشكل** فقط. لا يُنقل منه أي كود عرض أو تجميع. الحساب كله في محرك Perspective، والعرض في `regular-table` وكود اللوحات الخاص بنا.

ملاحظة عن البروتوتايب نفسه: هو لا يستخدم مكتبة جدول ولا مكتبة تجميع. جدوله عناصر `div` وحساباته دوال JS خاصة، وملف `rv.css` وجدول الربط في `Tokens.dc.html` كُتبا على افتراض تركيبه لاحقاً على Tabulator. ذلك الافتراض هو ما أُلغي.

## 1. الحساب والبيانات

| وظيفة البروتوتايب | ما تفعله | المقابل |
|---|---|---|
| `compute(ci, from, to)` | تحسب ميزان المراجعة من قيود GL في المتصفح: افتتاحي، حركة، ختامي، صافٍ | **لا مقابل في المحرك، ولا تُنقل.** الأرقام تأتي من رد تقرير Trial Balance عبر `api.run` (ADR-002). المحوّل يحمّلها في `perspective.table()` |
| اشتقاق `root`، `parent`، `rtype`، `atype`، `nature` | أبعاد من شجرة الحسابات | أعمدة المستويات (`level_1`…) من سلسلة `parent_account` في المحوّل، و `root_type`/`account_type` من الإثراء (`api.enrich`). `nature` (مدين/دائن) عمود `expressions` |
| `buildTree(rows, groups)` | يبني شجرة المجموعات مع مجاميعها | `view({group_by: [...]})`؛ Perspective يعيد صفوف المجموعات بمساراتها (`__ROW_PATH__`) ومجاميعها |
| `aggr(rows, fn)`، `aggFns`، `FN_AR` | مجموع، متوسط، عدد، أدنى، أعلى لكل قيمة | `aggregates: {col: "sum" \| "avg" \| "count" \| "min" \| "max" \| "distinct count"}` |
| `applyFilters(rows)` | نص «يحتوي»، مجموعات قيم، نطاقات أرقام، فلاتر سريعة | `filter: [[col, "contains", v], [col, "in", [...]], [col, ">=", a], [col, "<=", b]]`. الفلاتر السريعة (`moving`، `nonzero`، `drOnly`، `crOnly`) أعمدة `expressions` منطقية تُفلتر بـ `==` |
| `sortRows`، `toggleSort`، `lc` (ترتيب عربي) | فرز تصاعدي/تنازلي بمقارنة عربية | `sort: [[col, "asc" \| "desc"]]`. ترتيب النصوص العربية في Perspective بترتيب Unicode لا بقواعد `Intl.Collator`؛ يُتحقق منه في المحور «و»، والبديل عمود مفتاح فرز يولّده المحوّل |
| `pivotModel`، `pkey` | صفوف من `groups`، أعمدة من قيم `pivotCols` × `pivotVals`، وشريط إجمالي | `view({group_by, split_by, columns, aggregates})`. مسارات الأعمدة التي يعيدها `view` تبني الرؤوس المتعددة. عمود الإجمالي: `view` ثانٍ بلا `split_by` أو جمع أعمدة المسار حسب ما تثبته التجربة |
| `openPivotCell` | يسرد الحسابات المكوّنة لخلية تحليل | `view` مؤقت بـ `filter` يطابق مسار الصف والعمود، ثم `to_columns()`، ثم `delete()` |
| `setItems`، `allVals`، عدّاد القيم | القيم الفريدة لعمود مع عدد كل قيمة | `view` مؤقت `{group_by: [col], columns: [col], aggregates: {col: "count"}}` على الجدول مع بقية الفلاتر، ثم `delete()` |
| `selStats` | عدد، مجموع، متوسط، أدنى، أعلى للنطاق المحدد | `view.to_columns({start_row, end_row, start_col, end_col})` ثم جمع القيم؛ القاعدة (هل تدخل صفوف المجموعات) تُكتب في المعمارية |
| `copySel` | نسخ النطاق TSV مع الرؤوس | `to_columns` لنافذة النطاق، بقيم خام |
| `rangeData` | بيانات الرسم من النطاق | `to_columns` لنافذة النطاق ⇒ ECharts |
| `ch` (حسب النوع الجذري، حلقة المصروفات، أعلى 10 حركة)، `donut`، `niceMax` | بيانات لوحة الرسوم | `view` خاص لكل رسم (`group_by` + `aggregates` + `sort` + حد) ⇒ `to_columns()` ⇒ ECharts. رسم CSS/SVG اليدوي لا يُنقل |
| `mk()` بطاقات التوازن | مجموع مدين = مجموع دائن للافتتاحي والحركة والختامي، وتمييز «فرق فلترة» عن «غير متوازن» | `view` بلا `group_by` بمجاميع الأزواج، مرة بالفلاتر ومرة بدونها |
| `fmt`، `fmtP`، `fmtS`، `nf` | تنسيق الأرقام (en-US، خانتان، «—» للصفر، أقواس للسالب) | **لا تُنقل.** التنسيق عبر `frappe.format` وإعدادات النظام في `addStyleListener`؛ يبقى «—» للصفر وأصناف `.neg`/`.dr`/`.cr` |
| `printModel` | يقسّم الصفوف إلى صفحات A4 في المتصفح | **لا تُنقل.** PDF من الخادم (ADR-001)؛ نموذج التصدير يُبنى من `view config` الحالي |
| `exportXlsx` (تنبيه فقط) | — | `api.export_xlsx` بنموذج من `view config` |
| `snapshot`، `applyView`، `describe`، `READY` (5 عروض جاهزة)، `PRESETS` | حفظ واستعادة الفلاتر والتجميع والأعمدة والتحليل | حالة العرض (§7 في المعمارية) ⇒ دالة واحدة تترجمها إلى `view config`. العروض الجاهزة تُنقل كبيانات إلى `register.ready_views` |
| `presetList`، `fyRange`، `fyLabel`، `FPS`، `dpModel` | قوالب الفترات والفترة المالية | منطق واجهة لا حساب؛ يُعاد كتابته في `filters/period_picker.js` ويضبط فلاتر التقرير (معايير الخادم) |
| `doRun`، `pending` | تشغيل الخادم وحالة «معلّق» | `api.run` ⇒ المحوّل ⇒ `table.replace()` أو جدول جديد مع حذف القديم |
| `openDrawer`، `dw` (كشف الحساب برصيد متراكم) | من قيود GL محمّلة مسبقاً | `api.run("General Ledger", …)` عند الطلب ⇒ `table` و `view` خاصان بالدرج يُحذفان عند الإغلاق. الرصيد المتراكم من التقرير نفسه |
| `vc` (تفاصيل القيد) | كل سطور القيد وتوازنه | `api.run("General Ledger", {voucher_no})`؛ «قبض/صرف» من `account_type` لا من أرقام حسابات ثابتة |

## 2. العرض والتفاعل

| عنصر البروتوتايب | المقابل |
|---|---|
| `gridModel`، `rowCells` (صفوف: بيانات، مجموعة، مجموع فرعي، إجمالي) | `regular-table` بنموذج بيانات افتراضي (`setDataListener`) يقرأ نافذة من `view`؛ نوع الصف من مسار الصف وعمقه |
| أصناف `.rv-row.group.d0/.d1`، `.rv-c.dr/.cr/.neg/.zero`، `.rv-gcount` | تُضبط على `td`/`th` في `addStyleListener` عبر `getMeta` |
| `.rv-hg › .rv-band` (الرؤوس المجمّعة) | رؤوس متعددة المستويات في `regular-table` (`column_headers`) |
| `finishCols`، `setPin` (تثبيت يمين/يسار بـ sticky) | رؤوس الصفوف في `regular-table` لعمود البداية، و sticky لعمود النهاية؛ يُحسم في تجربة RTL |
| `toggleGroup`، `expandAll`، `collapseAll`، `expanded` | `view.expand(row)`، `view.collapse(row)`، `view.set_depth(n)` |
| صف المجموع الفرعي `.rv-row.foot` | صف مولَّد في نموذج البيانات من قيم صف المجموعة نفسه |
| الإجمالي العام المثبّت `.rv-row.total` | عنصر خاص خارج منطقة التمرير يقرأ الصف 0 من `view` المجمَّع |
| `hcell.resize`، `autoSize` | نبنيه نحن (عرض الأعمدة في حالة العرض) |
| `dragStartCol`، `handleDrop`، `dropOn('groups'/'values'/'pcols')` | نبنيه نحن؛ الناتج تعديل `group_by`/`columns`/`split_by` |
| `openMenu('col')`، `colMenuItems`، `rowItems`، `ctxItems`، `geo`/`place` | نبنيها نحن (قوائم ونوافذ منبثقة بأصناف `.rv-pop/.rv-mi`) |
| `cellDown`، `cellEnter`، `norm` (تحديد النطاق) | نبنيه نحن بإحداثيات البيانات لا DOM |
| `chips`، `searchKey`، `searchSet` (بحث بالشرائح) | نبنيه نحن؛ الناتج `filter` |
| صف الفلاتر العائمة | صف رأس إضافي خاص بنا؛ الناتج `filter` |
| `skel`، `st`، `DEMO_ERR` (حالات التحميل/الفراغ/الخطأ) | مكوّنات خاصة بنا؛ موجودة فعلاً في `components/states.js` |
| `rv.css` | يبقى أساس الشكل؛ يُعاد ربطه بعناصر `regular-table` بدل `.tabulator-*` |
| جدول «الربط مع Tabulator» في `Tokens.dc.html` | مُلغى؛ يحل محله عمود «المقابل» في هذا الجدول |
| `Mobile.dc.html` (أوراق سفلية، مبدّل الأشرطة) | نبنيه نحن؛ مبدّل الأشرطة يغيّر `columns` في `view config` |

## 3. أسئلة مفتوحة (تجيب عنها تجارب المحور «و»)
1. ترتيب النصوص العربية في `sort` و `group_by`.
2. عمود الإجمالي مع `split_by`: من `view` واحد أم اثنين.
3. تثبيت عمود النهاية (الإجراءات) و RTL في `regular-table`.
4. مجاميع الآباء في ميزان المراجعة مع `show_net_values` (التجربة 6).
5. أسماء أعمدة غير ASCII (أسماء مستودعات وحسابات عربية) كمفاتيح أعمدة في Perspective وفي `expressions`.
