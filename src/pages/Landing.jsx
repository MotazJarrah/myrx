import { Link } from 'wouter'

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#0a0b0a] text-white flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-[#1e201e]">
        <div className="flex items-center gap-2 font-bold text-xl">
          <span className="text-[#c4f031]">My</span>RX
        </div>
        <div className="flex items-center gap-3">
          <Link href="/auth?mode=signin" className="text-sm text-gray-400 hover:text-white transition-colors px-4 py-2">
            Sign in
          </Link>
          <Link href="/auth?mode=signup" className="text-sm bg-[#c4f031] text-black font-semibold px-4 py-2 rounded-lg hover:bg-[#d4ff41] transition-colors">
            Get started
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center py-20">
        <div className="inline-flex items-center gap-2 bg-[#111211] border border-[#1e201e] rounded-full px-4 py-1.5 text-sm text-gray-400 mb-10">
          <span className="w-2 h-2 rounded-full bg-[#c4f031] animate-pulse" />
          Performance Lab · v1.0
        </div>

        <h1 className="text-5xl md:text-7xl font-bold leading-tight tracking-tight mb-6">
          One number in.<br />
          <span className="text-[#c4f031]">Every projection out.</span>
        </h1>

        <p className="text-gray-400 text-lg max-w-xl mb-10 leading-relaxed">
          MyRX is the performance lab for lifters and endurance athletes. Log a single effort
          and get the full spectrum of rep maxes, pace projections, and target paces.
          Sports-science formulas, no guesswork.
        </p>

        <div className="flex items-center gap-4">
          <Link href="/auth?mode=signup" className="bg-[#c4f031] text-black font-semibold px-6 py-3 rounded-lg hover:bg-[#d4ff41] transition-colors flex items-center gap-2">
            Start tracking →
          </Link>
          <Link href="/auth?mode=signin" className="border border-[#1e201e] text-white px-6 py-3 rounded-lg hover:bg-[#111211] transition-colors">
            I have an account
          </Link>
        </div>

        {/* Preview card */}
        <div className="mt-20 bg-[#111211] border border-[#1e201e] rounded-2xl p-6 max-w-xl w-full text-left">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium">Bench Press · 225 lb × 5</span>
            <span className="text-xs bg-[#c4f031]/10 text-[#c4f031] border border-[#c4f031]/20 px-2 py-1 rounded">Est. 1RM 260 lb</span>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {[
              { rm: '1RM', w: 260, active: false },
              { rm: '2RM', w: 247, active: false },
              { rm: '3RM', w: 238, active: false },
              { rm: '4RM', w: 231, active: false },
              { rm: '5RM', w: 225, active: true },
              { rm: '6RM', w: 219, active: false },
              { rm: '7RM', w: 214, active: false },
              { rm: '8RM', w: 208, active: false },
              { rm: '9RM', w: 203, active: false },
              { rm: '10RM', w: 199, active: false },
            ].map(({ rm, w, active }) => (
              <div key={rm} className={`rounded-lg p-2 text-center ${active ? 'bg-[#c4f031]/10 border border-[#c4f031]/30' : 'bg-[#0a0b0a]'}`}>
                <div className={`text-xs mb-1 ${active ? 'text-[#c4f031]' : 'text-gray-500'}`}>{rm}</div>
                <div className={`text-sm font-semibold font-mono ${active ? 'text-[#c4f031]' : 'text-white'}`}>{w}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-xs text-gray-500">Epley · Brzycki · Lombardi averaged</div>
        </div>
      </main>
    </div>
  )
}
