/**
 * Shared password-requirements validator (web). Mirrors mobile
 * src/components/PasswordStrengthMeter.tsx (passwordRequirements /
 * passwordMeetsRequirements).
 *
 * REQUIRED rules to SET any password (signup, reset, change, invite):
 *   • at least 8 characters
 *   • at least 1 uppercase letter
 *   • at least 1 number
 *   • at least 1 symbol
 * (No lowercase rule — not required.) These are HARD-gated: the form's
 * submit stays disabled until passwordMeetsRequirements() is true. This is
 * separate from the advisory 0–4 strength meter (coachCheckStrength etc.),
 * which only colors the bars and never blocks.
 */
export function passwordRequirements(pw = '') {
  return {
    length: pw.length >= 8,
    upper:  /[A-Z]/.test(pw),
    number: /[0-9]/.test(pw),
    symbol: /[^A-Za-z0-9]/.test(pw),
  }
}

export function passwordMeetsRequirements(pw = '') {
  const r = passwordRequirements(pw)
  return r.length && r.upper && r.number && r.symbol
}
