import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

export default function Bodyweight() {
  const { user } = useAuth()
  const [weight, setWeight] = useState('')
  const [unit, setUnit] = useState('lb')
  const [logs, setLogs] = useState([])

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
    const { data } = await supabase.from('bodyweight').insert({
      user_id: user.id,
      weight: Number(weight),
      unit,
    }).select()
    if (data) setLogs(prev => [...prev, data[0]])
    setWeight('')
  }

  const chartData = logs.map(l => ({
    date: new Date(l.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    weight: l.weight,
  }))

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 pb-24 md:pb-8">
      <h1 className="text-2xl font-bold text-white mb-1">Bodyweight</h1>
      <p className="text-gray-400 text-sm mb-8">Track your weight over time.</p>

      <div className="bg-[#111211] border border-[#1e201e] rounded-2xl p-5 flex flex-col gap-4 mb-6">
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 flex flex-col gap-1.5">
            <label className="text-sm text-gray-400">Weight</label>
            <input
              type="number"
              value={weight}
              onChange={e => setWeight(e.target.value)}
              placeholder="185"
              step="0.1"
              className="bg-[#0a0b0a] border border-[#1e201e] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-[#c4f031]/50"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-gray-400">Unit</label>
            <select
              value={unit}
              onChange={e => setUnit(e.target.value)}
              className="bg-[#0a0b0a] border border-[#1e201e] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-[#c4f031]/50"
            >
              <option>lb</option>
              <option>kg</option>
            </select>
          </div>
        </div>
        <button
          onClick={logWeight}
          className="bg-[#c4f031] text-black font-semibold py-2.5 rounded-lg hover:bg-[#d4ff41] transition-colors"
        >
          Log weight
        </button>
      </div>

      {logs.length > 1 && (
        <div className="bg-[#111211] border border-[#1e201e] rounded-2xl p-5 mb-6">
          <h2 className="text-sm font-medium text-white mb-4">Progress</h2>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData}>
              <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
              <Tooltip contentStyle={{ background: '#111211', border: '1px solid #1e201e', borderRadius: 8, color: '#fff' }} />
              <Line type="monotone" dataKey="weight" stroke="#c4f031" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {logs.length > 0 && (
        <div className="bg-[#111211] border border-[#1e201e] rounded-2xl p-5">
          <h2 className="text-sm font-medium text-white mb-3">Log</h2>
          <div className="flex flex-col gap-2">
            {[...logs].reverse().slice(0, 10).map(l => (
              <div key={l.id} className="flex justify-between text-sm">
                <span className="text-gray-400">{new Date(l.created_at).toLocaleDateString()}</span>
                <span className="font-mono text-white">{l.weight} {l.unit}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
