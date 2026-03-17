import { NextResponse } from 'next/server'
import { getStationList } from '@/lib/deye'

export async function GET() {
  try {
    const data = await getStationList()
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
