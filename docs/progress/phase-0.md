# تقرير المرحلة 0: البيئة والأساس

- الفرع: `phase-0-setup`
- التاريخ: 2026-09-30 (حُدّث بعد قرار صاحب المشروع باعتماد `acc.dev`)

## ما أُنجز
- تحديد البيئة: مسار الـ bench `/home/snd/frappe-bench`، وموقع التطوير **`acc.dev.sanad.digital`** بقرار صاحب المشروع (يُخدَّم عبر nginx على `https://acc.dev.sanad.digital`، ومنفذ gunicorn الداخلي 8000). ثُبّت التطبيق أولاً على `test.dev.sanad.digital` ثم على `acc.dev` بطلب صاحب المشروع؛ يمكن إزالته من `test.dev` لاحقاً بـ `bench --site test.dev.sanad.digital uninstall-app report_view`.
- الإصدارات المكتشفة:

| المكوّن | الإصدار |
|---|---|
| frappe | 16.28.0 (فرع version-16) |
| erpnext | 16.29.0 (فرع version-16) |
| hrms | 16.14.0 |
| Python (env الخاص بالـ bench) | 3.14.7 |
| Node / npm | v24.20.0 / 11.19.0 |
| MariaDB | 10.11.14 |
| أداة PDF | wkhtmltopdf 0.12.6.1 (patched qt) وهي المختارة في Print Settings؛ الخيار `chrome` متاح في Frappe 16 لكنه غير مفعّل على الموقع |
| Playwright | @playwright/test 1.63.0، ومتصفح Chromium (build 1243) موجود مسبقاً في `~/.cache/ms-playwright` |

- تثبيت التطبيق: التطبيق كان مولَّداً مسبقاً (`bench new-app`، commit `6201cb4`) لكنه غير مثبّت على أي موقع. ثُبّت على `test.dev.sanad.digital` ثم على `acc.dev.sanad.digital` بنجاح، و `bench build --app report_view` ينجح.
- إنشاء الفرع `phase-0-setup`.
- نقل `CLAUDE.md` و `START.md` و `docs/` و `reference/` و `.claude/` من داخل حزمة بايثون (`report_view/report_view/`) إلى جذر المستودع كما ينص `START.md`. السبب الإضافي: `bench build` يربط أي مجلد `<app>/<app>/docs` إلى `sites/assets/<app>_docs` فيصبح متاحاً للعموم عبر الويب، وملفات التقدّم ستحتوي كلمات مرور مستخدمي الاختبار.
- تجهيز Playwright في مجلد التطبيق: `package.json`، `playwright.config.js`، واختباران في `tests/e2e/` (`smoke.spec.js` يفتح صفحة الدخول، و `login.spec.js` يسجّل الدخول بكل مستخدم ويفتح `/app`). عنوان الموقع قابل للتغيير عبر `RV_BASE_URL`.
- كتابة سكربت إنشاء مستخدمي الاختبار `scripts/setup_test_users.py` (لم يُنفَّذ، انظر «المطلوب من صاحب المشروع»).
- فحص البيانات المحاسبية على `acc.dev.sanad.digital`: **لا يحقق الشرط** (شركتان على الأقل بقيود في أكثر من شهر). شركة واحدة فقط لها قيود:

| الشركة | قيود GL (غير ملغاة) | المدى | عدد الأشهر |
|---|---|---|---|
| SND Accounting | 538 | 2026-03-18 → 2026-09-29 | 7 |
| SND Accounting 2، SND Accounting3، تجربة قراءة الفواتير، شركة اختبار العهد والإخلاءات | 0 | — | — |

  لم أولّد بيانات (المرحلة تمنع ذلك قبل الموافقة). المقترح: توليد قيود لشركة `SND Accounting 2` عبر فواتير بيع وشراء وقيود يومية مُرسَلة موزعة على 6 أشهر على الأقل (سكربت بايثون يستخدم واجهات ERPNext القياسية، بلا `ignore_permissions`)، أو استيراد قيود يومية من ملف Excel عبر Data Import. للمقارنة، `test.dev` كان يحقق الشرط بشركتين (1,539 و 797 قيداً) لكن صاحب المشروع اختار `acc.dev`.

