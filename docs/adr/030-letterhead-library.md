# ADR-030: مكتبة أنماط الترويسة وبيانات الشركة على الورق

- الحالة: مقبول
- التاريخ: 2026-11-10
- المراجعة التي بُني عليها: `~/report_view-reviews/2026-11-10-letterhead/report.md`

## السياق
قال صاحب المشروع إن «الترويسات وأنماطها فيها قصور كبير جداً»، وطلب مكتبة كاملة من الأنماط. وجدت المراجعة الناقدة:
- الأنماط تفترض اسماً عربياً وبيانات كاملة. حين يغيب الاسم العربي يُكتب الإنجليزي في مكانه، فيتكرر الاسم في كل الأنماط.
- الترويسة الحالية لا تظهر حين تُفتح في المنشئ.
- النص الطويل يُقص بلا تحذير.
- الترويسات المحفوظة قديماً لا تتحدث حين يتغير المولّد.
- ما يحتاجه الورق المالي غير موجود: السجل، والرقم الموحد، وص.ب، والبنك، والعنوان بالعربية.

## القرار
- **حقول الورق على Company** (`report_view/custom/company.json`، بالطريقة الأصلية في Frappe، وتُزامَن بـ `sync_customizations` لا بـ migrate):
  - `rv_company_name_ar`، `rv_activity_ar` / `rv_activity_en`، `rv_address_ar`.
  - `rv_cr_no`، `rv_unified_no`، `rv_po_box`، `rv_bank_name`، `rv_iban`.
  - الرموز المقابلة في العقد: `company_name_ar`، `address_ar`، `cr_no`، `unified_no`، `po_box`، `bank_name`، `iban`، `activity_ar`، `activity_en` (`core/letterhead.py` `PAPER_FIELDS`).
  - تُملأ من المنشئ في نافذة Frappe («تعديل بيانات الشركة في الترويسة») عبر `api.letterhead.save_company_paper`: صلاحية كتابة الشركة، ثم `db_set` لهذه الحقول فقط، بلا تشغيل `Company.on_update`.
- **الاسم العربي:** حقل الشركة، ثم Translation، **ثم لا شيء**. لا يُكتب الاسم الإنجليزي مرة ثانية. العنصر الفارغ يختفي، والنمط يرتب نفسه.
- **الترويسة الحالية أولاً** (`builder_context.letter_head.current`): ترويسة لم يصنعها المنشئ تظهر كما تُطبع، في إطار لا يشغّل شيئاً، ومعها «ابدأ منها» التي تنقل صورتها إلى عنصر صورة بعرض الشريط. Frappe يعلّم الترويسة «Image» حين لا يجد صورة، فيُقرأ HTML متى وُجد.
- **تحذير القص** (`editor.js` `check_overflow`): الخانة التي تتجاوز أسفل شريطها يظهر فوق الورقة مقدار تجاوزها، وزر «اجعله n مم».
- **إصدار المولّد** (`GENERATOR_VERSION`، مكتوب في الترويسة `data-rv-gen`):
  - الترويسة الأقدم ولم تُعدّل يدوياً تُكتب من جديد بالتصميم نفسه بعد كل migrate (`after_migrate` ← `refresh_all_letter_heads`)، ومن زر «تحديث الترويسة» في المنشئ (`api.letterhead.refresh`).
  - المقارنة بالمحتوى المولَّد لا تصلح، لأن Frappe يعدّل HTML الترويسة حين يحفظها.
- **المكتبة 22 نمطاً في سبع عائلات** (`presets.js` `PRESETS`، `FAMILIES`): بلغتين، حكومي، شركات، رسمي، أشرطة لونية، بسيط، الصفحات التالية.
  - الستة الأولى صُحّحت:
    - لا بلاطة بيضاء تُطبع بلا شعار.
    - الخط يتبع لون الشركة.
    - تسميات بلغة كل جهة.
    - السجل حقل منظّم.
  - ستة عشر نمطاً جديداً من بحث في ترويسات حقيقية (شركات، وزارات يمنية وسعودية، بنوك، محاماة، مقاولات، مؤسسات).
  - المعرض يصفّي الأنماط بالعائلة.
- **تسمية واحدة:** «الترويسة» في كل الواجهة. تُرجم `Letter Head` إلى «الترويسة» بدل «ترتيب الرسالة» عند Frappe، و«ورق الشركة» إلى «الترويسة».

## مصادر البحث
- البنك المركزي السعودي، بيانات المراسلات: https://rulebook.sama.gov.sa/en/node/5536 ، والرقم الموحد: https://rulebook.sama.gov.sa/en/node/10428
- تذييلات بنوك حقيقية: https://www.sab.com/en/about-sab/about/awards ، https://www.alrajhibank.com.sa/en/Track
- الفوترة في السعودية: https://zatca.gov.sa/en/RulesRegulations/Taxes/Documents/E-invoicing_Simplified%20GL.pdf
- أدلة هوية حكومية: https://www.moe.gov.sa/ar/mediacenter/PhotoLibrary/Documents/moe-visual-identity.pdf ، https://mohesr.gov.ae/Ar/MediaCenter/Documents/MOEUAE%20GOV%20Visual%20Identity%20Guidelines%20for%20Ministries%20AR%20(digital)%20(1).pdf
- أدلة تصميم الترويسة: https://madegooddesigns.com/letterhead-design/ ، https://www.moo.com/blog/inspiration/what-goes-on-a-letterhead ، https://glds-website.pages.dev/blog/arabic-english-bilingual-branding
- البيانات الإلزامية على الورق: https://www.pinsentmasons.com/out-law/guides/company-details-on-stationery-and-at-business-premises

## ما بقي
- **ترويسة للصفحة الأولى وأخرى للصفحات التالية:** نمطا «الصفحات التالية» يغطيانها الآن كترويسة مستقلة.
- **ما تحتاجه لغة المنشئ للأنماط:**
  - صف أفقي يتدفق فيغلق فراغ العنصر الغائب.
  - محاذاة يمين ويسار ثابتة للعنصر الحر.
  - محاذاة رأسية للخانة.
  - رمز للجهة الأم في الأنماط الحكومية.
- **الشريط حتى حافة الورقة.**
