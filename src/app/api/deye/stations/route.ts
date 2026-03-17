import { NextResponse } from 'next/server'
import { getStationList } from '@/lib/deye'

export async function GET() {
  try {
    const data = await getStationList()
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({
      error: err.message,
      detail: err?.cause?.message || null,
      env_check: {
        has_appId: !!process.env.DEYE_APP_ID,
        has_appSecret: !!process.env.DEYE_APP_SECRET,
        has_email: !!process.env.DEYE_EMAIL,
        has_password: !!process.env.DEYE_PASSWORD,
        base_url: process.env.DEYE_API_BASE_URL || 'NOT SET',
        appId_length: process.env.DEYE_APP_ID?.length || 0,
        appSecret_length: process.env.DEYE_APP_SECRET?.length || 0,
      }
    }, { status: 500 })
  }
}
