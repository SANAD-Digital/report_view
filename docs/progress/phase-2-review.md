# مراجعة المرحلة 2 — قسم الصلاحيات في المعمارية

- المراجِع: وكيل مراجعة الأمان والجودة.
- التاريخ: 2026-09-30. الفرع: `phase-2-architecture` (commit `db38680`).
- النطاق: قسم الصلاحيات فقط في `docs/architecture.md` (§2، §4.2، §5.2-5.3، §6، §12) و ADR-002، 005، 006، 007، 009، 010، 011. لا يوجد كود إنتاج؛ المراجعة وثائق مقابل كود frappe 16.28.0 المثبت.
- الاختصارات: `F/` = `/home/snd/frappe-bench/apps/frappe/frappe/`، `Q` = `F/desk/query_report.py`، `P` = `F/permissions.py`.
- سكربتات التحقق (قراءة فقط مع `rollback`) على `acc.dev.sanad.digital`: `/tmp/claude-1001/-home-snd-frappe-bench-apps-report-view/80b6fc89-9d79-4ce6-8bf4-88166e120282/scratchpad/review2_probe.py` و `review2_probe2.py`.
- البنود 2-4 من بروتوكول المراجعة (مصفوفة المستخدمين، مطابقة الإجماليات، الاختبارات) لا تنطبق هنا: لا يوجد كود، ومستخدمو `rv_*` غير موجودين بعد (`phase-0.md`).

## الحكم: **رفض**

المسار الأساسي سليم ولا يحتاج إعادة تصميم: `guard_report` ← `query_report.run`، و `can_export` للتصدير، و `get_list` للإثراء. سبب الرفض هو تصميم العروض المحفوظة (§6 و ADR-010) وفحص الطباعة وتمرير `prepared_report_name`. هذه البنود كما كُتبت إمّا تكشف بيانات عبر واجهات Frappe القياسية التي لا تمر بـ `guard_report`، أو تضطر المنفّذ إلى تجاوز الصلاحيات (`ignore_permissions` أو `db.set_value`)، وهذا ممنوع في `CLAUDE.md`. كل التعديلات المطلوبة تعديلات وثائقية. يتحول الحكم إلى قبول بعد تنفيذ البنود ح1-ح3 وع1-ع6.

---

## المشاكل مرتبة حسب الخطورة

### حرج

**ح1. العروض المحفوظة مقروءة عبر REST القياسي دون `guard_report`، ولكل مستخدمي الموقع بمن فيهم Website Users**
- الموضع: §6 «DocPerm للنوعين: الدور `All`: read, create…»، و ADR-010 («الشرط الثاني يُفحص في الـ API لأن `permission_query_conditions` لا يستطيع فحصه»)، و §2.7 («كل الدوال… تبدأ بـ guard_report»).
- الدليل:
  - الدور `All` يُعطى لكل مستخدم مسجّل، ومنهم Website User: `P:558` (`roles += [ALL_USER_ROLE, GUEST_ROLE]`)، أما `Desk User` فيُضاف لمستخدمي النظام فقط (`P:559-560`). التحقق على الموقع: `t.azzan@sanad-erp.com` (Website User) أدواره `['All', 'Guest']`.
  - `/api/resource/Report View Saved View` و `frappe.client.get_list` و `frappe.desk.reportview.get` تمر بـ `frappe.get_list` الذي يطبّق DocPerm و `permission_query_conditions` فقط (`F/database/query.py:1563-1598`). لا يُستدعى فيها `guard_report` ولا أي فحص لصلاحية التقرير.
  - `/api/resource/.../<name>` يمر بـ `check_permission("read")`، فيستدعي hook `has_permission` (`P:237`، `P:481-498`). والـ hook المقترح في §6 يفحص `visibility` فقط.
- الأثر: أي مستخدم مسجّل، حتى بلا أي دور محاسبي، يقرأ `title` و `state` (وفيه قيم الفلاتر مثل أسماء الشركات والحسابات) و `columns_ref` لكل عرض `Public`، ولكل عرض `Roles` يحمل دوره، **حتى لو كان العرض لتقرير لا يحق له فتحه**. هذا يخالف ADR-010 نفسه: «يملك صلاحية التقرير نفسه».
- التعديل المطلوب:
  1. DocPerm للنوعين على `Desk User` بدل `All`.
  2. hook `has_permission` لـ `read` يضيف إلى شرط الرؤية فحص التقرير بإعادة استخدام Frappe: `frappe.desk.query_report.get_report_doc(doc.report)` داخل `try` (أي استثناء = `False`)، مع تفريغ `message_log` بعده (انظر م4).
  3. `permission_query_conditions` يضيف `report IN (...)` من `frappe.desk.desk_views.DeskViews.get_allowed_report_names(user=user)`. هذه دالة Frappe نفسها، ولها سابقة في pqc الخاص بـ Prepared Report (`F/core/doctype/prepared_report/prepared_report.py:320-334`)، فليست إعادة تنفيذ. تُوثَّق حدودها: تفحص الأدوار ولا تفحص `report` على `ref_doctype` (`F/desk/desk_views.py:161-262`)، فيبقى `guard_report` في الـ API هو الفحص الكامل.
  4. يُضاف إلى §12 صف «واجهات Frappe القياسية على DocTypes التطبيق (`/api/resource`، `frappe.client.*`، `reportview.get`، `search_link`)» مع ما يحميها. القاعدة: **كل قاعدة صلاحية تسكن في الـ hooks والـ controller، لا في `api/views.py` وحده.**

**ح2. `Report View User Default` قابل للتزوير ومقروء للجميع**
- الموضع: §6 («DocPerm للنوعين…»، «فريد لكل (user, report) في validate»)، و §2.7 `set_default`، و ADR-007 (pqc و has_permission مسجّلان لـ Saved View فقط).
- الدليل: DocPerm `create` للجميع يعني أن أي مستخدم يستطيع `POST /api/resource/Report View User Default` بقيمة `user` = مستخدم آخر، لأن `insert` لا يفحص إلا `create` (`F/model/document.py:467-470`) ولا شيء يربط الحقل `user` بمستخدم الجلسة. المالك (`owner`) هو المهاجم، فالضحية لا تستطيع التعديل ولا الحذف (`write/delete` مع `if_owner`، `P:328-338` و `P:255-259`). وقيد التفرد في `validate` يمنع الضحية من إنشاء افتراضيها. ولا يوجد pqc للنوع، فـ `read` للدور `All` يكشف لكل مستخدم افتراضيات كل المستخدمين الآخرين (من يستخدم أي تقرير وأي عرض).
- التعديل المطلوب: DocPerm على `Desk User` فقط. `validate` يفرض `doc.user == frappe.session.user` (أو يحذف الحقل ويعتمد `owner`). يُضاف إلى ADR-007 pqc و has_permission للنوع بشرط `user = <user>`. وأفضل من ذلك: الاستغناء عن DocType مستقل وتخزين افتراضي المستخدم في `frappe.defaults.set_user_default` أو `User Settings`، وكلاهما خاص بالمستخدم أصلاً. القرار في ADR.

