# تقرير المرحلة 6: الطباعة (ADR-014 إلى ADR-020)

- الفرع: `letterhead-builder` (يجمع فروع `phase-5a2-design-parity` وما بعدها؛ آخر commit قبل هذا التقرير `25c02c9`)
- التاريخ: 2026-10-22 (العمل من 2026-10-12 إلى 2026-10-21، 57 commit؛ وجولة ديون تقنية في 2026-10-22)
- السبب: لم يُكتب تقرير تقدّم منذ `pages-print.md` (2026-10-12) رغم سبعة قرارات معمارية جديدة (CLAUDE.md §1 و §4). هذا التقرير يلخّص ما بُني ويسجّل دليل الاختبارات.

## ما أُنجز

| ADR | ما بُني | أين |
|---|---|---|
| 014 | وضع «صفحات»: التقرير صفحات A4/A3/Letter/Legal عمودية وأفقية من `view` الجدول نفسه، بترويسة وتذييل وترقيم وقوالب التقرير ولغة الطباعة، والطباعة من المكان نفسه (التفاصيل في `pages-print.md`) | `public/js/report_view/views/pages_view.js`، `engine/page_layout.js`، `api.get_print_options/get_print_format/render_print_format/get_translations` |
| 015 | رأس الطباعة والتوقيع: `Print Heading` بقالب Jinja، و DocType `Print Signature` (+ `Print Signature Item`) للتقارير والمستندات، ودالة Jinja `report_view_signature`، و `Report View Global Settings` (الحدود وإعدادات الطباعة القياسية). خمسة رؤوس و 13 توقيعاً مشحونة | `core/printing.py`، `fixtures/print_heading.json`، `fixtures/print_signature.json` |
| 016 | محرك PDF على الخادم: Chromium خاص بالتطبيق (`<bench>/chromium-rv`) يطبع HTML صفحات المتصفح نفسه: JS معطّل، الطلبات معترضة، دفعات للتقارير الطويلة، وظيفة خلفية بنبض وإلغاء وكشف العامل الميت، وتنظيف كل ساعة. يُثبَّت مع `after_install`، وبعد migrate يوضع تثبيته على طابور `long` | `core/pdf.py`، `core/chromium.py`، `api/pdf.py`، `api/chromium.py`، `install.py` |
| 017 | صفحة الطباعة المتقدمة للمستندات `/desk/rv-print/<doctype>/<name>`: قالب المستند كما يرندره Frappe داخل صفحات Report View، وزر في صفحة الطباعة الأصلية | `api/document.py`، `public/js/report_view/doc_print.js` |
| 018 | منشئ ورق الشركة: أنماط، وخانات، وعناصر حرة، ومكتبة خطوط مشحونة، و DocType `Letter Head Layout`، وهوامش wkhtmltopdf عبر `pdf_body_html` | `core/letterhead.py`، `api/letterhead.py`، `core/fonts.py`، `public/js/report_view/letterhead/` |
| 019 | مصدر الطباعة «Custom»: قوالب HTML و CSS تطبع أي بيانات (`report_view.print`) في بيئة Jinja معزولة، وقالب «Report View Table» المشحون | `core/custom_print.py`، `api/custom_print.py`، `fixtures/property_setter.json`، `fixtures/print_format.json` |
| 020 | إعدادات الطباعة المحفوظة (`Print Preset`): خاصة وعامة، للتقرير والمستند والقالب، مع الافتراضي | `core/print_presets.py`، `api/print_presets.py` |

### جولة الديون التقنية (2026-10-22، `C-backend-infra`)
- كلمات مرور مستخدمي الاختبار حُذفت من المستودع (`tests/e2e/users.js`، `phase-0.md`)، وتُقرأ من `RV_*_PASSWORD` فقط (`~/.config/report_view/test-users.env` على خادم التطوير)، وغُيّرت على acc.dev.
- مستخدمو `rv_t_*` المتسرّبون من الاختبارات حُذفوا من acc.dev مع إذن المستخدم الشارد و 90 Error Log. السبب: `import_doc` في `TestShippedHeadingsAndSignatures.setUpClass` كان ينفّذ `commit`. صار يُستدعى بلا commit، و `RVTestCase` يتحقق بعد كل rollback أن المستخدمين اختفوا.
- الاختبارات تأخذ الشركة والسنة المالية من الموقع (أو تنشئها)، وتنشئ ما تحتاجه بدل أن تتخطى الاختبار بصمت.
- وظائف Excel صارت مثل وظائف PDF: كشف العامل الميت، وإلغاء (`export_xlsx_cancel`)، وطابور من إعداد الموقع (`report_view_export_queue`). الكود المشترك في `core/jobs.py`.
- حد للطلبات على نقاط PDF الثلاث، وحارس واحد لطباعة المستند (`core/guard.guard_doc_print`).
- أدوات الاختبار خرجت من `node_modules` المنشور إلى `tests/package.json`، وأضيف `yarn.lock`.
- سجل الـ hooks في ADR-007 صار كاملاً، وحُدّثت حالات ADR-004 و 010 و 013، ووُسم في `architecture.md` و `brief.md` ما لم يُبنَ بـ «لم يُبنَ».

