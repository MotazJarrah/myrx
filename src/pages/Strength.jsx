import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { projectAllRMs } from '../lib/formulas'

const EXERCISES = [
  'Bench Press', 'Back Squat', 'Front Squat', 'Deadlift',
  'Barbell Row', 'Incline Bench', 'Hip Thrust', 'Chin-ups',
  'Overhead Press', 'Dumbbell Press',
]

export default function Strength() {
  const { user } = useAuth()
  const [exercise, setExercise] = useState('Bench Press')
  const [weight, setWeight] = useState('')
  const [reps, setReps] = useState('')
  const [unit, setUnit] = useState('lb')
  const [projections, setProjections] = useState(null)
  const [saved, setSaved] = useState(false)

  function calculate() {
    if (!weight || !reps) return
    setProjections(projectAllRMs(Number(weight), Number(reps)))
    setSaved(false)
  }

  async function saveEffort() {
    if (!projections || !user) return
    const oneRM = projections[0].weight
    await supabase.from('efforts').insert({
      user_id: user.id,
      type: 'strength',
      label: `${exercise} · ${weight} ${unit} × ${reps}`,
      value: `Est. 1RM ${oneRM} ${unit}`,
    })
    setSaved(true)
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 pb-24 md:pb-8">
      <h1 className="text-2xl font-bold text-white mb-1">Strength</h1>
      <p className="text-gray-400 text-sm mb-8">Enter any set to project 1RM through 10RM.</p>

      <div className="bg-[#111211] border border-[#1e201e] rounded-2xl p-5 flex flex-col gap-4 mb-6">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm text-gray-400">Exercise</label>
          <select
            value={exercise}
            onChange={e => setExercise(e.target.value)}
            className="bg-[#0a0b0a] border border-[#1e201e] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-[#c4f031]/50"
          >
            {EXERCISES.map(ex => <option key={ex}>{ex}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-1 flex flex-col gap-1.5">
            <label className="text-sm text-gray-400">Weight</label>
            <input
              type="number"
              value={weight}
              onChange={e => setWeight(e.target.value)}
              placeholder="225"
              className="bg-[#0a0b0a] border border-[#1e201e] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-[#c4f031]/50"
            />
          </div>
          <div className="col-span-1 flex flex-col gap-1.5">
            <label className="text-sm text-gray-400">Reps</label>
            <input
              type="number"
              value={reps}
              onChange={e => setReps(e.target.value)}
              placeholder="5"
              min="1"
              max="30"
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
          onClick={calculate}
          className="bg-[#c4f031] text-black font-semibold py-2.5 rounded-lg hover:bg-[#d4ff41] transition-colors"
        >
          Calculate
        </button>
      </div>

      {projections && (
        <div className="bg-[#111211] border border-[#1e201e] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-white">{exercise} · {weight} {unit} × {reps}</span>
            <span className="text-xs bg-[#c4f031]/10 text-[#c4f031] border border-[#c4f031]/20 px-2 py-1 rounded">
              Est. 1RM {projections[0].weight} {unit}
            </span>
          </div>

          <div className="grid grid-cols-5 gap-2 mb-4">
            {projections.map(({ reps: r, weight: w }) => {
              const isInput = r === Number(reps)
              return (
                <div key={r} className={`rounded-lg p-2 text-center ${isInput ? 'bg-[#c4f031]/10 border border-[#c4f031]/30' : 'bg-[#0a0b0a]'}`}>
                  <div className={`text-xs mb-1 ${isInput ? 'text-[#c4f031]' : 'text-gray-500'}`}>{r}RM</div>
                  <div className={`text-sm font-semibold font-mono ${isInput ? 'text-[#c4f031]' : 'text-white'}`}>{w}</div>
                </div>
              )
            })}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Epley · Brzycki · Lombardi averaged</span>
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