**ح3. `is_global_default` لا يمكن ضبطه دون تجاوز الصلاحيات، ويمكن لأي مالك ضبطه عبر REST**
- الموضع: §6 (`is_global_default`: «يضبطه `set_default(scope="global")` فقط»)، و §2.7 `set_default`، و ADR-010 («لا يضبطه إلا حامل دور Report View Manager»)، و §5.2 (`Report View Settings.default_saved_view`).
- الدليل: الكتابة على العرض محصورة في مالكه عبر `if_owner` والـ hook (§6). فحين يضبط Report View Manager عرضاً يملكه غيره كافتراضي عام، يفشل `save()` عند `check_permission("write")` (`F/model/document.py:395-398`)، ولا مخرج إلا `ignore_permissions` أو `frappe.db.set_value`، وكلاهما ممنوع. وبالعكس، مالك العرض يستطيع `PUT /api/resource/Report View Saved View/<name>` بقيمة `is_global_default=1` لأنه يملك `write`، فيفرض عرضه على كل مستخدمي التقرير. وهناك مصدران للحقيقة: `is_global_default` و `Report View Settings.default_saved_view`.
- التعديل المطلوب: حذف `is_global_default` من العرض. الافتراضي العام هو `Report View Settings.default_saved_view` وحده، ويكتبه من يملك `write` على Settings (System Manager و Report View Manager) بصلاحياته العادية، ويتحقق `validate` في Settings من أن العرض `visibility != Private`. يُعدَّل §2.7 و §6 و ADR-010 تبعاً لذلك.

### عالٍ

**ع1. `guard_print` ينجح لمن ليس له `print` إذا شُورك معه أي مستند من `ref_doctype`**
- الموضع: §2.0 `guard_print`، و §2.2 (`perms.can_print`)، و §2.5، و §12.
- الدليل: `frappe.has_permission(doctype, "print")` بلا `doc`: إن لم تمنح الأدوار `print` يُستدعى `false_if_not_shared` (`P:208-209`). `print` ضمن `share_rights` (`P:178`) ويُترجَم إلى `read` (`P:185`)، ثم «if atleast one shared doc of that type, then return True» (`P:199-202`). تحقق على الموقع (`review2_probe.py`): 10 مستخدمين من 16 لديهم DocShare على `User` (منهم `hosban30799@gmail.com` و `account@manager.com`) نتيجتهم `get_role_permissions("User")["print"] = 0`، لكن `has_permission("User","print") = True`، ومع `ignore_share_permissions=True` صارت `False`. الأصل لا يعتمد على المشاركة هنا، فهو يبني `can_print` من صلاحيات الأدوار (`F/utils/user.py:117-162`).
- التعديل المطلوب: `guard_print` = `frappe.has_permission(report.ref_doctype, "print", ignore_share_permissions=True)`. المعامل موجود في الغلاف العام (`F/__init__.py:600-634`). يُطبَّق نفس الشيء على `perms.can_print` في `get_meta`. ويُضاف إلى §12 أن مشاركة مستند واحد لا تمنح طباعة تقرير كامل.

**ع2. `prepared_report_name` يمرَّر بلا تحقق من التقرير أو المالك**
- الموضع: §2.1 («مع `prepared_report_name` داخل `filters` كما تفعل الواجهة الأصلية»)، و ADR-009، و §12 («Prepared Report يُصفّى وقت التوليد بمستخدم المالك»).
- الدليل: `Q:282-284` يفحص `read` على مستند Prepared Report فقط، ثم `Q:360` يحمّله ويعيد بياناته **دون مقارنة `doc.report_name` بـ `report_name`**. hook الـ Prepared Report يسمح بقراءة أي مستند (**لأي مالك**) ما دام تقريره ضمن تقارير المستخدم، ويسمح لـ System Manager بكل شيء (`F/core/doctype/prepared_report/prepared_report.py:338-351`). النتيجة: مستخدم مقيّد بـ User Permission (مثل `rv_restricted`) يستطيع قراءة نتيجة ولّدها مستخدم غير مقيّد لنفس التقرير، لأن التصفية حدثت بصلاحيات المولِّد (`permissions.md` §3.5). ويستطيع أيضاً تمرير `report_name` لتقرير مسموح مع `prepared_report_name` لتقرير آخر من تقاريره. المعمارية تذكر أن التصفية تحدث «وقت التوليد» ولا تذكر القراءة عبر المالكين.
- التعديل المطلوب: في `api.run`، قبل التمرير، تحقق الاتساق بـ `frappe.get_list("Prepared Report", filters={"name": dn, "report_name": <اسم التقرير المطلوب أو custom_report>, "owner": frappe.session.user}, limit=1)`. إن لم يُعَد صف يُرمى `RVInvalidInput`. هذا تحقق مدخلات بـ `get_list` وليس إعادة تنفيذ صلاحيات. تُضاف الحالة إلى المعروف والمقبول في §12 بوصف دقيق، وإن رأى صاحب المشروع إبقاء سلوك Frappe (القراءة عبر المالكين) فليكن ذلك قراراً صريحاً في ADR-009.

