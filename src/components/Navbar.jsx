import { Link, useLocation } from 'wouter'
import { useAuth } from '../contexts/AuthContext'
import { Dumbbell, Activity, Weight, Flame, History, LayoutDashboard } from 'lucide-react'

const links = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/strength', label: 'Strength', icon: Dumbbell },
  { href: '/cardio', label: 'Cardio', icon: Activity },
  { href: '/bodyweight', label: 'Bodyweight', icon: Weight },
  { href: '/calories', label: 'Calories', icon: Flame },
  { href: '/history', label: 'History', icon: History },
]

export default function Navbar() {
  const { signOut } = useAuth()
  const [location] = useLocation()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[#111211] border-t border-[#1e201e] md:static md:border-t-0 md:border-b md:border-[#1e201e]">
      <div className="max-w-4xl mx-auto flex items-center justify-between px-4 py-2 md:py-0 md:h-14">
        <Link href="/dashboard" className="hidden md:flex items-center gap-2 font-bold text-white text-lg">
          <span style={{letterSpacing:"-0.02em"}}>My<span style={{color:"#c4f031"}}>RX</span></span>
        </Link>
        <div className="flex items-center gap-1 w-full md:w-auto justify-around md:justify-start md:gap-1">
          {links.map(({ href, label, icon: Icon }) => {
            const active = location === href
            return (
              <Link
                key={href}
                href={href}
                className={`flex flex-col md:flex-row items-center gap-1 md:gap-2 px-3 py-2 rounded-lg text-xs md:text-sm transition-colors
                  ${active ? 'text-[#c4f031] bg-[#c4f031]/10' : 'text-gray-400 hover:text-white'}`}
              >
                <Icon size={18} />
                <span className="md:inline">{label}</span>
              </Link>
            )
          })}
        </div>
        <button
          onClick={signOut}
          className="hidden md:block text-sm text-gray-400 hover:text-white transition-colors px-3 py-2"
        >
          Sign out
        </button>
      </div>
    </nav>
  )
}