## شروط القبول
| الشرط | النتيجة | الدليل |
|---|---|---|
| اختبارات بايثون كاملة | نجح | 32 اختبار وحدة + 205 اختبار تكامل، كلها OK (126 ث) | `bench --site $SITE run-tests --app report_view` |
| لا تسرب من الاختبارات إلى الموقع | نجح | بعد التشغيل الكامل لا `rv_t_*` في `tabUser` ولا User Permission لهم (استعلام القراءة بعد التشغيل)؛ `RVTestCase._rollback_and_check` يفشل الصنف إن بقي شيء |
| اختبارات الوحدة JS | نجح | `npm run -s test:js` ⇒ 200/200 |
| الحزمة تُبنى | نجح | `bench build --app report_view` ⇒ `DONE Total Build Time: 2.408s` بعد إخراج Playwright من `node_modules` |
| المجموعة البصرية (دورة الحياة) | نجح | `node tests/visual/build.mjs && npm --prefix tests exec -- playwright test -c tests/visual -g lifecycle` ⇒ 5/5 |
| تسجيل الدخول بكلمات المرور الجديدة | نجح | `npm --prefix tests run e2e -- login` (بعد تحميل ملف البيئة) ⇒ 5/5 |
| Playwright غير منشور | نجح | `curl https://$SITE/assets/report_view/node_modules/playwright-core/package.json` ⇒ 404 |
| ترجمة عربية لكل نص | نجح | تدقيق `po_audit`: 0 نص مفقود لا يترجمه frappe أو erpnext (عدا مفتاح ديناميكي `key`)، و 0 مدخل ميت، و 0 ترجمة فارغة؛ `bench compile-po-to-mo --app report_view` |
| ruff | نجح للملفات التي لا يعدّلها وكيل آخر الآن | `ruff check` و `ruff format --check` على 58 ملفاً نظيفان |

## القرارات المتخذة
- ADR-014 إلى ADR-020 (القائمة أعلاه).
- 2026-10-22 في ADR-007: `required_apps` و hook التنظيف كل ساعة لملفات Excel صار لهما سبب مكتوب. ADR-016 (تعديل): التثبيت لا يوقف migrate.
- `core/jobs.py` و `core/limits.py`: حالة الوظائف الخلفية وحد الطلبات لكل مستخدم ولكل دالة (الوحدة والاسم) في `core`، فلا يستورد `core` من `api`.

## الانحرافات عن الخطة أو التصميم
- PDF لم يُبنَ كـ `export_pdf` من نموذج التصدير (architecture §2.5) بل من صفحات المتصفح (ADR-016). ADR-004 مستبدَل.
- `Report View Settings` و `Report View Saved View` لم يُبنيا. الإعدادات لكل تقرير تأتي من `defaults/*.json`.
- الحد الافتراضي للصفوف 50,000 في الكود، والخطة 100,000.

## المخاطر والأسئلة المفتوحة
- `pdf_body_html` hook يفوز فيه آخر تطبيق مثبّت. يُسجَّل تحذير عند التثبيت وعند migrate.
- `--no-sandbox` لـ Chromium باقٍ. فجوة فلاتر Link لتقارير Script التي تُعرَّف فلاترها في JS فقط (C2). Firefox و Safari لم يُختبرا.
- لا CI. الاختبارات تعمل على acc.dev المشترك، لكنها صارت قابلة للتشغيل على موقع آخر.

## المطلوب من صاحب المشروع
- القرارات في `owner-decisions.md` من جولة الديون: C2، C6 (النسخ الاحتياطي والتاريخ والفرع)، C36 (AppArmor)، CI، مكتبات Firefox/Safari، الحد 50k/100k، ADR-010.
- إعادة تشغيل الخادم (gunicorn والعمال) حتى تُحمَّل الدوال الجديدة (`export_xlsx_cancel`) ونقل حالة الوظائف، وحتى يقرأ العمال `core/jobs.py`.
- تحديث سطر الأوامر في `CLAUDE.md:41`: صار `npm --prefix tests ci` مرة واحدة، ثم `npm --prefix tests run e2e`.
