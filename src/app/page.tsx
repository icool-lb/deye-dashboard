'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Sun, Battery, Zap, Home, TrendingUp, TrendingDown,
  RefreshCw, Wifi, WifiOff, ChevronDown, BarChart2, Calendar
} from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts'

// ─── Types ───────────────────────────────────────────────────────────────────
interface Station {
  id: number
  name: string
  capacity?: number
  status?: number
}

interface StationLatest {
  generationPower?: number    // current solar W
  gridPower?: number          // + = importing, - = exporting
  batteryPower?: number       // + = charging, - = discharging
  loadPower?: number          // home consumption W
  batterySoc?: number         // 0-100%
  todayEnergy?: number        // kWh today
  totalEnergy?: number        // total kWh
  gridStatus?: number
  [key: string]: any
}

// ─── Components ──────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  unit,
  color,
  sub,
  glow,
}: {
  icon: any; label: string; value: number | string; unit: string
  color: string; sub?: string; glow?: string
}) {
  return (
    <div className={`card ${glow || ''}`} style={{ borderColor: color + '33' }}>
      <div className="flex items-start justify-between mb-4">
        <span style={{ color: 'var(--text-muted)', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          {label}
        </span>
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <Icon size={18} style={{ color }} />
        </div>
      </div>
      <div className="metric-value" style={{ color }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
        <span style={{ fontSize: '1rem', marginLeft: 4, color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>
          {unit}
        </span>
      </div>
      {sub && (
        <div style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: '11px' }}>{sub}</div>
      )}
    </div>
  )
}

function FlowDiagram({ data }: { data: StationLatest }) {
  const solar = (data.generationPower || 0) / 1000
  const grid = data.gridPower || 0
  const battery = data.batteryPower || 0
  const load = (data.loadPower || 0) / 1000
  const soc = data.batterySoc || 0

  const gridImport = grid > 0 ? grid / 1000 : 0
  const gridExport = grid < 0 ? Math.abs(grid) / 1000 : 0
  const battCharge = battery > 0 ? battery / 1000 : 0
  const battDischarge = battery < 0 ? Math.abs(battery) / 1000 : 0

  const NodeBox = ({ label, value, unit, color, sub }: any) => (
    <div style={{
      background: 'var(--surface2)', border: `1px solid ${color}44`,
      borderRadius: 10, padding: '10px 14px', textAlign: 'center', minWidth: 90
    }}>
      <div style={{ color, fontSize: '1.1rem', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
        {value}<span style={{ fontSize: '0.7rem', marginLeft: 2 }}>{unit}</span>
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: '10px', marginTop: 2 }}>{label}</div>
      {sub && <div style={{ color, fontSize: '10px', marginTop: 1 }}>{sub}</div>}
    </div>
  )

  const Arrow = ({ active, color, label }: any) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <div style={{
        width: 40, height: 2,
        background: active ? color : 'var(--border)',
        position: 'relative', transition: 'background 0.3s'
      }}>
        {active && (
          <div style={{
            position: 'absolute', right: -4, top: -4,
            width: 0, height: 0,
            borderTop: '5px solid transparent',
            borderBottom: '5px solid transparent',
            borderLeft: `6px solid ${color}`
          }} />
        )}
      </div>
      {label && <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{label}</span>}
    </div>
  )

  return (
    <div className="card" style={{ gridColumn: 'span 2' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 16 }}>
        Energy Flow
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
        <NodeBox label="Solar" value={solar.toFixed(2)} unit="kW" color="var(--solar)" />
        <Arrow active={solar > 0} color="var(--solar)" />
        <NodeBox label="Inverter" value={(load).toFixed(2)} unit="kW" color="var(--text)" sub="Load" />
        <Arrow active={load > 0} color="var(--load)" />
        <NodeBox label="Home" value={load.toFixed(2)} unit="kW" color="var(--load)" />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <NodeBox
          label="Battery"
          value={`${soc}%`}
          unit=""
          color={soc < 20 ? 'var(--battery-low)' : 'var(--battery)'}
          sub={battCharge > 0 ? `+${battCharge.toFixed(1)}kW` : battDischarge > 0 ? `-${battDischarge.toFixed(1)}kW` : 'Idle'}
        />
        <Arrow active={gridImport > 0 || gridExport > 0} color={gridExport > 0 ? 'var(--export)' : 'var(--grid)'} />
        <NodeBox
          label="Grid"
          value={gridImport > 0 ? `↓${gridImport.toFixed(2)}` : `↑${gridExport.toFixed(2)}`}
          unit="kW"
          color={gridExport > 0 ? 'var(--export)' : 'var(--grid)'}
          sub={gridExport > 0 ? 'Exporting' : gridImport > 0 ? 'Importing' : 'Idle'}
        />
      </div>
    </div>
  )
}

// Custom tooltip
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 8, padding: '8px 12px' }}>
      <p style={{ color: 'var(--text-muted)', fontSize: '11px', marginBottom: 4 }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color, fontSize: '12px' }}>
          {p.name}: <strong>{p.value?.toFixed?.(2) ?? p.value}</strong>
        </p>
      ))}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [stations, setStations] = useState<Station[]>([])
  const [selectedStation, setSelectedStation] = useState<number | null>(null)
  const [latest, setLatest] = useState<StationLatest | null>(null)
  const [dayData, setDayData] = useState<any[]>([])
  const [monthData, setMonthData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [tab, setTab] = useState<'day' | 'month'>('day')

  // Fetch stations on mount
  useEffect(() => {
    fetch('/api/deye/stations')
      .then(r => r.json())
      .then(d => {
        const list: Station[] = d?.data?.infos || d?.data || []
        setStations(list)
        if (list.length > 0) setSelectedStation(list[0].id)
      })
      .catch(e => setError(e.message))
  }, [])

  // Fetch station data when selected
  const fetchData = useCallback(async () => {
    if (!selectedStation) return
    setLoading(true)
    try {
      const today = new Date()
      const dateStr = today.toISOString().split('T')[0]
      const monthStr = dateStr.slice(0, 7)

      const [latestRes, dayRes, monthRes] = await Promise.all([
        fetch(`/api/deye/station?stationId=${selectedStation}&type=latest`).then(r => r.json()),
        fetch(`/api/deye/station?stationId=${selectedStation}&type=day&date=${dateStr}`).then(r => r.json()),
        fetch(`/api/deye/station?stationId=${selectedStation}&type=month&date=${monthStr}`).then(r => r.json()),
      ])

      setLatest(latestRes?.data || latestRes)
      setDayData(dayRes?.data?.infos || dayRes?.data || [])
      setMonthData(monthRes?.data?.infos || monthRes?.data || [])
      setLastUpdate(new Date())
      setError(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [selectedStation])

  useEffect(() => { fetchData() }, [fetchData])

  // Auto-refresh every 60s
  useEffect(() => {
    const interval = setInterval(fetchData, 60000)
    return () => clearInterval(interval)
  }, [fetchData])

  const solarKw = ((latest?.generationPower || 0) / 1000).toFixed(2)
  const loadKw = ((latest?.loadPower || 0) / 1000).toFixed(2)
  const gridKw = ((Math.abs(latest?.gridPower || 0)) / 1000).toFixed(2)
  const isExporting = (latest?.gridPower || 0) < 0
  const battSoc = latest?.batterySoc || 0
  const todayEnergy = latest?.todayEnergy || 0
  const totalEnergy = (latest?.totalEnergy || 0).toLocaleString()

  return (
    <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh', padding: '24px 20px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{
            fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 800,
            background: 'linear-gradient(135deg, var(--solar), #ff6b35)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            letterSpacing: '-0.03em'
          }}>
            ☀ DEYE SOLAR
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: 2 }}>
            Real-time inverter monitoring
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Station selector */}
          {stations.length > 1 && (
            <div style={{ position: 'relative' }}>
              <select
                value={selectedStation || ''}
                onChange={e => setSelectedStation(Number(e.target.value))}
                style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  color: 'var(--text)', borderRadius: 8, padding: '8px 32px 8px 12px',
                  fontSize: '12px', fontFamily: 'var(--font-body)', cursor: 'pointer', appearance: 'none'
                }}
              >
                {stations.map(s => (
                  <option key={s.id} value={s.id}>{s.name || `Station ${s.id}`}</option>
                ))}
              </select>
              <ChevronDown size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            </div>
          )}

          {/* Status + Refresh */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {error
              ? <WifiOff size={16} style={{ color: 'var(--battery-low)' }} />
              : <Wifi size={16} style={{ color: 'var(--battery)', animation: 'pulse-solar 2s infinite' }} />
            }
            <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
              {lastUpdate ? lastUpdate.toLocaleTimeString() : 'Connecting...'}
            </span>
            <button
              onClick={fetchData}
              style={{
                background: 'var(--surface2)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '6px 10px', cursor: 'pointer',
                color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4
              }}
            >
              <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            </button>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          background: '#ef444418', border: '1px solid #ef444444',
          borderRadius: 10, padding: '12px 16px', marginBottom: 20, color: '#fca5a5', fontSize: '12px'
        }}>
          ⚠ API Error: {error} — Check your .env.local credentials
        </div>
      )}

      {/* Main Stats Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 16, marginBottom: 20
      }}>
        <StatCard
          icon={Sun} label="Solar Power" value={solarKw} unit="kW"
          color="var(--solar)" glow="glow-solar"
          sub={`Today: ${todayEnergy} kWh`}
        />
        <StatCard
          icon={Zap} label="Grid" value={gridKw} unit="kW"
          color={isExporting ? 'var(--export)' : 'var(--grid)'} glow="glow-grid"
          sub={isExporting ? '↑ Exporting' : '↓ Importing'}
        />
        <StatCard
          icon={Battery} label="Battery" value={`${battSoc}`} unit="%"
          color={battSoc < 20 ? 'var(--battery-low)' : 'var(--battery)'} glow="glow-batt"
          sub={`${((Math.abs(latest?.batteryPower || 0)) / 1000).toFixed(2)} kW ${(latest?.batteryPower || 0) > 0 ? 'Charging' : (latest?.batteryPower || 0) < 0 ? 'Discharging' : 'Idle'}`}
        />
        <StatCard
          icon={Home} label="Load" value={loadKw} unit="kW"
          color="var(--load)"
          sub="Current consumption"
        />
        <StatCard
          icon={TrendingUp} label="Total Energy" value={totalEnergy} unit="kWh"
          color="var(--solar)"
          sub="Lifetime production"
        />
      </div>

      {/* Flow diagram + Chart */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 20 }}>

        {latest && <FlowDiagram data={latest} />}

        {/* Chart card */}
        <div className="card" style={{ gridColumn: 'span 2' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Energy Production
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['day', 'month'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} style={{
                  padding: '4px 10px', borderRadius: 6, fontSize: '11px', cursor: 'pointer',
                  background: tab === t ? 'var(--solar)' : 'var(--surface2)',
                  color: tab === t ? '#000' : 'var(--text-muted)',
                  border: '1px solid ' + (tab === t ? 'var(--solar)' : 'var(--border)'),
                  fontFamily: 'var(--font-body)', textTransform: 'uppercase', letterSpacing: '0.05em'
                }}>
                  {t === 'day' ? <><BarChart2 size={10} style={{ display: 'inline', marginRight: 3 }} />Today</> : <><Calendar size={10} style={{ display: 'inline', marginRight: 3 }} />Month</>}
                </button>
              ))}
            </div>
          </div>

          {tab === 'day' ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={dayData} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="solarGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--solar)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--solar)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="time" stroke="var(--text-dim)" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis stroke="var(--text-dim)" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="generationPower" name="Solar (W)"
                  stroke="var(--solar)" fill="url(#solarGrad)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="loadPower" name="Load (W)"
                  stroke="var(--load)" fill="none" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthData} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" stroke="var(--text-dim)" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis stroke="var(--text-dim)" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="energy" name="Energy (kWh)" fill="var(--solar)" radius={[4, 4, 0, 0]} opacity={0.9} />
              </BarChart>
            </ResponsiveContainer>
          )}

          {(tab === 'day' ? dayData : monthData).length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
              No data available for this period
            </div>
          )}
        </div>
      </div>

      {/* Raw data debug (collapsible) */}
      {latest && (
        <details className="card" style={{ marginTop: 0 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Raw API Data ▸
          </summary>
          <pre style={{
            marginTop: 12, color: 'var(--solar)', fontSize: '11px', overflowX: 'auto',
            background: 'var(--surface2)', borderRadius: 8, padding: 12
          }}>
            {JSON.stringify(latest, null, 2)}
          </pre>
        </details>
      )}

      {/* Footer */}
      <div style={{ textAlign: 'center', marginTop: 24, color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '0.1em' }}>
        AUTO REFRESH 60s · DEYE CLOUD API v1.0 · DATA MAY BE DELAYED
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        select option { background: #0d1520; }
      `}</style>
    </div>
  )
}
