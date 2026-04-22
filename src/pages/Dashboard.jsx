import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Dumbbell, Activity, Weight, Flame } from 'lucide-react'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

const quickLinks = [
  { href: '/strength', label: 'Log a lift', icon: Dumbbell, desc: 'Strength & 1RM projections' },
  { href: '/cardio', label: 'Log a run', icon: Activity, desc: 'Pace & distance projections' },
  { href: '/bodyweight', label: 'Log weight', icon: Weight, desc: 'Track bodyweight progress' },
  { href: '/calories', label: 'Calorie lab', icon: Flame, desc: 'Estimate calories burned' },
]

export default function Dashboard() {
  const { user } = useAuth()
  const [recentEfforts, setRecentEfforts] = useState([])

  useEffect(() => {
    if (!user) return
    supabase
      .from('efforts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5)
      .then(({ data }) => setRecentEfforts(data || []))
  }, [user])

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 pb-24 md:pb-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">{greeting()}</h1>
        <p className="text-gray-400 text-sm mt-1">{user?.email}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
        {quickLinks.map(({ href, label, icon: Icon, desc }) => (
          <Link key={href} href={href} className="bg-[#111211] border border-[#1e201e] rounded-xl p-4 hover:border-[#c4f031]/30 transition-colors group">
            <Icon size={20} className="text-[#c4f031] mb-3" />
            <div className="text-sm font-medium text-white group-hover:text-[#c4f031] transition-colors">{label}</div>
            <div className="text-xs text-gray-500 mt-0.5">{desc}</div>
          </Link>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white">Recent efforts</h2>
          <Link href="/history" className="text-xs text-[#c4f031] hover:underline">View all</Link>
        </div>
        {recentEfforts.length === 0 ? (
          <div className="bg-[#111211] border border-[#1e201e] rounded-xl p-8 text-center text-gray-500 text-sm">
            No efforts logged yet. Start tracking above.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {recentEfforts.map(e => (
              <div key={e.id} className="bg-[#111211] border border-[#1e201e] rounded-xl px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-white">{e.label}</div>
                  <div className="text-xs text-gray-500">{new Date(e.created_at).toLocaleDateString()}</div>
                </div>
                <div className="text-sm font-mono text-[#c4f031]">{e.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