**ع3. معالجة `js_filters` في §2.1 (3) لا تضيف شيئاً، والطبقة تبقى معتمدة على ما يرسله العميل**
- الموضع: §2.1 الفحص (3)، و §4.2 (8)، و ADR-002، و §12 («`js_filters` إلزامي»).
- الدليل: `validate_filters_permissions` تمر على `report.filters + js_filters` (`Q:1146`)، و `get_script()["filters"]` هو `report.filters` نفسه (`Q:210`). أي أن بناء `js_filters` من `get_script` عند غيابها لا يضيف أي تعريف، فجدول `Report.filters` مفحوص أصلاً. وهو فارغ للتقارير الثلاثة على الموقع (`review2_probe.py`: `REPORT_FILTERS … 0`). وتعريفات العميل قابلة للتزوير: تحقق `review2_probe2.py` بالمستخدم `ibraheem@alnajm.com` والشركة `SND Accounting` أعطى `js_filters=[]` ← نجاح، و `[{"fieldname":"company","fieldtype":"Data"}]` ← نجاح، و `Link/Company` ← `ValidationError`. كما أن `MultiSelectList` (party و cost_center و project في `general_ledger.js:39,75,155,166`، و `trial_balance.js:50,61`) لا تُفحص إطلاقاً لأن الشرط `fieldtype == "Link"` (`Q:1149`).
- الحكم على §4.2 (8): **صحيح حرفياً**، فغياب `js_filters` لا يعطي أكثر من استدعاء `frappe.desk.query_report.run` مباشرة (`Q:222-244`، whitelisted ويقبل غياب `js_filters`). لكن كلمة «إلزامي» في §2.1 و §12 توهم بحماية غير موجودة. وتوصية `risks.md` C2 («يرفض الطلب إن وصلته فلاتر بلا تعريفات») أُسقطت بلا تعليل.
- التعديل المطلوب:
  1. صياغة صريحة في §2.1 و §12: «طبقة فلاتر Link في Frappe تعتمد على تعريفات يرسلها العميل. Report View يساوي الأصل ولا يزيد عليه».
  2. حذف البناء من `get_script` أو وصفه بأنه لا يضيف شيئاً.
  3. تقوية مسموحة دون إعادة تنفيذ: حقل خادمي `filter_defs` في `defaults/<report>.json` و `Report View Settings` (مثل `company: Link/Company`) **يُدمج اتحاداً** مع `js_filters` قبل استدعاء `run`، ولا يستبدلها. فيبقى الفحص فحص Frappe نفسه، ولا يستطيع العميل إسقاطه للتقارير المُعدّة. وعند مفتاح في `filters` بلا تعريف في الاتحاد يُسجَّل تحذير، أو يُرفض بحسب قرار C2.
  4. إضافة حدّ `MultiSelectList` إلى قائمة المعروف والمقبول في §12.

**ع4. حذف العرض يفشل بـ `LinkExistsError` حين يشير إليه افتراضي مستخدم آخر، والمهمة المجدولة لا تحل ذلك**
- الموضع: §6 `on_trash`، و §2.7 `delete_view`.
- الدليل: `delete_doc` يستدعي `on_trash` (`F/model/delete_doc.py:164-165`) ثم `check_if_doc_is_linked` (`:170-172`). حقل `saved_view` في `Report View User Default` حقل Link، وكذلك `Report View Settings.default_saved_view`. فإن لم يستطع المالك حذف افتراضيات الآخرين (§6 يعترف بذلك) يُرمى `LinkExistsError` ويفشل الحذف كله، ورسالته تكشف اسم المستند المرتبط (`raise_link_exists_exception`). النتيجة: أي مستخدم يستطيع منع حذف أي عرض عام بمجرد جعله افتراضياً له. وإن استدعى `on_trash` الدالة `frappe.get_list` بلا فلتر `user` فإن `delete_doc` على افتراضيات الآخرين يرمي `PermissionError` داخل `on_trash` نفسه. والمهمة الأسبوعية «كـ Administrator» تنظّف لاحقاً فقط ولا تفك قفل الحذف الآن، كما أنها قرار صلاحيات مؤجل «في ADR لاحق».
- التعديل المطلوب: جعل مرجع الافتراضي غير Link (Data، أو التخزين البديل في ح2)، وتجاهل المرجع المعلّق عند القراءة، وتنظيفه بواسطة صاحب الافتراضي نفسه عند أول قراءة، فلا حاجة لمهمة مجدولة. وإن أُبقيت المهمة المجدولة فتُكتب في ADR الآن وتُذكر في §12. و `on_trash` يحذف افتراضيات المستخدم الحالي فقط (`filters={"user": session.user}`).

**ع5. الـ hook `has_permission` يجب أن يعيد `True` صراحة لكل `ptype` غير مقيَّد، وإلا يمنع**
- الموضع: §6 («`has_permission(doc, ptype, user)`: read ⇐ …؛ write/delete/share/submit ⇐ …»)، و ADR-010.
- الدليل: `has_controller_permissions` تعامل أي قيمة كاذبة كمنع، بما فيها `None`: `if not controller_permission: return bool(controller_permission)` (`P:492-496`). والـ hook يُستدعى لكل `ptype` مع مستند، ومنها `create` عند `insert` (`F/model/document.py:470`) و `print` و `email` و `export` و `report`. المواصفة لا تذكر `create`، ولو أعادت الدالة `None` له لفشل إنشاء أي عرض. وفي المقابل، الـ hook لا يستطيع منح ما لم تمنحه DocPerm (docstring في `P:482-485`).
- التعديل المطلوب: جدول صريح في §6 لكل `ptype` مع النتيجة، والقيمة الافتراضية `True`. و `create` يسمح فقط إن كان `doc.owner == user`. توقيع الدالة: `has_permission(doc, ptype=None, user=None, debug=False)` لأن Frappe يمرر `debug` (`P:493`). وتوقيع pqc: `(user, doctype=None)` لأن Frappe يمرر `doctype=` (`F/database/query.py:1619`).

**ع6. المشاركة (DocShare) وصلاحيات Administrator تتجاوز الـ hook و pqc، والوثيقة لا تحسم ذلك**
- الموضع: ADR-010 («Administrator يتجاوز… يُختبر في المرحلة 4»، «DocShare معطّل للنوع»)، و §13 سؤال 4.
- الدليل (يحسم السؤال المفتوح الآن، دون انتظار المرحلة 4):
  - Administrator: `P:107-109` يعيد `True` قبل `get_doc_permissions` و hook المتحكم (`P:141`، `P:237`). فـ `get_doc` + `check_permission` يسمحان له بقراءة أي عرض خاص وتعديله وحذفه. وحذفه يتجاوز فحص الصلاحية أيضاً (`F/model/delete_doc.py:282`). أما القوائم فيُطبَّق عليها pqc حتى لـ Administrator (`F/database/query.py:1584`، `:1616-1620`)، إلا إذا أعادت دالتنا شرطاً فارغاً له. ويستطيع Administrator انتحال أي مستخدم (`F/core/doctype/user/user.py:1464-1466`، صلاحية `impersonate`، ومنحها لأي دور يدوياً ممكن)، ويُسجَّل ذلك في Activity Log.
  - System Manager: لا يتجاوز `has_permission` ولا pqc (لا استثناء له في `P:80-224` ولا في `get_role_permissions` `P:282-342`). استثناؤه الوحيد هو `can_export` (`P:645-646`)، وهو غير مفعّل للنوع. الادعاء «System Manager بنفس القيود» **صحيح**، بشرط ألا يمنحه أحد صلاحية `impersonate`، وبعيداً عن Server Scripts وSystem Console (قدرات إدارية خارج النطاق).
  - DocShare: بعد منع الـ hook في `get_doc_permissions` (`P:237-239`) يعود `has_permission` إلى `false_if_not_shared` (`P:208-209`)، فالمشاركة **تتغلب على الـ hook**. وفي القوائم «shared docs trump all other restrictions» (`F/database/query.py:1592-1596`). إنشاء المشاركة يتطلب `share` (`F/share.py:213-223`)، فلا يستطيعه إلا Administrator أو كود يمرر `ignore_share_permission`. أما `assign_to.add` فيستدعي `frappe.share.add` بلا تجاوز (`F/desk/form/assign_to.py:116`)، فيفشل لغير Administrator.