## شروط القبول
| الشرط | النتيجة | الدليل |
|---|---|---|
| كل الإصدارات مسجّلة في التقرير | نجح | الجدول أعلاه؛ `bench version`، `mysql --version`، `wkhtmltopdf --version`، `npx playwright --version` |
| التطبيق مثبت و `bench build --app report_view` ينجح | نجح | `bench --site acc.dev.sanad.digital list-apps` يعرض `report_view 0.0.1` (وكذلك على `test.dev`)؛ `bench build --app report_view` انتهى بـ `DONE Total Build Time: 3.415s` |
| `bench --site $SITE run-tests --app frappe --module frappe.tests.test_utils` يعمل | نجح جزئياً | الاختبارات الثلاثة نجحت (`Ran 3 tests in 3.901s — OK`) لكن الأمر خرج بـ exit=1 بعدها لأن مشغّل الاختبارات في Frappe 16 يحاول إنشاء سجلات اختبار ERPNext العامة وفشل: `MandatoryError: [Item Group, All Item Groups]: item_type` (حقل مخصص إلزامي على الموقع من أحد تطبيقات SND). لا يؤثر على اختبارات `report_view` لاحقاً إلا إذا اعتمدت على سجلات اختبار ERPNext. السجل الكامل: تشغيل الأمر نفسه |
| المستخدمون الخمسة موجودون وكل واحد يسجّل الدخول | فشل (لم يُنفَّذ) | تنفيذ سكربت إنشاء المستخدمين على الموقع المشترك رُفض من صلاحيات الجلسة الآلية مرتين (على `test.dev` ثم على `acc.dev`). السكربت جاهز في `scripts/setup_test_users.py` وينتظر تنفيذه من صاحب المشروع |
| اختبار Playwright بسيط يفتح `/app` بكل مستخدم وينجح | فشل | الاختبارات مكتوبة وتعمل والعنوان الافتراضي الآن `acc.dev`، لكن الموقعين `test.dev` و `acc.dev` يرجعان 500 منذ تثبيت التطبيق (انظر المخاطر) والمستخدمون غير موجودين بعد. الدليل على سلامة أداة الاختبار: `RV_BASE_URL=https://acc.dev.sanad.digital npx playwright test smoke` نجح (`1 passed`) قبل تثبيت التطبيق على `acc.dev`. وعلى `test.dev`: `6 failed` (smoke: `Expected: 200, Received: 500`) |
| المرفقات موجودة | نجح جزئياً | `reference/prototype/` موجود (Main/States/Mobile/Tokens.dc.html، rv.css، tb-data.js، canvas.json، README.md). `reference/design/` غير موجود إطلاقاً |

## القرارات المتخذة
- موقع التطوير `acc.dev.sanad.digital` بقرار صاحب المشروع (اقتراحي الأول كان `test.dev` لأنه يحقق شرط البيانات دون توليد).
- الشركة المستخدمة لتقييد `rv_restricted`: `SND Accounting` (الوحيدة ذات القيود على `acc.dev`).
- مستخدمو الاختبار بصيغة `<username>@rv.test` (تسجيل الدخول يقبل اسم المستخدم أو البريد). كلمات المرور لا تُكتب في المستودع: كل واحدة في متغير بيئة يقرؤه `scripts/setup_test_users.py` و `tests/e2e/users.js` (ولا قيمة احتياطية؛ الاختبار يتوقف إذا غاب المتغير). على خادم التطوير هذا محفوظة في `~/.config/report_view/test-users.env` (صلاحية 600)، وتُحمَّل بـ `set -a; . ~/.config/report_view/test-users.env; set +a`. كلمات المرور القديمة التي كانت هنا غُيّرت في 2026-10-22:

| المستخدم | البريد | متغير كلمة المرور | الأدوار |
|---|---|---|---|
| rv_admin | rv_admin@rv.test | `RV_ADMIN_PASSWORD` | System Manager |
| rv_accountant | rv_accountant@rv.test | `RV_ACCOUNTANT_PASSWORD` | Accounts User، Accounts Manager |
| rv_restricted | rv_restricted@rv.test | `RV_RESTRICTED_PASSWORD` | Accounts User + User Permission على شركة `SND Accounting` (apply_to_all_doctypes) |
| rv_noexport | rv_noexport@rv.test | `RV_NOEXPORT_PASSWORD` | Accounts User |
| rv_none | rv_none@rv.test | `RV_NONE_PASSWORD` | بلا أدوار |

- إلغاء تصدير `rv_noexport`: صلاحية Export في Frappe على مستوى الدور (اتحاد أدوار المستخدم عبر `frappe.permissions.can_export`)، فلا يمكن إلغاؤها لمستخدم بعينه يحمل Accounts User دون إلغائها عن الدور نفسه. السكربت يلغي `export` لدور Accounts User على `GL Entry` و `Account` عبر Custom DocPerm، وهذا يؤثر على كل حاملي الدور على موقع الاختبار. للتراجع: Role Permission Manager أو `frappe.permissions.update("GL Entry", "Accounts User", 0, "export", 1)` وكذلك `Account`.
- إبقاء `frappe.set_user("Administrator")` داخل `scripts/setup_test_users.py` فقط لأنه سكربت تجهيز تطويري وليس كود إنتاج؛ لا يُستورد من التطبيق.
- إضافة `report_view/public/node_modules` إلى `.gitignore`: رابط رمزي ينشئه `bench build` تلقائياً عند وجود `node_modules` في التطبيق.
- لا ADR جديد؛ لا hooks ولا مكتبات أُضيفت (Playwright أداة تطوير مذكورة في المرحلة).

