import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { projectPaces } from '../lib/formulas'

export default function Cardio() {
  const { user } = useAuth()
  const [distanceKm, setDistanceKm] = useState('')
  const [minutes, setMinutes] = useState('')
  const [activity, setActivity] = useState('Running')
  const [projections, setProjections] = useState(null)
  const [saved, setSaved] = useState(false)

  function calculate() {
    if (!distanceKm || !minutes) return
    setProjections(projectPaces(Number(distanceKm), Number(minutes)))
    setSaved(false)
  }

  async function saveEffort() {
    if (!projections || !user) return
    await supabase.from('efforts').insert({
      user_id: user.id,
      type: 'cardio',
      label: `${activity} · ${distanceKm} km in ${minutes} min`,
      value: projections[1]?.pace ?? '',
    })
    setSaved(true)
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 pb-24 md:pb-8">
      <h1 className="text-2xl font-bold text-white mb-1">Cardio</h1>
      <p className="text-gray-400 text-sm mb-8">Enter a distance and time to see pace projections.</p>

      <div className="bg-[#111211] border border-[#1e201e] rounded-2xl p-5 flex flex-col gap-4 mb-6">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm text-gray-400">Activity</label>
          <select
            value={activity}
            onChange={e => setActivity(e.target.value)}
            className="bg-[#0a0b0a] border border-[#1e201e] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-[#c4f031]/50"
          >
            <option>Running</option>
            <option>Cycling</option>
            <option>Rowing</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-gray-400">Distance (km)</label>
            <input
              type="number"
              value={distanceKm}
              onChange={e => setDistanceKm(e.target.value)}
              placeholder="5"
              step="0.1"
              className="bg-[#0a0b0a] border border-[#1e201e] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-[#c4f031]/50"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-gray-400">Time (minutes)</label>
            <input
              type="number"
              value={minutes}
              onChange={e => setMinutes(e.target.value)}
              placeholder="25"
              className="bg-[#0a0b0a] border border-[#1e201e] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-[#c4f031]/50"
            />
          </div>
        </div>

        <button
          onClick={calculate}
          className="bg-[#c4f031] text-black font-semibold py-2.5 rounded-lg hover:bg-[#d4ff41] transition-colors"
        >
          Project paces
        </button>
      </div>

      {projections && (
        <div className="bg-[#111211] border border-[#1e201e] rounded-2xl p-5">
          <div className="text-sm font-medium text-white mb-4">
            {activity} · {distanceKm} km in {minutes} min
          </div>
          <div className="flex flex-col gap-2">
            {projections.map(({ name, time, pace }) => (
              <div key={name} className="flex items-center justify-between bg-[#0a0b0a] rounded-lg px-4 py-3">
                <span className="text-sm text-gray-300">{name}</span>
                <div className="text-right">
                  <div className="text-sm font-mono text-white">{time}</div>
                  <div className="text-xs font-mono text-[#c4f031]">{pace}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end mt-4">
            <button
              onClick={saveEffort}
              disabled={saved}
              className="text-xs bg-[#1e201e] hover:bg-[#2a2c2a] text-white px-3 py-1.5 rounded-lg transition-colors disabled:text-[#c4f031]"
            >
              {saved ? '✓ Saved' : 'Log this effort'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
