/**
 * BodyCompPicker — web port of mobile/src/components/BodyCompPicker.tsx.
 *
 * 3-band body-fat self-report via gender-aware silhouettes. Output is a
 * BodyFatBand string ('lean' | 'average' | 'high') persisted on
 * profiles.body_fat_band.
 *
 * Kept in LOCKSTEP with the mobile bands (label / range / description) — the
 * source of truth is mobile BODY_FAT_BAND_INFO in src/lib/planPresets.ts.
 * Male and female BF% scales differ by ~7 points; non-binary / null all use
 * the female ("else") set, per the uniform "male / else = female" rule.
 *
 * Silhouette PNGs live in web/public/ (copied from mobile/assets/bodycomp/);
 * tinted to the lime primary on select via CSS filter.
 *
 * Props:
 *   value, onChange, gender    — selection + handler + gender bucket
 *   showFootnote (default true) — show the "change later from Profile →
 *                                 Preferences → Body stats" line. Pass false
 *                                 when this picker IS the settings editor.
 *   compact (web-only)          — shrinks the silhouettes for the dense
 *                                 macro-plan form; also hides the subtitle /
 *                                 per-card description / footnote so the
 *                                 wizard layout stays tight.
 */

const MALE_BANDS = [
  { id: 'lean',    label: 'Lean',    range: '≤14% BF',  desc: 'Visible muscle definition, flat / cut midsection',    src: '/male-lean.png'    },
  { id: 'average', label: 'Average', range: '15–24% BF', desc: 'Soft midsection, no visible abs, normal proportions', src: '/male-average.png' },
  { id: 'high',    label: 'High',    range: '≥25% BF',  desc: 'Visible central adiposity, rounded waist',            src: '/male-high.png'    },
]

const FEMALE_BANDS = [
  { id: 'lean',    label: 'Lean',    range: '≤20% BF',  desc: 'Athletic, visible muscle tone',           src: '/female-lean.png'    },
  { id: 'average', label: 'Average', range: '21–30% BF', desc: 'Healthy normal, no visible abs',           src: '/female-average.png' },
  { id: 'high',    label: 'High',    range: '≥31% BF',  desc: 'Visible central adiposity, rounded shape', src: '/female-high.png'    },
]

export default function BodyCompPicker({ value, onChange, gender, showFootnote = true, compact = false }) {
  const bands = gender === 'male' ? MALE_BANDS : FEMALE_BANDS

  const imgCls   = compact ? 'h-16 w-auto' : 'h-32 w-auto'
  const cardCls  = compact ? 'py-2.5 px-2 gap-1' : 'py-4 px-3 gap-1'
  const labelCls = compact ? 'text-xs' : 'text-sm'

  return (
    <div className="space-y-3">
      {!compact && (
        <p className="text-[13px] text-muted-foreground leading-snug">
          Pick the silhouette that most closely matches your current body.
        </p>
      )}

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
              <p className={`${labelCls} font-semibold ${selected ? 'text-primary' : 'text-foreground'}`}>{band.label}</p>
              <p className="text-[10px] text-muted-foreground font-mono tabular-nums">{band.range}</p>
              {!compact && (
                <p className="text-[10px] text-muted-foreground text-center leading-tight mt-1">{band.desc}</p>
              )}
            </button>
          )
        })}
      </div>

      {showFootnote && !compact && (
        <p className="text-[11px] text-muted-foreground/70 text-center leading-relaxed">
          You can change this later from Profile → Preferences → Body stats.
        </p>
      )}
    </div>
  )
}
