import crypto from 'crypto'

const BASE_URL = (process.env.DEYE_API_BASE_URL || 'https://eu1-developer.deyecloud.com/v1.0').trim()

let cachedToken: string | null = null
let tokenExpiry: number = 0

async function tryGetToken(password: string) {
  const res = await fetch(BASE_URL + '/account/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appId: (process.env.DEYE_APP_ID || '').trim(),
      appSecret: (process.env.DEYE_APP_SECRET || '').trim(),
      email: (process.env.DEYE_EMAIL || '').trim(),
      password: password,
    }),
  })
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { error: text.slice(0, 300) }
  }
}

export async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken
  }

  const rawPassword = (process.env.DEYE_PASSWORD || '').trim()
  const md5Password = crypto.createHash('md5').update(rawPassword).digest('hex')

  let data = await tryGetToken(md5Password)

  if (!data || !data.data || !data.data.accessToken) {
    const firstError = 'MD5:' + (data?.code || '') + ' ' + (data?.msg || JSON.stringify(data))
    data = await tryGetToken(rawPassword)
    if (!data || !data.data || !data.data.accessToken) {
      throw new Error('Both failed. ' + firstError + ' | Plain:' + (data?.code || '') + ' ' + (data?.msg || JSON.stringify(data)))
    }
  }

  cachedToken = data.data.accessToken
  tokenExpiry = Date.now() + 90 * 60 * 1000
  return cachedToken
}

async function deyePost(endpoint: string, body: object) {
  const token = await getAccessToken()
  const res = await fetch(BASE_URL + endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token,
    },
    body: JSON.stringify(body),
  })
  return res.json()
}

export function getStationList(page: number, size: number) {
  return deyePost('/station/list', { page, size })
}

export function getStationLatest(stationId: number) {
  return deyePost('/station/latest', { stationId })
}

export function getStationDay(stationId: number, date: string) {
  return deyePost('/station/day', { stationId, date })
}

export function getStationMonth(stationId: number, yearMonth: string) {
  return deyePost('/station/month', { stationId, yearMonth })
}

export function getStationYear(stationId: number, year: string) {
  return deyePost('/station/year', { stationId, year })
}

export function getDeviceList(stationId: number) {
  return deyePost('/device/list', { stationId })
}
