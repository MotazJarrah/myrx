import { useState } from 'react'
import { estimateCalories } from '../lib/formulas'
import { Flame } from 'lucide-react'

const ACTIVITIES = [
  { label: 'Weight training (general)',  met: 3.5 },
  { label: 'Weight training (vigorous)', met: 6.0 },
  { label: 'Running (6 mph)',            met: 9.8 },
  { label: 'Running (8 mph)',            met: 11.8 },
  { label: 'Cycling (moderate)',         met: 8.0 },
  { label: 'Cycling (vigorous)',         met: 10.0 },
  { label: 'Rowing (moderate)',          met: 7.0 },
  { label: 'Walking (3.5 mph)',          met: 3.5 },
  { label: 'Burpees',                    met: 8.0 },
]

const inputCls = 'w-full rounded-md border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring transition-colors'
const labelCls = 'text-sm text-muted-foreground'

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
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Calorie Lab</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Estimate calories burned based on activity and duration.</p>
      </div>

      <div className="animate-rise rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>Activity</label>
          <select
            value={activity.label}
            onChange={e => setActivity(ACTIVITIES.find(a => a.label === e.target.value))}
            className={inputCls}
          >
            {ACTIVITIES.map(a => <option key={a.label}>{a.label}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-1 flex flex-col gap-1.5">
            <label className={labelCls}>Bodyweight</label>
            <input
              type="number" value={bodyweight} onChange={e => setBodyweight(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={labelCls}>Unit</label>
            <select value={unit} onChange={e => setUnit(e.target.value)} className={inputCls}>
              <option>lb</option>
              <option>kg</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={labelCls}>Duration (min)</label>
            <input
              type="number" value={duration} onChange={e => setDuration(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <button
          onClick={calculate}
          className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
        >
          Estimate calories
        </button>
      </div>

      {result !== null && (
        <div className="animate-rise rounded-xl border border-border bg-card p-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Flame className="h-5 w-5 text-primary" />
          </div>
          <div className="text-6xl font-bold font-mono tabular-nums text-primary mb-2">{result}</div>
          <div className="text-sm text-muted-foreground">estimated calories burned</div>
          <div className="mt-2 text-xs text-muted-foreground/60">{activity.label} · {duration} min · {bodyweight} {unit}</div>
        </div>
      )}
    </div>
  )
}