- التعديل المطلوب:
  1. تحديث ADR-010 بهذه الحقائق وحذف «يُختبر في المرحلة 4» كسؤال. تبقى الاختبارات لكن كتأكيد.
  2. قرار صريح: Administrator يستطيع الوصول للخاص **بالاسم**، ويُوثَّق كقيد معروف في §12.
  3. دفاع في العمق مسموح لأنه قاعدة عمل لنوعنا لا إعادة لمنطق Frappe: `get_view` و `list_views` يطبّقان شرط الرؤية (`owner == user or visibility…`) صراحة بعد `check_permission`، فلا تفتح DocShare أو أي hook عام من تطبيق آخر (`has_permission["*"]`) عرضاً خاصاً في واجهتنا.

### متوسط

**م1. عنوان العرض وحالته ينتقلان بين المستخدمين بلا قاعدة تهريب**
- الموضع: §6 و §7 (لا ذكر للتهريب إلا لعنوان PDF في §4.2 (6)).
- الدليل: العرض `Public` أو `Roles` ينشئه مستخدم ويعرضه متصفح مستخدم آخر (قائمة العروض والتسميات). و `frappe.dom.eval` يُستخدم لسكربت التقرير فقط، لكن العنوان والوصف والتسميات في `state` نصوص حرة من مستخدم آخر.
- التعديل المطلوب: قاعدة في §6 و §11: كل نص من عرض محفوظ يُدرج بـ `frappe.utils.escape_html` أو `textContent`، ولا يُمرَّر إلى `frappe.format` بنوع HTML. و `validate` يحدّ الطول وينظف عبر `frappe.utils.html_utils.clean_html` أو يرفض HTML. واختبار Playwright بعنوان `<img onerror>`.

**م2. `guard_report` لا يستطيع إنتاج `RVReportDisabled`، وخطوته 3 لا تُبلغ**
- الموضع: §2.0 جدول الأخطاء (`RVReportDisabled`) و `guard_report` الخطوة 3.
- الدليل: التعطيل يُرمى بـ `frappe.throw` بلا صنف (`Q:55-56`)، أي `ValidationError` 417 (تحقق: `Party Code Trial Balance` المعطّل ← `ValidationError`، `http_status_code=417`). و `has_permission(None/"" , "report")` يرمي `DoesNotExistError` 404 داخل `get_report_doc` نفسه (`Q:49` ← `P:131`؛ تحقق `review2_probe2.py`)، فلا تصل الخطوة 3 أبداً، ويظهر التقرير بلا `ref_doctype` للمستخدم كأنه «غير موجود».
- التعديل المطلوب: لا تقرأ `disabled` قبل `get_report_doc`، لأن ذلك يكشف حالة التقرير لمن لا يملك صلاحية. اكتب إمّا: «ترتيب Frappe يفحص الصلاحية قبل التعطيل (`Q:43-56`)؛ نلتقط `ValidationError` من `get_report_doc` فقط إن كان `frappe.db.get_value("Report", name, "disabled")` = 1 **بعد** نجاح فحصَي الصلاحية ونحوّله إلى `RVReportDisabled`»، أو احذف `RVReportDisabled` واقرأ الرسالة الأصلية. والخطوة 3 إمّا تُحذف (الحقل إلزامي، `permissions.md` §3.6) أو يُوثَّق أن الخطأ الفعلي `DoesNotExistError`.

**م3. PDF يتطلب `export` خلافاً للأصل**
- الموضع: §2.5 («`guard_print` **ثم** `guard_export`»)، و §12.
- الدليل: الأصل يعرض Print/PDF بشرط `can_print` فقط (`F/public/js/frappe/views/reports/query_report.js:1956,1974`؛ `permissions.md` §3.9). على الموقع، أدوار Sales Invoice المحاسبية: `print=1, export=0` (`permissions.md` §3.2). فهؤلاء يطبعون PDF في الأصل ويُمنعون في Report View. الترتيب نفسه سليم أمنياً (الفحصان يسبقان أي تشغيل، والترتيب يغيّر الرسالة فقط). لكن شرط المراجعة «يطبع فقط ما يسمح له به Frappe الأصلي» يعني أن المنع الزائد انحراف وظيفي يجب أن يكون مقصوداً.
- التعديل المطلوب: قرار صريح في ADR-004 أو ADR-001: إمّا `print` وحده (مطابقة الأصل)، أو الاثنان مع تعليل وإدراجه في §11.3 كانحراف مقصود، وفي مصفوفة الاختبار (`rv_*` + Auditor + Sales Invoice).

**م4. الفحص «لا يرمي» يترك رسائل الرفض في `_server_messages`**
- الموضع: §2.6 `get_entry_state`، و §2.2 (حساب `perms` دون رمي)، والـ hook المقترح في ح1 (2).
- الدليل: `frappe.throw` يضيف الرسالة إلى `frappe.local.message_log` قبل الرفع، و `get_report_doc` يرمي بـ `frappe.throw` (`Q:44-47`، `Q:50-53`). التقاط الاستثناء لا يحذف الرسالة، فتصل إلى المتصفح في `_server_messages` مع رد `{"show": false}` وتظهر كنافذة خطأ في كل صفحة query-report.
- التعديل المطلوب: الصيغة غير الرامية تحفظ طول `message_log` وتعيده بعد الالتقاط. يُكتب ذلك في §2.0 كجزء من `guard_report(raise_exception=False)`.

