/**
 * BodyCompPicker — web port of mobile/src/components/BodyCompPicker.tsx.
 *
 * 3-band body fat self-report via gender-aware silhouettes. Output is a
 * BodyFatBand string ('lean' | 'average' | 'high') persisted on
 * profiles.body_fat_band.
 *
 * Silhouette PNGs were copied from mobile/assets/bodycomp/ to
 * web/public/ on May 25 2026 — same files served, same proportions.
 * tintColor here is achieved via CSS mask-image (white silhouette
 * tinted to the lime primary on hover/select).
 *
 * Gender rule (matches mobile): only `gender === 'male'` shows the
 * male silhouettes; everyone else (`female`, `non-binary`, null) sees
 * the female set. Keeps the BMR / TDEE consistent — per the locked
 * "male / else=female" rule across all calc surfaces.
 */

const FEMALE_BANDS = [
  { id: 'lean',    label: 'Lean',    sub: '≤ 20%', src: '/female-lean.png'    },
  { id: 'average', label: 'Average', sub: '20–30%', src: '/female-average.png' },
  { id: 'high',    label: 'High',    sub: '> 30%', src: '/female-high.png'    },
]

const MALE_BANDS = [
  { id: 'lean',    label: 'Lean',    sub: '≤ 12%', src: '/male-lean.png'    },
  { id: 'average', label: 'Average', sub: '12–22%', src: '/male-average.png' },
  { id: 'high',    label: 'High',    sub: '> 22%', src: '/male-high.png'    },
]

export default function BodyCompPicker({ value, onChange, gender, footnote, compact = false }) {
  const bands = gender === 'male' ? MALE_BANDS : FEMALE_BANDS

  // Compact mode (used inside the macro-plan editor form) shrinks the
  // silhouettes from 128px → 64px and drops the padding so the picker
  // doesn't dominate the form. Standalone mode (Preferences page,
  // dedicated body-comp surfaces) keeps the original large display.
  const imgCls = compact ? 'h-16 w-auto' : 'h-32 w-auto'
  const cardCls = compact ? 'py-2.5 px-2 gap-1.5' : 'py-4 px-3 gap-2'
  const labelCls = compact ? 'text-xs' : 'text-sm'

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {bands.map(band => {
          const selected = value === band.id
          return (
            <button
              key={band.id}
              type="button"
              onClick={() => onChange(band.id)}
              className={`flex flex-col items-center rounded-xl border transition-all duration-200 ${cardCls} ${
                selected
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-card/40 hover:bg-accent/40 hover:border-border'
              }`}
            >
              <img
                src={band.src}
                alt={band.label}
                className={`select-none ${imgCls} ${selected ? 'opacity-100' : 'opacity-60'}`}
                style={{
                  filter: selected
                    ? 'brightness(0) saturate(100%) invert(82%) sepia(96%) saturate(467%) hue-rotate(28deg) brightness(108%) contrast(94%)'
                    : 'brightness(0) saturate(100%) invert(60%)',
                }}
                draggable={false}
              />
              <div className="text-center">
                <p className={`${labelCls} font-semibold ${selected ? 'text-primary' : 'text-foreground'}`}>{band.label}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{band.sub}</p>
              </div>
            </button>
          )
        })}
      </div>
      {footnote && (
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{footnote}</p>
      )}
    </div>
  )
}
