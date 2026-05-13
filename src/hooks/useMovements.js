import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// Module-level cache + listener set so all hook instances share a single fetch
let _cache = null
const _listeners = new Set()

function _notify(data) {
  _cache = data
  _listeners.forEach(fn => fn(data))
}

/** Call after adding/deleting a movement to force a fresh fetch on next use */
export function invalidateMovements() {
  _cache = null
  // Re-fetch immediately so any mounted components get fresh data
  supabase
    .from('movements')
    .select('*')
    .order('name')
    .then(({ data }) => _notify(data || []))
}

export function useMovements() {
  const [movements, setMovements] = useState(_cache || [])

  useEffect(() => {
    _listeners.add(setMovements)

    // Only hit the DB if no cached data yet
    if (_cache === null) {
      supabase
        .from('movements')
        .select('*')
        .order('name')
        .then(({ data }) => _notify(data || []))
    } else {
      // Already cached — make sure this instance has the latest
      setMovements(_cache)
    }

    return () => { _listeners.delete(setMovements) }
  }, [])

  return movements
}