**م5. تحويل رفض العرض إلى 404**
- الموضع: §2.7 `get_view` (`RVViewNotFound` لغير المرئي).
- الدليل: `check_permission` يرمي `frappe.PermissionError` (`F/model/document.py:395-398`). إن لم يُلتقط فالرد 403 لعرض موجود و 404 لغير موجود، وهذا يكشف وجود الاسم. الأسماء hash، فالخطورة محدودة.
- التعديل المطلوب: نص صريح: التقاط `PermissionError` من `check_permission("read")` وتحويله إلى `RVViewNotFound`، وتفريغ `message_log` (م4). ويفحص `get_meta` قابلية قراءة الافتراضي (`defaults.saved_view`) قبل إعادة اسمه.

**م6. شرط الأدوار في pqc بلا `parenttype`**
- الموضع: §6 pqc (`name IN (SELECT parent FROM Report View Saved View Role WHERE role IN …)`).
- الدليل: نفس الثغرة النظرية المذكورة لـ `Report.is_permitted` (`F/core/doctype/report/report.py:144`، `permissions.md` §8 سؤال 1).
- التعديل المطلوب: إضافة `parenttype = 'Report View Saved View' AND parentfield = 'roles'`. وأدوار المستخدم تُحسب بـ `frappe.get_roles(user)` للمعامل `user`، لا لمستخدم الجلسة.

### منخفض

**ن1. Page بأدوار فارغة متاحة للزائر**
- الموضع: ADR-005 («أدوار الصفحة: فارغة»).
- الدليل: `getpage` هو `@frappe.whitelist(allow_guest=True)` (`F/desk/desk_page.py:24`). و `Page.is_permitted` يعيد `True` عند غياب الأدوار (`F/core/doctype/page/page.py:126-136`). ثم `load_assets` يقرأ JS و CSS، وينفّذ `get_context` لأي ملف `.html` فيه `<!-- jinja -->` (`page.py:167-185`). السكربت نفسه منشور في `/assets` أصلاً، فلا كشف حالياً.
- التعديل المطلوب: أدوار الصفحة `Desk User` (يستبعد Guest و Website User دون تقييد مستخدمي Desk)، وقاعدة: لا `.html` بـ jinja ولا `get_context` في مجلد الصفحة.

**ن2. `Report View Settings` و Global Settings مقروءة لكل مستخدمي Desk**
- الموضع: §5.2، و §2.2 (2).
- الدليل: عبر `/api/resource/Report View Settings` يرى أي مستخدم إعدادات كل التقارير: قواعد الإثراء والتفصيل وتسميات خانات التوقيع، واسم كل سجل هو اسم تقرير. أسماء التقارير ليست سراً، فـ `Report` مقروء لـ `Desk User` (`F/core/doctype/report/report.json:282-284`). ولا تحوي الإعدادات بيانات مالية. لا كشف حساس بشرط ألا تُخزَّن فيها أسرار.
- التعديل المطلوب: `Desk User` بدل «كل مستخدمي Desk» غير المحدد، وجملة في §5.2: «الإعدادات غير سرية؛ ممنوع تخزين بيانات أو أسماء أشخاص فيها». التوقيعات تسميات وظائف لا أسماء.

**ن3. الإثراء (ADR-011) سليم، مع ملاحظتين**
- الدليل: في v16 يطبّق `frappe.get_list` صلاحيات الحقول نفسه (`F/database/query.py:352-353` ← `apply_field_permissions` `:1376-1453`)، ويطبّق User Permissions و pqc والمشاركة على المستندات (`:1563-1598`). والقناع (mask) يُطبَّق عند التنفيذ (`:337-339`). و `get_permitted_fieldnames` (`F/model/meta.py:684-726`) طبقة إضافية لا تضر. و `missing` عدد بلا تمييز بين «غير موجود» و«غير مسموح»، فلا يصلح كاشفاً للوجود. والأسماء يتحكم بها العميل، لكن النتيجة لا تتجاوز ما يعطيه `/api/resource/<doctype>` لنفس المستخدم، والحقول محصورة بقائمة السماح.
- الملاحظتان: (أ) `get_permitted_fieldnames(user=…)` بنوع `read` الافتراضي يُسقط كل الحقول لمن يملك `select` فقط، والأصح `permission_type=None` ليقرر Frappe (`meta.py:701-705`). (ب) يُمنع في `validate` لقواعد الإثراء أي حقل بصيغة `link.field` أو `child.field`، لأن `get_list` يفسّرها كربط (`query.py:1398-1412`)، فالسماح يبقى لحقول مباشرة فقط.

**ن4. كائن الواجهة `frappe.query_report` (ADR-006): لا أثر أمني**
- التحليل: كل ما يمر عبره يعمل في متصفح المستخدم نفسه، ولا يمنح صلاحية خادمية: `refresh` و `set_filter_value` ينتهيان إلى `api.run` المحروس. وسكربتات التقارير تُنفَّذ بـ `frappe.dom.eval` كما في الأصل (`query_report.js:425-434`)، وهي من تطبيقات مثبتة. `raw_data` في الكائن هو نفس ما عاد للمستخدم. الخطر الوحيد وظيفي: عدم الاستعادة عند `on_page_hide`، وهو مغطى باختبار في ADR-006.
- التعديل المطلوب: جملة في ADR-006: «الكائن ليس حدّاً أمنياً؛ كل فحص على الخادم». وتنبيه في §5.1: `hidden` في `register` و `column_rules` إخفاء عرض لا صلاحية، والعمود موجود في `raw`.

**ن5. `get_entry_state` لا يكشف أكثر من الأصل**
- الدليل: أي فشل يعيد `{"show": false}`، فلا فرق بين غير موجود وممنوع ومعطّل. أما `get_meta` فيرمي `DoesNotExistError` (404) لغير الموجود و `PermissionError` (403) للممنوع (تحقق: `get_report_doc("zz-not-a-report")` ← `DoesNotExistError` 404)، وهذا مطابق لـ `get_script` الأصلي (`Q:178-180`). وأسماء التقارير غير سرية (ن2).
- التعديل المطلوب: لا شيء سوى م4.

**ن6. التصدير في الخلفية**
- الدليل: `frappe.enqueue` يحفظ `frappe.session.user` (`F/utils/background_jobs.py:179`)، و `execute_job` يعيده (`:251-252`)، فالفحوص في المهمة تعمل بصلاحيات المستخدم.
- التعديل المطلوب: نص في §2.4: المهمة تعيد `guard_report` و `guard_export` داخلها (قد تتغير الصلاحيات بين الطلب والتنفيذ)، والملف `is_private=1` ومرفق بلا `attached_to` مشترك، ويُقرأ لمالكه فقط.

