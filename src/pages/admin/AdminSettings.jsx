/**
 * Admin display preferences — stored in localStorage only (UI prefs, not DB)
 */
import { useState } from 'react'
import { Check, Settings } from 'lucide-react'

const PREF_WEIGHT = 'admin-pref-weight-unit'
const PREF_HEIGHT = 'admin-pref-height-unit'

function UnitCard({ selected, onClick, label, sub }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border py-3 px-4 text-left transition-all duration-200 ${
        selected
          ? 'border-primary bg-primary/10'
          : 'border-border bg-card/40 hover:bg-accent/40'
      }`}
    >
      <div className={`text-sm font-semibold ${selected ? 'text-primary' : 'text-foreground'}`}>{label}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
    </button>
  )
}

export function getAdminWeightUnit() {
  return localStorage.getItem(PREF_WEIGHT) || 'lb'
}

export function getAdminHeightUnit() {
  return localStorage.getItem(PREF_HEIGHT) || 'imperial'
}

export default function AdminSettings() {
  const [weightUnit, setWeightUnit] = useState(() => getAdminWeightUnit())
  const [heightUnit, setHeightUnit] = useState(() => getAdminHeightUnit())
  const [saved,      setSaved]      = useState(false)

  function handleSave(e) {
    e.preventDefault()
    localStorage.setItem(PREF_WEIGHT, weightUnit)
    localStorage.setItem(PREF_HEIGHT, heightUnit)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Your display preferences — only affect how you see data in this panel.</p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">

        {/* Weight display unit */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold">Display units</p>
          </div>

          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Weight</p>
            <div className="grid grid-cols-2 gap-2">
              <UnitCard
                selected={weightUnit === 'lb'}
                onClick={() => setWeightUnit('lb')}
                label="lb"
                sub="Pounds (imperial)"
              />
              <UnitCard
                selected={weightUnit === 'kg'}
                onClick={() => setWeightUnit('kg')}
                label="kg"
                sub="Kilograms (metric)"
              />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Height</p>
            <div className="grid grid-cols-2 gap-2">
              <UnitCard
                selected={heightUnit === 'imperial'}
                onClick={() => setHeightUnit('imperial')}
                label="ft & in"
                sub="Feet & inches"
              />
              <UnitCard
                selected={heightUnit === 'metric'}
                onClick={() => setHeightUnit('metric')}
                label="cm"
                sub="Centimetres"
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
        >
          {saved ? <><Check className="h-4 w-4" /> Saved</> : 'Save preferences'}
        </button>
      </form>
    </div>
  )
}
