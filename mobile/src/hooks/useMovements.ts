/**
 * Direct port of MyRX/src/hooks/useMovements.js to TypeScript.
 *
 * Module-level cache + listener set so all hook instances share a single
 * Supabase fetch. The first mount triggers the fetch; later mounts read
 * the cache instantly.
 */

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export interface Movement {
  id: string
  name: string
  category: 'strength' | 'cardio' | 'mobility' | string
  strength_type?: 'isometric' | 'compound' | 'isolation' | string | null
  equipment?: 'barbell' | 'dumbbell' | 'kettlebell' | 'bodyweight' | 'machine' | 'assisted' | 'carry' | string | null
  band_assist?: boolean | null
  knee_assist?: boolean | null
  cardio_mode?: 'pace' | 'duration' | string | null
  /**
   * When set, the client must force this unit for both logging and display,
   * regardless of the user's profile preference. Used to lock strongman / Olympic
   * carry-flavoured movements to kg worldwide so the data stays consistent
   * across users with mixed-unit gym backgrounds.
   */
  /**
   * Locks the unit for this movement, overriding the user's profile
   * preference. 'kg' / 'lb' for weight (strongman events use kg universally;
   * see Atlas Stone, Husafell, etc.). 'mi' / 'km' for distance — currently
   * only Rucking is locked to 'mi' because the rucking community
   * (GoRuck, US tactical fitness) uses miles exclusively (canonical
   * 12-mile ruck benchmark).
   *
   * Honored by both the log form (toggle hidden, locked unit displayed
   * as a static chip in its place) and the detail page (best subtitle,
   * hero card, log list — all force the locked unit regardless of profile).
   *
   * DB CHECK constraint enforces the allowed values. See migration
   * `widen_movements_unit_lock_check` (May 2026).
   */
  unit_lock?: 'kg' | 'lb' | 'mi' | 'km' | null
  /**
   * True when this bodyweight movement progresses by attaching external load
   * (belt / vest) after the user crosses the 10-rep threshold — Pull Up, Dip,
   * Push Up family, etc. False (default) for movements that progress purely by
   * rep count — Burpee, Sit Up, Mountain Climber, etc. — which use the new
   * three-stage rep-only milestone system instead of weighted projections.
   *
   * Admin-managed: the column is `NOT NULL DEFAULT false` server-side, so any
   * new movement added via the admin panel starts as rep-only and must be
   * explicitly flagged for weighted progression.
   */
  weighted_progression?: boolean

  /** True for kettlebell movements requiring a pair (Double KB Clean, etc.). */
  uses_pair?: boolean

  /** Required rep window for rep-based strength moves. Drives the next-target
   *  card's zone classification. NULL for isometric / carry / cardio. */
  rep_range_lo?: number | null
  rep_range_hi?: number | null

  /** Per-movement weight ladder override. JSONB — either number[] (single-unit)
   *  or { lb: number[], kg: number[] } (per-unit ladders). NULL means use the
   *  equipment's default ladder. Set by admin via the Movement Library form. */
  weight_ladder_override?: number[] | { lb?: number[]; kg?: number[] } | null

  /** Per-movement isometric milestone ladder override (seconds). NULL means
   *  use the standard 10/20/30/…/120 s ladder. Added May 20 2026 — admin can
   *  set, mobile reads but doesn't honour yet (Iso detail page is locked). */
  isometric_ladder_override?: number[] | null

  /** Soft-delete flag. When true, the movement is hidden from client search
   *  lists but the row stays intact so historical effort labels keep their
   *  bindings (unit_lock, equipment, etc.). Added May 20 2026. */
  deprecated?: boolean

  /** Auto-updated timestamp — bumped on any row change via the
   *  `movements_set_updated_at` trigger. Surfaced in the admin list as
   *  "Modified N ago". Added May 20 2026. */
  updated_at?: string

  /** Original creation timestamp. Surfaced in the admin list when sorting by
   *  "Recently added" / "Oldest added". */
  created_at?: string

  /** FK to the parent row for variant rows (e.g. "Swimming [Freestyle]" →
   *  the "Swimming" parent). NULL for standalone movements + parent rows
   *  themselves. The strength + cardio index uses this (combined with
   *  `variant_short_label`) to collapse a family into a single row showing
   *  the parent's name + a small badge for the most-recently-logged variant.
   */
  parent_movement_id?: string | null

  /** Short label (max 10 chars) shown as the small badge on the mobile
   *  index next to the parent's display name when this variant was the
   *  most-recently-logged effort for the family. Examples:
   *    - Swimming [Freestyle]    → "FREE"
   *    - Swimming [Backstroke]   → "BACK"
   *    - Sled Work [Push]        → "PUSH"
   *    - Sled Work [Drag]        → "DRAG"
   *  NULL for non-variant rows. Set by admin in the Movement Library form.
   *  Mirrors the hardcoded `SWIM_STROKE_LABELS[s].short` lookup used by the
   *  hardcoded Swimming/Sled Work code paths.
   */
  variant_short_label?: string | null
}

let _cache: Movement[] | null = null
let _realtimeChannel: ReturnType<typeof supabase.channel> | null = null
const _listeners = new Set<(data: Movement[]) => void>()

function _notify(data: Movement[]): void {
  _cache = data
  _listeners.forEach(fn => fn(data))
}

function _refetch(): void {
  supabase
    .from('movements')
    .select('*')
    .order('name')
    .then(({ data }) => _notify((data as Movement[]) ?? []))
}

/**
 * Open the realtime channel on the `movements` table once per JS context.
 * Any INSERT / UPDATE / DELETE the admin performs on web triggers a refetch
 * on every running mobile client — no app restart needed.
 *
 * Realtime is enabled at the table level via the
 * `add_movements_to_realtime_publication` migration. Without that, postgres
 * change-data-capture never fires and this channel is a no-op.
 */
function _ensureRealtimeSubscription(): void {
  if (_realtimeChannel) return
  _realtimeChannel = supabase
    .channel('movements-catalog-changes')
    .on(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'postgres_changes' as any,
      { event: '*', schema: 'public', table: 'movements' },
      () => { _refetch() },
    )
    .subscribe()
}

/** Call after adding/deleting a movement to force a fresh fetch on next use */
export function invalidateMovements(): void {
  _cache = null
  _refetch()
}

export function useMovements(): Movement[] {
  const [movements, setMovements] = useState<Movement[]>(_cache ?? [])

  useEffect(() => {
    _listeners.add(setMovements)
    _ensureRealtimeSubscription()

    if (_cache === null) {
      _refetch()
    } else {
      setMovements(_cache)
    }

    return () => { _listeners.delete(setMovements) }
  }, [])

  return movements
}
