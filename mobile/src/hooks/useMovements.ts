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
  unit_lock?: 'kg' | 'lb' | null
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
}

let _cache: Movement[] | null = null
const _listeners = new Set<(data: Movement[]) => void>()

function _notify(data: Movement[]): void {
  _cache = data
  _listeners.forEach(fn => fn(data))
}

/** Call after adding/deleting a movement to force a fresh fetch on next use */
export function invalidateMovements(): void {
  _cache = null
  supabase
    .from('movements')
    .select('*')
    .order('name')
    .then(({ data }) => _notify((data as Movement[]) ?? []))
}

export function useMovements(): Movement[] {
  const [movements, setMovements] = useState<Movement[]>(_cache ?? [])

  useEffect(() => {
    _listeners.add(setMovements)

    if (_cache === null) {
      supabase
        .from('movements')
        .select('*')
        .order('name')
        .then(({ data }) => _notify((data as Movement[]) ?? []))
    } else {
      setMovements(_cache)
    }

    return () => { _listeners.delete(setMovements) }
  }, [])

  return movements
}
