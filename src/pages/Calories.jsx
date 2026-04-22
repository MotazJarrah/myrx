import { useState } from 'react'
import { estimateCalories } from '../lib/formulas'

const ACTIVITIES = [
  { label: 'Weight training (general)', met: 3.5 },
  { label: 'Weight training (vigorous)', met: 6.0 },
  { label: 'Running (6 mph)', met: 9.8 },
  { label: 'Running (8 mph)', met: 11.8 },
  { label: 'Cycling (moderate)', met: 8.0 },
  { label: 'Cycling (vigorous)', met: 10.0 },
  { label: 'Rowing (moderate)', met: 7.0 },
  { label: 'Walking (3.5 mph)', met: 3.5 },
  { label: 'Burpees', met: 8.0 },
]

export default function Calories() {
  const [activity, setActivity] = useState(ACTIVITIES[0])
  const [bodyweight, setBodyweight] = useState('')
  const [duration, setDuration] = useState('')
  const [unit, setUnit] = useState('lb')
  const [result, setResult] = useState(null)

  function calculate() {
    if (!bodyweight || !duration) return
    const kg = unit === 'lb' ? Number(bodyweight) / 2.205 : Number(bodyweight)
    setResult(estimateCalories(activity.met, kg, Number(duration)))
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 pb-24 md:pb-8">
      <h1 className="text-2xl font-bold text-white mb-1">Calorie Lab</h1>
      <p className="text-gray-400 text-sm mb-8">Estimate calories burned based on activity and duration.</p>

      <div className="bg-[#111211] border border-[#1e201e] rounded-2xl p-5 flex flex-col gap-4 mb-6">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm text-gray-400">Activity</label>
          <select
            value={activity.label}
            onChange={e => setActivity(ACTIVITIES.find(a => a.label === e.target.value))}
            className="bg-[#0a0b0a] border border-[#1e201e] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-[#c4f031]/50"
          >
            {ACTIVITIES.map(a => <option key={a.label}>{a.label}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-1 flex flex-col gap-1.5">
            <label className="text-sm text-gray-400">Bodyweight</label>
            <input
              type="number"
              value={bodyweight}
              onChange={e => setBodyweight(e.target.value)}
              placeholder="185"
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
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-gray-400">Duration (min)</label>
            <input
              type="number"
              value={duration}
              onChange={e => setDuration(e.target.value)}
              placeholder="45"
              className="bg-[#0a0b0a] border border-[#1e201e] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-[#c4f031]/50"
            />
          </div>
        </div>

        <button
          onClick={calculate}
          className="bg-[#c4f031] text-black font-semibold py-2.5 rounded-lg hover:bg-[#d4ff41] transition-colors"
        >
          Estimate calories
        </button>
      </div>

      {result !== null && (
        <div className="bg-[#111211] border border-[#1e201e] rounded-2xl p-6 text-center">
          <div className="text-6xl font-bold font-mono text-[#c4f031] mb-2">{result}</div>
          <div className="text-gray-400 text-sm">estimated calories burned</div>
          <div className="text-xs text-gray-600 mt-2">{activity.label} · {duration} min · {bodyweight} {unit}</div>
        </div>
      )}
    </div>
  )
}
