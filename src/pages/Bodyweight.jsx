import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const inputCls = 'w-full rounded-md border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring transition-colors'
const labelCls = 'text-sm text-muted-foreground'

export default function Bodyweight() {
  const { user, profile } = useAuth()
  const [weight, setWeight] = useState('')
  const [unit, setUnit] = useState(profile?.weight_unit || 'lb')
  const [logs, setLogs] = useState([])

  // Profile loads async — re-sync unit once it's available
  useEffect(() => { if (profile?.weight_unit) setUnit(profile.weight_unit) }, [profile?.weight_unit])

  useEffect(() => {
    if (!user) return
    supabase
      .from('bodyweight')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .then(({ data }) => setLogs(data || []))
  }, [user])

  async function logWeight() {
    if (!weight || !user) return
    const { data } = await supabase
      .from('bodyweight')
      .insert({ user_id: user.id, weight: Number(weight), unit })
      .select()
    if (data) setLogs(prev => [...prev, data[0]])
    setWeight('')
  }

  const chartData = logs.map(l => ({
    date: new Date(l.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    weight: l.weight,
  }))

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Bodyweight</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Track your weight over time.</p>
      </div>

      <div className="animate-rise rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 flex flex-col gap-1.5">
            <label className={labelCls}>Weight</label>
            <input
              type="number" value={weight} onChange={e => setWeight(e.target.value)}
              step="0.1" className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={labelCls}>Unit</label>
            <select value={unit} onChange={e => setUnit(e.target.value)} className={inputCls}>
              <option>lb</option>
              <option>kg</option>
            </select>
          </div>
        </div>
        <button
          onClick={logWeight}
          className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
        >
          Log weight
        </button>
      </div>

      {logs.length > 1 && (
        <div className="animate-rise rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Progress</h2>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData}>
              <XAxis dataKey="date" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 8,
                  color: 'hsl(var(--foreground))',
                  fontSize: 12,
                }}
              />
              <Line type="monotone" dataKey="weight" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {logs.length > 0 && (
        <div className="animate-rise rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-3">Log</h2>
          <div className="divide-y divide-border">
            {[...logs].reverse().slice(0, 10).map(l => (
              <div key={l.id} className="flex justify-between py-2.5 text-sm">
                <span className="text-muted-foreground">{new Date(l.created_at).toLocaleDateString()}</span>
                <span className="font-mono tabular-nums">{l.weight} {l.unit}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
