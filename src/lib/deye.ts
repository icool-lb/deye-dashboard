import crypto from 'crypto'

const BASE_URL = process.env.DEYE_API_BASE_URL || 'https://eu1-developer.deyecloud.com/v1.0'

let cachedToken: string | null = null
let tokenExpiry: number = 0

export async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (tokens last 2 hours, refresh after 1.5h)
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken
  }

  const password = process.env.DEYE_PASSWORD || ''
  const passwordMd5 = crypto.createHash('md5').update(password).digest('hex')

  const res = await fetch(`${BASE_URL}/account/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appId: process.env.DEYE_APP_ID,
      appSecret: process.env.DEYE_APP_SECRET,
      email: process.env.DEYE_EMAIL,
      password: passwordMd5,
    }),
  })

  const data = await res.json()

  if (!data?.data?.accessToken) {
    throw new Error(data?.msg || 'Failed to get access token')
  }

  cachedToken = data.data.accessToken
  tokenExpiry = Date.now() + 90 * 60 * 1000 // cache for 90 minutes
  return cachedToken as string
}

async function deyePost(endpoint: string, body: object = {}) {
  const token = await getAccessToken()
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    next: { revalidate: 60 }, // cache for 60s
  })
  return res.json()
}

export async function getStationList(page = 1, size = 10) {
  return deyePost('/station/list', { page, size })
}

export async function getStationLatest(stationId: number) {
  return deyePost('/station/latest', { stationId })
}

export async function getStationDay(stationId: number, date: string) {
  // date format: YYYY-MM-DD
  return deyePost('/station/day', { stationId, date })
}

export async function getStationMonth(stationId: number, yearMonth: string) {
  // yearMonth format: YYYY-MM
  return deyePost('/station/month', { stationId, yearMonth })
}

export async function getStationYear(stationId: number, year: string) {
  return deyePost('/station/year', { stationId, year })
}

export async function getDeviceList(stationId: number) {
  return deyePost('/device/list', { stationId })
}

export async function getDeviceLatest(deviceId: number) {
  // Device data uses different base URL
  const token = await getAccessToken()
  const deviceBase = 'https://www.deyecloud.com/device-s'
  const res = await fetch(`${deviceBase}/device/originalData`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    // @ts-ignore
    body: JSON.stringify({ deviceId }),
  })
  return res.json()
}