## الانحرافات عن الخطة أو التصميم
- `reference/design/` (تصدير Claude Design) غير موجود، وهو المرجع البصري الوحيد بحسب `docs/brief.md`. المرحلة 0 لا تحتاجه، لكن المرحلة 5 فصاعداً لا تبدأ بدونه.
- الملفات التوجيهية كانت داخل `report_view/report_view/` ونُقلت إلى جذر المستودع (مبرَّر أعلاه).
- لم يُنفَّذ إنشاء المستخدمين ولم تُصحَّح خدمة الويب لأن كليهما تعديل على مورد مشترك خارج نطاق صلاحيات الجلسة.

## المخاطر والأسئلة المفتوحة
- **الموقعان `test.dev` و `acc.dev` يرجعان 500 على كل الطلبات منذ تثبيت التطبيق عليهما، بينما بقية المواقع تعمل.** السبب المؤكد من `logs/frappe.log`: `ModuleNotFoundError: No module named 'report_view'` (3 مرات). عمال gunicorn الحاليون تابعون لعملية gunicorn يتيمة (pid 667078، أبوها pid 1، تعمل منذ ~34 ساعة، خارج supervisor) بدأت قبل تثبيت حزمة `report_view` في env، ولذلك لا تعرف مسارها (نفس المشكلة ظهرت سابقاً في السجل لتطبيق `camp_management` على موقع `acc`). supervisor يحاول تشغيل gunicorn جديد ويفشل بـ `Address already in use` على المنفذ 8000 (سجل `logs/web.error.log`). إعادة تشغيل العمال وحدها لا تكفي لأن gunicorn يعمل بـ `--preload` والعمال نسخ من العملية الأم القديمة. صلاحيات الجلسة الآلية منعتني من إرسال إشارات للعملية؛ الإصلاح بيد صاحب المشروع (الأوامر أدناه).
- مشغّل اختبارات Frappe 16 على هذا الموقع يفشل عند إنشاء سجلات اختبار ERPNext (حقل `item_type` إلزامي على Item Group). قد يحتاج ذلك معالجة قبل كتابة اختبارات `report_view` التي تعتمد على سجلات ERPNext الاختبارية، أو استخدام بيانات الموقع الحقيقية بدلاً منها.
- تشغيل `run-tests` على موقع يحوي بيانات حقيقية يُدخل سجلات اختبار (`_Test ...`) في قاعدة البيانات نفسها. يُفضَّل مستقبلاً موقع اختبار منفصل أو التعامل مع ذلك بوعي.
- تغيير صلاحية Export لدور Accounts User مرئي لكل مستخدمي `acc.dev` الحاملين لهذا الدور.
- بيانات `acc.dev` لا تكفي لاختبار الصلاحيات بين شركتين (`rv_restricted`) ولا لاختبار أداء 10,000 و 50,000 صف قبل توليد بيانات.

## المطلوب من صاحب المشروع
1. إصلاح خدمة الويب بمستخدم `snd` على الخادم (العملية الأم اليتيمة pid 667078)، ثم التأكد أن `ping` يرجع 200 على `acc.dev`:
   ```bash
   # بلا انقطاع وبلا sudo:
   kill -USR2 667078 && sleep 8 && kill -WINCH 667078 && sleep 5 && kill -TERM 667078
   # أو، لإعادة gunicorn إلى supervisor:
   kill 667078 && sudo supervisorctl start frappe-bench-web:
   curl -s -o /dev/null -w "%{http_code}\n" https://acc.dev.sanad.digital/api/method/ping
   ```
2. تنفيذ سكربت إنشاء المستخدمين على `acc.dev` (يغيّر صلاحية Export لدور Accounts User على `GL Entry` و `Account` كما هو موضح أعلاه؛ إن أردت تجنّب ذلك فأخبرني بالبديل المفضّل):
   ```bash
   cd /home/snd/frappe-bench/sites
   ../env/bin/python ../apps/report_view/scripts/setup_test_users.py acc.dev.sanad.digital "SND Accounting"
   ```
3. بعد الخطوتين: `cd apps/report_view && npx playwright test` يجب أن يعطي `6 passed`.
4. الموافقة على توليد بيانات لشركة ثانية على `acc.dev` (أو تحديد شركة وطريقة) حتى يتحقق شرط «شركتان بقيود في أكثر من شهر».
5. توفير `reference/design/` (تصدير Claude Design) قبل المرحلة 5.
6. اختياري: إزالة التطبيق من `test.dev` إن لم يعد مطلوباً هناك.
