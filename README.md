# iCOOL · مراقبة أنظمة Deye

منصة مربوطة بـ Deye Cloud OpenAPI (سيرفر Europe، شركة Icool) لمراقبة كل أنظمة iCOOL.

## الميزات
- قائمة الأنظمة + فلتر متصل/غير متصل
- الذروة اليومية (حتى سنتين) + ملخص شهري + CSV
- منحنى اليوم (كل 5 دقائق)، القيم اللحظية، الأجهزة
- **تقييم الأداء**: قدرة الألواح مقارنة بالمتوقع (مع استبعاد أوقات امتلاء البطارية)، الإنتاج kWh/kWp، مقارنة الـ Strings (تيار/جهد)، Clipping، حرارة الإنفرتر، البطارية
- **ترتيب أداء كل الأنظمة**
- **التنبيهات** كل 30 دقيقة (أعطال Deye، فصل، اتصال جزئي) + تلغرام
- **تقرير شهري للزبون** قابل للطباعة PDF
- قاعدة بيانات Supabase (`icool-deye-monitor`) فيها الإحصاءات اليومية لكل الأنظمة

## متغيرات Vercel
DEYE_APP_ID, DEYE_APP_SECRET, DEYE_EMAIL, DEYE_PASSWORD, DEYE_COMPANY_ID, DEYE_BASE_URL,
ACCESS_CODE, STATION_TZ, SUPABASE_URL, SUPABASE_KEY, DB_SECRET, CRON_SECRET, TELEGRAM_TOKEN (اختياري)

## المهام المجدولة
- Vercel Cron: `/api/cron/sync` يومياً
- Supabase pg_cron: `/api/cron/alerts` كل 30 دقيقة، `/api/cron/backfill` لملء التاريخ
