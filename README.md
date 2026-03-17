# ☀️ Deye Solar Dashboard

Real-time solar inverter monitoring dashboard built with **Next.js 14** + **Recharts** + **Deye Cloud API**.

---

## Features

- ⚡ Live solar power, battery SOC, grid import/export, load consumption
- 📊 Day & Month energy charts
- 🔄 Auto-refresh every 60 seconds
- 🌊 Energy flow diagram
- 🌙 Dark theme with solar aesthetics

---

## Setup (English)

### 1. Install dependencies
```bash
npm install
```

### 2. Create your `.env.local` file
```bash
cp .env.local.example .env.local
```

Edit `.env.local` and fill in your credentials:
```env
DEYE_APP_ID=your_app_id
DEYE_APP_SECRET=your_app_secret
DEYE_EMAIL=your@email.com
DEYE_PASSWORD=your_password
DEYE_API_BASE_URL=https://eu1-developer.deyecloud.com/v1.0
```

> **Base URL options:**
> - Global: `https://eu1-developer.deyecloud.com/v1.0`
> - Check developer.deyecloud.com for your region's URL

### 3. Run development server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### 4. Deploy to Vercel
```bash
# Push to GitHub then connect to Vercel
# Add env variables in Vercel dashboard
```

---

## الإعداد (عربي)

### 1. تثبيت المكتبات
```bash
npm install
```

### 2. إنشاء ملف `.env.local`
```bash
cp .env.local.example .env.local
```

افتح الملف وأضف بياناتك:
```env
DEYE_APP_ID=معرف_التطبيق
DEYE_APP_SECRET=سر_التطبيق
DEYE_EMAIL=بريدك@الإلكتروني
DEYE_PASSWORD=كلمة_المرور
```

> **من أين تحصل على App ID و App Secret؟**
> اذهب إلى developer.deyecloud.com ← قسم Application ← أنشئ تطبيقاً جديداً

### 3. تشغيل المشروع
```bash
npm run dev
```

افتح [http://localhost:3000](http://localhost:3000)

### 4. نشر على Vercel
1. ارفع المشروع على GitHub
2. اربطه بـ Vercel
3. أضف متغيرات البيئة في إعدادات Vercel

---

## API Endpoints Used

| Endpoint | Description |
|----------|-------------|
| `POST /v1.0/account/token` | Get access token |
| `POST /v1.0/station/list` | List all stations |
| `POST /v1.0/station/latest` | Real-time station data |
| `POST /v1.0/station/day` | Today's hourly data |
| `POST /v1.0/station/month` | Monthly daily data |

---

## Troubleshooting

- **"Failed to get access token"** → Check your App ID, App Secret, Email, and Password
- **No data showing** → Try changing `DEYE_API_BASE_URL` to your region's URL
- **Charts empty** → Normal if inverter is offline or night time

---

Built for Ahmad · Powered by Deye Cloud API
