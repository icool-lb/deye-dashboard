import { NextRequest, NextResponse } from 'next/server'
import { getStationLatest, getStationDay, getStationMonth, getStationYear } from '@/lib/deye'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const stationId = Number(searchParams.get('stationId'))
  const type = searchParams.get('type') || 'latest'
  const date = searchParams.get('date') || ''

  if (!stationId) {
    return NextResponse.json({ error: 'stationId required' }, { status: 400 })
  }

  try {
    let data
    if (type === 'latest') data = await getStationLatest(stationId)
    else if (type === 'day') data = await getStationDay(stationId, date)
    else if (type === 'month') data = await getStationMonth(stationId, date)
    else if (type === 'year') data = await getStationYear(stationId, date)
    else return NextResponse.json({ error: 'Invalid type' }, { status: 400 })

    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