---

## إجابات الأسئلة المطلوبة

| # | السؤال | الحكم | الدليل |
|---|---|---|---|
| 1 | هل `get_report_doc` يفحص الأدوار و `report` على `ref_doctype` و `disabled`؟ هل يبقى مسار لا يبدأ به؟ | **نعم** للفحوص الثلاثة: `is_permitted` (`Q:43-47` ← `report.py:140-155` مع Custom Role)، و `has_permission(ref_doctype,"report")` (`Q:49-53`)، و `disabled` (`Q:55-56`) بعد الصلاحيات. ملاحظة: في Custom Report تُفحص أدوار التقرير المرجعي وتعطيله لا المخصص (`Q:28-41` ثم `:43`)، وهذا سلوك الأصل. كل الدوال في §2 تبدأ بـ `guard_report`. **لكن** DocTypes التطبيق مكشوفة عبر REST القياسي بلا `guard_report` (ح1، ح2). | — |
| 2 | إعادة تنفيذ صلاحيات أو استخدام محظور؟ | لا إعادة تنفيذ في المسار الأساسي، ولا `ignore_permissions` أو `set_user` أو `db.sql` أو `get_all` في مسار يعيد بيانات. **لكن** تصميم `is_global_default` (ح3) وحذف العروض المرتبطة (ع4) يجبران المنفّذ على تجاوز. والمهمة المجدولة كـ Administrator ليست مساراً يعيد بيانات، لكنها قرار مؤجل بلا ADR (ع4). | ح3، ع4 |
| 3 | `js_filters` | المعالجة المقترحة لا تضيف شيئاً (`Q:1146` + `Q:210`). ادعاء §4.2 (8) صحيح حرفياً، لكن الطبقة معتمدة على العميل في الأصل أيضاً. | ع3 |
| 4 | `can_export` و `print` | `can_export` صحيح ومطابق لـ `export_query` (`Q:383-386`، `P:644-652`). `has_permission(ref,"print")` **ناقص**: يمر بالمشاركة (ع1)، والتصحيح `ignore_share_permissions=True`. الترتيب في `export_pdf` سليم أمنياً (الفحصان قبل التشغيل)، واشتراط `export` انحراف وظيفي يحتاج قراراً (م3). | ع1، م3 |
| 5 | الإثراء | `get_list` في v16 يمنع حقول permlevel الأعلى والمستندات خارج User Permissions بنفسه. لا تسريب عبر `missing`. | ن3 |
| 6 | العروض المحفوظة | الـ hooks تُستدعى لكل `ptype` مع مستند (`P:237`، `P:489-496`)، بما فيها `create`، و `None` يعني منعاً. System Manager لا يتجاوزها. Administrator يتجاوز `has_permission` (`P:107`) ولا يتجاوز pqc في القوائم. DocShare يتجاوز الـ hook و pqc معاً. REST القياسي يتجاوز `guard_report`. التصميم الحالي **لا يحقق** الشرط بالكامل. | ح1، ح2، ح3، ع5، ع6 |
| 7 | Page بأدوار فارغة | نعم، مسموحة للجميع، ومنهم Guest عبر `getpage` (`allow_guest=True`). لا يكشف شيئاً اليوم، والتوصية `Desk User`. | ن1 |
| 8 | `get_entry_state` و `get_meta` والإعدادات | لا كشف يتجاوز الأصل. رسائل الرفض قد تتسرب في `_server_messages` (م4). الإعدادات غير حساسة بشروط ن2. | م4، ن2، ن5 |
| 9 | كائن الواجهة | لا أثر أمني. | ن4 |

## ما تحقق وقُبل كما هو
- ADR-002: التغليف والتمرير بلا `user` (`Q:222-244` يتجاهله).
- `guard_export` عبر `can_export` قبل إعادة التشغيل، وإعادة التشغيل على الخادم بدل الوثوق بصفوف المتصفح (§2.4، §4.2).
- إدراج حدود Frappe المعروفة في §12 (أعمدة Link فقط، `Q:934-935`). يُضاف إليها: `MultiSelectList`، والقراءة عبر المالكين في Prepared Report، وAdministrator بالاسم.
- مصادر إعدادات الأمان خادمية فقط (§5.3: `enrich_rules` و `drilldowns` و `pdf_generator`)، وأهداف التفصيل تمر بـ `api.run` وصلاحياته.
- `export_model` لا يُدخل HTML من المتصفح إلى القالب (§4.2 (6)).

## التعديلات المطلوبة للتحويل إلى قبول
1. ح1: DocPerm على `Desk User`، وفحص التقرير داخل hook القراءة و pqc بدوال Frappe، وصف REST في §12.
2. ح2: ربط `User Default.user` بالجلسة مع pqc و hook، أو نقله إلى `frappe.defaults` أو User Settings.
3. ح3: حذف `is_global_default` واعتماد `Report View Settings.default_saved_view`.
4. ع1: `ignore_share_permissions=True` في `guard_print` و `perms.can_print`.
5. ع2: تحقق `prepared_report_name` (التقرير والمالك) بـ `get_list`، أو قرار صريح بخلافه.
6. ع3: صياغة صادقة لـ `js_filters`، و `filter_defs` خادمية تُدمج اتحاداً، و `MultiSelectList` في §12.
7. ع4: مرجع افتراضي غير Link وتنظيف ذاتي، أو ADR للمهمة المجدولة الآن.
8. ع5: جدول `ptype` للـ hook بقيمة افتراضية `True`، وتوقيعَا pqc و hook.
9. ع6: تحديث ADR-010 بحقائق Administrator و DocShare، وتطبيق شرط الرؤية صراحة في `get_view` و `list_views`.
10. البنود المتوسطة والمنخفضة تُعدَّل في نفس التحديث، ولا تمنع القبول وحدها.

---

## المراجعة الثانية

- التاريخ: 2026-09-30. المراجَع: commit `ac4bfa7` (`docs: address phase 2 permissions review …`)، يعدّل `docs/architecture.md` و ADR-005 و 007 و 009 و 010 و 011.
- سكربتات إضافية (قراءة فقط، `rollback`، دون أي `save`): `review2_probe3.py` إلى `review2_probe6.py` في مجلد الـ scratchpad المذكور أعلاه.

