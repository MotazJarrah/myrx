/**
 * Country codes — used by the phone-number country picker.
 *
 * Curated list of the ~70 most commonly-needed countries (G20 + major
 * markets) rather than the full 240+ ISO list, to keep the bundle small.
 * If you need a country that's missing, add it here — no other code change
 * required.
 *
 * `dial` is the E.164 calling code (e.g. '+1' for US/CA, '+44' for UK).
 * `flag` uses unicode regional-indicator emojis so we don't need an image
 * asset per country.
 *
 * Matches the country list expected by Supabase auth phone signup.
 */

export interface Country {
  code: string  // ISO 3166-1 alpha-2
  name: string
  dial: string
  flag: string
}

export const COUNTRIES: Country[] = [
  // North America
  { code: 'US', name: 'United States',  dial: '+1',   flag: '🇺🇸' },
  { code: 'CA', name: 'Canada',         dial: '+1',   flag: '🇨🇦' },
  { code: 'MX', name: 'Mexico',         dial: '+52',  flag: '🇲🇽' },

  // Latin America
  { code: 'AR', name: 'Argentina',      dial: '+54',  flag: '🇦🇷' },
  { code: 'BR', name: 'Brazil',         dial: '+55',  flag: '🇧🇷' },
  { code: 'CL', name: 'Chile',          dial: '+56',  flag: '🇨🇱' },
  { code: 'CO', name: 'Colombia',       dial: '+57',  flag: '🇨🇴' },
  { code: 'PE', name: 'Peru',           dial: '+51',  flag: '🇵🇪' },
  { code: 'VE', name: 'Venezuela',      dial: '+58',  flag: '🇻🇪' },

  // Europe
  { code: 'GB', name: 'United Kingdom', dial: '+44',  flag: '🇬🇧' },
  { code: 'IE', name: 'Ireland',        dial: '+353', flag: '🇮🇪' },
  { code: 'FR', name: 'France',         dial: '+33',  flag: '🇫🇷' },
  { code: 'DE', name: 'Germany',        dial: '+49',  flag: '🇩🇪' },
  { code: 'ES', name: 'Spain',          dial: '+34',  flag: '🇪🇸' },
  { code: 'IT', name: 'Italy',          dial: '+39',  flag: '🇮🇹' },
  { code: 'PT', name: 'Portugal',       dial: '+351', flag: '🇵🇹' },
  { code: 'NL', name: 'Netherlands',    dial: '+31',  flag: '🇳🇱' },
  { code: 'BE', name: 'Belgium',        dial: '+32',  flag: '🇧🇪' },
  { code: 'CH', name: 'Switzerland',    dial: '+41',  flag: '🇨🇭' },
  { code: 'AT', name: 'Austria',        dial: '+43',  flag: '🇦🇹' },
  { code: 'SE', name: 'Sweden',         dial: '+46',  flag: '🇸🇪' },
  { code: 'NO', name: 'Norway',         dial: '+47',  flag: '🇳🇴' },
  { code: 'DK', name: 'Denmark',        dial: '+45',  flag: '🇩🇰' },
  { code: 'FI', name: 'Finland',        dial: '+358', flag: '🇫🇮' },
  { code: 'IS', name: 'Iceland',        dial: '+354', flag: '🇮🇸' },
  { code: 'PL', name: 'Poland',         dial: '+48',  flag: '🇵🇱' },
  { code: 'CZ', name: 'Czechia',        dial: '+420', flag: '🇨🇿' },
  { code: 'GR', name: 'Greece',         dial: '+30',  flag: '🇬🇷' },
  { code: 'RO', name: 'Romania',        dial: '+40',  flag: '🇷🇴' },
  { code: 'HU', name: 'Hungary',        dial: '+36',  flag: '🇭🇺' },
  { code: 'RU', name: 'Russia',         dial: '+7',   flag: '🇷🇺' },
  { code: 'UA', name: 'Ukraine',        dial: '+380', flag: '🇺🇦' },
  { code: 'TR', name: 'Turkey',         dial: '+90',  flag: '🇹🇷' },

  // Middle East & North Africa
  { code: 'AE', name: 'UAE',            dial: '+971', flag: '🇦🇪' },
  { code: 'SA', name: 'Saudi Arabia',   dial: '+966', flag: '🇸🇦' },
  { code: 'QA', name: 'Qatar',          dial: '+974', flag: '🇶🇦' },
  { code: 'KW', name: 'Kuwait',         dial: '+965', flag: '🇰🇼' },
  { code: 'BH', name: 'Bahrain',        dial: '+973', flag: '🇧🇭' },
  { code: 'OM', name: 'Oman',           dial: '+968', flag: '🇴🇲' },
  { code: 'IL', name: 'Israel',         dial: '+972', flag: '🇮🇱' },
  { code: 'JO', name: 'Jordan',         dial: '+962', flag: '🇯🇴' },
  { code: 'LB', name: 'Lebanon',        dial: '+961', flag: '🇱🇧' },
  { code: 'EG', name: 'Egypt',          dial: '+20',  flag: '🇪🇬' },
  { code: 'MA', name: 'Morocco',        dial: '+212', flag: '🇲🇦' },
  { code: 'TN', name: 'Tunisia',        dial: '+216', flag: '🇹🇳' },
  { code: 'DZ', name: 'Algeria',        dial: '+213', flag: '🇩🇿' },

  // Sub-Saharan Africa
  { code: 'ZA', name: 'South Africa',   dial: '+27',  flag: '🇿🇦' },
  { code: 'NG', name: 'Nigeria',        dial: '+234', flag: '🇳🇬' },
  { code: 'KE', name: 'Kenya',          dial: '+254', flag: '🇰🇪' },
  { code: 'GH', name: 'Ghana',          dial: '+233', flag: '🇬🇭' },
  { code: 'ET', name: 'Ethiopia',       dial: '+251', flag: '🇪🇹' },

  // Asia
  { code: 'IN', name: 'India',          dial: '+91',  flag: '🇮🇳' },
  { code: 'PK', name: 'Pakistan',       dial: '+92',  flag: '🇵🇰' },
  { code: 'BD', name: 'Bangladesh',     dial: '+880', flag: '🇧🇩' },
  { code: 'LK', name: 'Sri Lanka',      dial: '+94',  flag: '🇱🇰' },
  { code: 'CN', name: 'China',          dial: '+86',  flag: '🇨🇳' },
  { code: 'HK', name: 'Hong Kong',      dial: '+852', flag: '🇭🇰' },
  { code: 'TW', name: 'Taiwan',         dial: '+886', flag: '🇹🇼' },
  { code: 'JP', name: 'Japan',          dial: '+81',  flag: '🇯🇵' },
  { code: 'KR', name: 'South Korea',    dial: '+82',  flag: '🇰🇷' },
  { code: 'SG', name: 'Singapore',      dial: '+65',  flag: '🇸🇬' },
  { code: 'MY', name: 'Malaysia',       dial: '+60',  flag: '🇲🇾' },
  { code: 'ID', name: 'Indonesia',      dial: '+62',  flag: '🇮🇩' },
  { code: 'PH', name: 'Philippines',    dial: '+63',  flag: '🇵🇭' },
  { code: 'TH', name: 'Thailand',       dial: '+66',  flag: '🇹🇭' },
  { code: 'VN', name: 'Vietnam',        dial: '+84',  flag: '🇻🇳' },

  // Oceania
  { code: 'AU', name: 'Australia',      dial: '+61',  flag: '🇦🇺' },
  { code: 'NZ', name: 'New Zealand',    dial: '+64',  flag: '🇳🇿' },
]

/**
 * Look up a country by ISO code (e.g. 'US'). Returns undefined if not in the
 * curated list.
 */
export function findCountry(code: string): Country | undefined {
  return COUNTRIES.find(c => c.code === code)
}

/**
 * Match a phone number's leading dial code against the country list and
 * return the longest-matching country. Returns the default ('US') when
 * nothing matches.
 *
 *   '+11234567890'   → US (+1, 10-digit national number)
 *   '+447700900123'  → GB (+44)
 *   '+9712025550100' → AE (+971)
 */
export function matchCountryFromPhone(phone: string): { country: Country; national: string } {
  const trimmed = phone.replace(/\s/g, '')
  if (!trimmed.startsWith('+')) {
    return { country: COUNTRIES[0], national: trimmed }
  }
  // Sort by dial length descending so '+971' wins over '+9'
  const sorted = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length)
  for (const c of sorted) {
    if (trimmed.startsWith(c.dial)) {
      return { country: c, national: trimmed.slice(c.dial.length) }
    }
  }
  return { country: COUNTRIES[0], national: trimmed.slice(1) }
}
