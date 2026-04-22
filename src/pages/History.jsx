import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

export default function History() {
  const { user } = useAuth()
  const [efforts, setEfforts] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    if (!user) return
    supabase
      .from('efforts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setEfforts(data || [])
        setLoading(false)
      })
  }, [user])

  const filtered = filter === 'all' ? efforts : efforts.filter(e => e.type === filter)

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 pb-24 md:pb-8">
      <h1 className="text-2xl font-bold text-white mb-1">History</h1>
      <p className="text-gray-400 text-sm mb-6">Every effort you've logged.</p>

      <div className="flex gap-2 mb-6">
        {['all', 'strength', 'cardio'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm capitalize transition-colors
              ${filter === f ? 'bg-[#c4f031] text-black font-semibold' : 'bg-[#111211] border border-[#1e201e] text-gray-400 hover:text-white'}`}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm text-center py-12">Loading your history…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-[#111211] border border-[#1e201e] rounded-xl p-8 text-center text-gray-500 text-sm">
          No efforts logged yet.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map(e => (
            <div key={e.id} className="bg-[#111211] border border-[#1e201e] rounded-xl px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-white">{e.label}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${e.type === 'strength' ? 'bg-blue-500/10 text-blue-400' : 'bg-orange-500/10 text-orange-400'}`}>
                    {e.type}
                  </span>
                  <span className="text-xs text-gray-500">{new Date(e.created_at).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="text-sm font-mono text-[#c4f031]">{e.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