### الحكم النهائي: **رفض**

عولجت كل بنود المراجعة الأولى عدا ثلاثة. لكن التحقق من التصميم الجديد كشف ثغرة حرجة لم ترد في المراجعة الأولى: **ح4**. يكفي لإصلاحها قاعدة واحدة في §6. بعد إصلاح ح4 وتعديل ع7-ع9 يصبح الحكم **قبولاً**، ولا تمنع البنود المنخفضة القبول.

### حالة بنود المراجعة الأولى

| البند | الحالة | الموضع |
|---|---|---|
| ح1 REST و `All` | عولج: DocPerm على `Desk User`، و `is_visible` بثلاث طبقات مع `get_allowed_report_names`، وصف REST في §12 | `architecture.md:512-535`، `:208`، `:762` |
| ح2 User Default | عولج: نُقل إلى `frappe.defaults` للمستخدم الحالي. لا توجد واجهة whitelisted في Frappe تكتب افتراضياً لمستخدم آخر (`F/defaults.py:12-13` تكتب لـ `session.user` افتراضياً). والمفتاح بصيغة `::` لا يتداخل مع مفاتيح User Permission | `architecture.md:507-510`، `:206` |
| ح3 `is_global_default` | عولج: حُذف الحقل، والمصدر الوحيد `Report View Settings.default_saved_view` | `architecture.md:460`، `:505` |
| ع1 print والمشاركة | عولج في `guard_print` و `perms.can_print` | `architecture.md:135`، `:164` |
| ع2 `prepared_report_name` | عولج، مع ملاحظة ن8 أدناه | `architecture.md:154` (4)، ADR-009:17 |
| ع3 `js_filters` | عولج في الصياغة والاتحاد (الخادمي يغلب عند التعارض)، **لكن** §5.2 تسمح بأنواع لا يفحصها Frappe (ع8) | `architecture.md:154` (3)، `:469`، `:764` |
| ع4 LinkExistsError | عولج **جزئياً**: افتراضي المستخدم لم يعد Link، لكن `default_saved_view` ما زال Link (ع9) | `architecture.md:205`، `:460` |
| ع5 جدول ptype | عولج، والتوقيعات صحيحة لأن `frappe.call` يمرر فقط المعاملات التي تقبلها الدالة (`F/__init__.py:1140-1147`، `:1168-1180`)، مع ملاحظة ن6 | `architecture.md:537-544` |
| ع6 Administrator و DocShare | عولج في §6 و ADR-010، **لكن** §13 ما زال يعرضه سؤالاً (ن7) | `architecture.md:546-549`، `:775` |
| م1 التهريب | عولج | `architecture.md:551` |
| م2 `RVReportDisabled` والخطوة 3 | عولج | `architecture.md:107`، `:130-132` |
| م3 PDF | عولج: `print` وحده كالأصل | `architecture.md:190` |
| م4 `guard_report_quiet` | عولج، مع ملاحظة ن7 عن §12 | `architecture.md:139-141`، `:194` |
| م5 404 | عولج | `architecture.md:115`، `:203` |
| م6 `parenttype` | عولج | `architecture.md:531-532` |
| ن1 Page | عولج (ADR-005، §12) | ADR-005، `architecture.md:763` |
| ن2 الإعدادات | عولج (لا أسرار فيها). الدور في DocPerm لـ Settings لم يُحدَّد باسمه (`:441` «كل مستخدمي Desk»)، والمطلوب `Desk User` صراحة | `architecture.md:441`، `:482` |
| ن3 الإثراء | عولج رفض `link.field`. ولم يُطبَّق `permission_type=None`، وهذا مقبول لأن `get_list` يفرض صلاحيات الحقول بنفسه | `architecture.md:175`، ADR-011 |
| ن4، ن5 | لا تعديل مطلوب | — |
| ن6 الخلفية | عولج | `architecture.md:771` |

### مشاكل المراجعة الثانية

#### حرج

**ح4. أي مستخدم Desk يستولي على عرض غيره (ومنه الخاص) بتغيير حقل `owner` عبر REST**
- الموضع: §6 جدول الـ hook (`architecture.md:542`: «`write`… ⇐ `doc.owner == user`»)، و DocPerm `write` مع `if_owner` (`:512`).
- الدليل:
  - `PUT /api/resource/<doctype>/<name>` = `frappe.get_doc` ثم `doc.update(data)` ثم `doc.save()` (`F/api/v1.py:49-57`). لا يُفحص `read` قبل ذلك.
  - `update` لا يحمي `owner`، فـ `RESERVED_KEYWORDS` لا تضمه (`F/model/base_document.py:292`، `:1598-1607`).
  - `_save` يفحص `check_permission("write")` على المستند **بعد التعديل في الذاكرة** (`F/model/document.py:577`). `is_user_owner` يقرأ `doc.owner` من الذاكرة (`P:233-234`، `P:241`)، فتتحول `if_owner` لصالح المهاجم، وكذلك يفعل الـ hook المقترح (`doc.owner == user`).
  - `set_user_and_timestamp` لا يعيد `owner` إلا للمستند الجديد (`F/model/document.py:797-801`)، و `db_update` يكتب كل الحقول ومنها `owner` (`F/model/base_document.py:804-827`).
  - تحقق فعلي في الذاكرة دون حفظ (`review2_probe6.py`) على نوعين في Frappe بنفس النمط (`All` + `write` مع `if_owner`): `Contact` و `Address` لمستخدم `a.kuhlani@sanad-erp.com` ومالكهما Administrator: `has_permission("write")` = `False`، وبعد `doc.update({"owner": user})` = `True`. في المقابل، تطبيق `ai_agent` يمنع ذلك في hook خاص (`review2_probe5.py`)، فالمنع ممكن من الـ hook.
- الأثر: مستخدم يعرف اسم عرض خاص لغيره (الاسم hash يصل عبر روابط أو سجلات) يرسل `{"owner": "<me>"}`. ينجح الحفظ، ويعيد الرد المستند كاملاً بما فيه `state`، ثم يملك العرض ويستطيع حذفه. وإن لم يعرف الاسم فيستطيع ذلك مع أي عرض `Public` أو `Roles` يراه. هذا يكسر «الخاص لا يراه ولا يعدّله إلا مالكه» مباشرة.
- التعديل المطلوب في §6 وفي ADR-010:
  1. الـ hook لـ `write/delete/cancel/submit/amend/share` يقارن **بالمالك المخزّن** لا بالذاكرة: `(frappe.db.get_value(doc.doctype, doc.name, "owner") if not doc.is_new() else doc.owner) == user`. هذه قراءة قيمة واحدة للمقارنة، لا تعيد بيانات للمستخدم. ويُسجَّل استثناؤها من قاعدة «لا db» صراحة.
  2. `validate`: `if not self.is_new() and self.has_value_changed("owner"): frappe.throw(..., frappe.PermissionError)`.
  3. اختبار خادمي في المرحلة 4: مستخدم B يرسل `owner=B` إلى عرض خاص لـ A عبر `frappe.client.save` ويجب أن يُرفض. واختبار مماثل عبر `/api/resource`.
