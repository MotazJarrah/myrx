/**
 * Admin cardio effort detail — dispatcher.
 * Route: /admin/user/:userId/effort/cardio/:slug
 *
 * Routes each cardio activity to its READ-ONLY (+per-effort delete) coach
 * mirror, matching the athlete CardioDetail dispatch order + categorization
 * (mobile/app/(app)/effort/cardio/[activity].tsx). Each mirror self-fetches
 * the client's efforts + profile, so this file is a pure router.
 */
import { useParams, useLocation } from 'wouter'
import AdminCardioPaceDetail from './detail/AdminCardioPaceDetail'
import AdminCardioAirBikeDetail from './detail/AdminCardioAirBikeDetail'
import AdminCardioSwimmingDetail from './detail/AdminCardioSwimmingDetail'
import AdminCardioRuckingDetail from './detail/AdminCardioRuckingDetail'
import AdminCardioStairMillDetail from './detail/AdminCardioStairMillDetail'
import AdminCardioBeatYourBestDetail from './detail/AdminCardioBeatYourBestDetail'

// Mirror of the athlete categorizeActivity (order matters — most-specific
// first). "Bike Erg" → stationary_bike → Beat-Your-Best (same as the athlete);
// Row Erg (rowing) + Ski Erg (ski_erg) fall through to Pace (Concept2 ergs).
function categorizeActivity(name) {
  const lower = (name || '').toLowerCase()
  if (/swim/.test(lower)) return 'swimming'
  if (/ski erg/.test(lower)) return 'ski_erg'
  if (/row erg/.test(lower)) return 'rowing'
  if (/air bike|assault bike|airdyne/.test(lower)) return 'air_bike'
  if (/spin|stationary|recumbent|bike erg/.test(lower)) return 'stationary_bike'
  if (/ellipt/.test(lower)) return 'elliptical'
  if (/cycl|bike/.test(lower)) return 'cycling'
  if (/ruck/.test(lower)) return 'rucking'
  if (/stair/.test(lower)) return 'stair_climber'
  return 'running'
}

const BEAT_YOUR_BEST = ['cycling', 'stationary_bike', 'elliptical']

export default function AdminCardioDetail() {
  const { userId, slug } = useParams()
  const [routePath, navigate] = useLocation()
  // Portal-aware back-link (see AdminEffortDetail): /client under the coach
  // portal (root-level on coach.myrxfit.com, T199), /admin/user under admin.
  const detailBase = routePath.startsWith('/client/') ? '/client' : '/admin/user'
  const activity = decodeURIComponent(slug || '')

  function onBack() {
    // Back from a move-detail page returns to the Efforts (activity) tab, never
    // the Dashboard. ?tab= is honored on mount; the old localStorage last-tab
    // restore was dropped in T101, so we steer via the URL param now.
    navigate(`${detailBase}/${userId}?tab=activity`)
  }

  const cat = categorizeActivity(activity)
  const common = { userId, activity, onBack }

  if (cat === 'stair_climber') return <AdminCardioStairMillDetail {...common} />
  if (cat === 'air_bike') return <AdminCardioAirBikeDetail {...common} />
  if (cat === 'rucking') return <AdminCardioRuckingDetail {...common} />
  if (BEAT_YOUR_BEST.includes(cat)) return <AdminCardioBeatYourBestDetail {...common} />
  if (cat === 'swimming') return <AdminCardioSwimmingDetail {...common} />
  return <AdminCardioPaceDetail {...common} />
}
