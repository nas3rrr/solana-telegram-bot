# بوت مراقبة محافظ سولانا على تيليجرام

بوت تيليجرام يقوم بمراقبة معاملات محافظ سولانا وإرسال تنبيهات فورية للمعاملات المهمة.

## المميزات

- مراقبة عدة محافظ سولانا
- تنبيهات فورية للمعاملات
- معلومات مفصلة عن المحافظ
- إدارة سهلة للمحافظ (إضافة/إزالة)
- تتبع تاريخ المعاملات
- تصفية حسب الحد الأدنى للمعاملات
- إمكانية تسمية المحافظ لتسهيل التعرف عليها

## المتطلبات

- Node.js (الإصدار 14 أو أحدث)
- npm أو yarn
- رمز بوت تيليجرام (احصل عليه من [@BotFather](https://t.me/botfather))
- رابط RPC لسولانا
- مفتاح API من Helius (اختياري، للمميزات المتقدمة)
- مفتاح API من Solscan (اختياري، لمعلومات إضافية عن المحافظ)

## طريقة الإعداد

1. قم بنسخ هذا المستودع
2. قم بتثبيت المكتبات المطلوبة:

   ```bash
   npm install
   ```

3. قم بإنشاء ملف `.env` في المجلد الرئيسي مع المتغيرات التالية:

   ```
   # إعدادات بوت تيليجرام
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
   ALLOWED_TELEGRAM_USERS=123456789,987654321  # قائمة معرفات المستخدمين المسموح لهم مفصولة بفواصل

   # إعدادات سولانا
   SOLANA_RPC_URL=your_solana_rpc_url_here
   MIN_SOL_AMOUNT=0.1

   # مفاتيح API
   HELIUS_API_KEY=your_helius_api_key_here
   SOLSCAN_API_KEY=your_solscan_api_key_here

   # عناوين المحافظ الأولية (اختياري)
   WALLET_ADDRESSES=wallet1,wallet2,wallet3
   ```

4. قم بتشغيل البوت:
   ```bash
   npm start
   ```

## الأوامر المتاحة

يدعم البوت الأوامر التالية:

- `/start` - بدء البوت وعرض الأوامر المتاحة
- `/list` - عرض قائمة المحافظ قيد المراقبة
- `/check` - فحص جميع المحافظ للمعاملات الأخيرة
- `/add <المحفظة>` - إضافة محفظة جديدة للمراقبة
- `/remove` - إزالة محفظة من المراقبة
- `/info <المحفظة>` - عرض معلومات مفصلة عن محفظة
- `/rename <المحفظة> <الاسم الجديد>` - تغيير اسم المحفظة
- `/help` - عرض رسالة المساعدة

## الأمان

- فقط المستخدمون المدرجون في `ALLOWED_TELEGRAM_USERS` يمكنهم استخدام البوت
- احتفظ بمفاتيح API والرموز في مكان آمن
- لا تشارك ملف `.env` أبداً

## المساهمة

نرحب بمساهماتكم وطلبات التحسين!

## الترخيص

هذا المشروع مرخص تحت رخصة MIT - راجع ملف LICENSE للتفاصيل.