- ملاحظة خارج النطاق لصاحب المشروع: النمط نفسه ظاهر في `Contact` و `Address` في Frappe، ولا نعدّله (حدود التعديل في `CLAUDE.md`).

#### متوسط

**ع7. تحقق `state` و `roles` و `visibility` غير مذكور في `validate` للمتحكم، فمسار REST يتجاوزه**
- الموضع: §6 (`architecture.md:496` و `:543`: `validate` يذكر فقط تفرد العنوان و `guard_report`)، و §2.7 `save_view` (`:204`: التحقق في الـ API).
- الدليل: `POST/PUT /api/resource` يمر بـ `insert/save` ← `_validate` مباشرة (`F/model/document.py:590-591`) دون `api.views.save_view`. فيُخزَّن `state` لا يطابق المخطط، أو `visibility=Roles` بلا أدوار، ثم يُعرض على مستخدمين آخرين.
- التعديل المطلوب: نص في §6: «`validate` يستدعي `core/view_state.py` (§7.2)، ويفرض `roles` غير فارغة عند `Roles` ومن أدوار موجودة، ويحسب `state_version` و `columns_ref` على الخادم. الـ API لا يكرر هذه القواعد بل يعتمد عليها».

**ع8. `filter_defs` تقبل `Dynamic Link` و `MultiSelectList` ولا يفحصها Frappe**
- الموضع: `architecture.md:469` («`fieldtype` (Link / Dynamic Link / MultiSelectList)… لا يستطيع المتصفح إسقاطها»)، ويناقضه `:764` («`filter_defs` لأنواع Link»).
- الدليل: `validate_filters_permissions` يفحص `fieldtype == "Link"` فقط (`Q:1149`).
- التعديل المطلوب: حصر `fieldtype` في `Link` في §5.2 وفي `validate` لـ Settings، أو توثيق أن الأنواع الأخرى بلا أثر أمني. ولا يجوز تحويلها إلى `Link` بقوائم قيم، لأن ذلك يمرر قائمة إلى `has_permission(doc=list)`، وهو سلوك غير معرّف.

**ع9. حذف عرض هو الافتراضي العام يفشل بـ `LinkExistsError`، و §2.7 يقول عكس ذلك**
- الموضع: `architecture.md:205` («لا روابط Link إليه من مستخدمين آخرين، فلا `LinkExistsError`») مقابل `:460` (`default_saved_view` من نوع Link Report View Saved View).
- الدليل: `F/model/delete_doc.py:170-172` يفحص كل روابط Link بعد `on_trash`. مالك العرض لا يملك `write` على Settings، فلا يستطيع فك الرابط، وستذكر رسالة الخطأ اسم سجل Settings.
- التعديل المطلوب: إمّا Data بدل Link مع تحقق في `validate` لـ Settings، وتجاهل المرجع المعلّق عند القراءة كما في افتراضي المستخدم. وإمّا إبقاء Link وتوثيق أن حذف الافتراضي العام يتطلب من المدير تغييره أولاً، مع رسالة `RVViewInUse` واضحة بدل `LinkExistsError`. ويُصحَّح نص `:205` في الحالتين.

#### منخفض

**ن6. الـ pqc بقائمة فارغة يولّد `IN ()`**
- الموضع: `architecture.md:526`، `:533`.
- الدليل: مستخدم Desk بلا أي تقرير مسموح يجعل `get_allowed_report_names` فارغة، فيصير الـ SQL غير صالح ويفشل كل `get_list` على النوع بخطأ 500. السابقة المقتبسة فيها العيب نفسه (`prepared_report.py:332-334`).
- المطلوب: عند القائمة الفارغة يُحذف الفرع ويبقى `owner = {user}`.
- ومعه: ترتيب جدول الـ hook لـ `read` (`:541`) يوحي بأن فحص التقرير يمنع المالك أيضاً، بينما `:521` يقول إن المالك يرى عرضه دائماً. يُكتب الترتيب صراحة: المالك أولاً، ثم التقرير، ثم `visibility`.

**ن7. بقايا نصية**
- `architecture.md:775` (§13 سؤال 4) ما زال يعرض Administrator سؤالاً مفتوحاً، وقد حُسم في §6 و ADR-010.
- `architecture.md:761` (§12) يكتب `guard_report (لا يرمي)` بدل `guard_report_quiet`.
- `architecture.md:441` لا يسمّي الدور `Desk User` في DocPerm للإعدادات (ن2).

**ن8. `prepared_report_name` مع Custom Report**
- الموضع: `architecture.md:154` (4): `"report_name": report.name`.
- الدليل: بعد `get_report_doc` يكون `report.name` اسم التقرير المرجعي، بينما Prepared Report يخزّن الاسم المرسل. Frappe نفسه يبحث بـ `report.get("custom_report") or report.get("report_name")` (`Q:356-358`).
- المطلوب: استخدام التعبير نفسه، وإلا يُرفض كل Prepared Report لتقرير مخصص (منع زائد لا تسريب).

**ن9. مسح افتراضي المستخدم عند القراءة كتابة في طلب GET**
- الموضع: `architecture.md:508` («يُمسح المفتاح عند أول قراءة»)، و `get_meta` طريقته GET (`:163`).
- المطلوب: الاكتفاء بالتجاهل عند القراءة، والمسح في `set_default` أو عند طلب POST.

### التعديلات المطلوبة للقبول
1. ح4: مقارنة المالك المخزّن في الـ hook، ومنع تغيير `owner` في `validate`، مع اختبار REST.
2. ع7: نقل تحقق `state` و `roles` و `visibility` إلى `validate` للمتحكم.
3. ع8: حصر `filter_defs.fieldtype` في `Link`.
4. ع9: قرار `default_saved_view` (Data أو رسالة واضحة) وتصحيح `:205`.
5. ن6 إلى ن9: تعديلات نصية في نفس التحديث.
