import { Check } from 'lucide-react'
import { passwordRequirements } from '../lib/passwordRules'

const RULES = [
  { key: 'length', label: 'At least 8 characters' },
  { key: 'upper',  label: '1 uppercase letter' },
  { key: 'number', label: '1 number' },
  { key: 'symbol', label: '1 symbol' },
]

/**
 * Hard-requirement checklist beneath a password input. Each row turns
 * green once its rule is met; the form keeps its submit disabled until
 * passwordMeetsRequirements(password) is true. Mirrors mobile's
 * PasswordRequirements (PasswordStrengthMeter.tsx).
 */
export function PasswordRequirements({ password = '' }) {
  const r = passwordRequirements(password)
  return (
    <ul className="space-y-1 pt-1">
      {RULES.map(({ key, label }) => {
        const ok = r[key]
        return (
          <li key={key} className="flex items-center gap-2 text-xs">
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors ${
                ok ? 'bg-primary/20 text-primary' : 'bg-muted text-transparent'
              }`}
            >
              <Check className="h-2.5 w-2.5" strokeWidth={3} />
            </span>
            <span className={ok ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
          </li>
        )
      })}
    </ul>
  )
}
