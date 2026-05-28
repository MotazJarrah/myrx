/**
 * "How we compute your numbers" — long-form explanation of every formula
 * MyRX uses to convert your inputs (sex, age, weight, height, activity,
 * goal pace) into daily targets (BMR, TDEE, calories, macros).
 *
 * Lives at /how-we-compute. Linked from Settings → About on both web and
 * (eventually) mobile. Referenced from Terms of Service §9.1 and the
 * sex-screen disclaimer chip during signup.
 *
 * Locked May 25 2026. Formula attributions follow the registry in
 * CLAUDE.md ("Lock formula attribution registry into CLAUDE.md" task).
 */
import LegalLayout from './LegalLayout'

export default function HowWeCompute() {
  return (
    <LegalLayout title="How We Compute Your Numbers" effectiveDate="May 25, 2026">

      <h2>Quick summary</h2>
      <p>
        MyRX converts your inputs (sex, age, weight, height, activity level,
        body composition, goal pace) into daily targets using peer-reviewed
        equations from sports science and clinical nutrition. This page
        documents every formula we use and exactly how each piece of your
        profile data flows into your numbers. If you understand the inputs
        and the math, you understand the recommendations.
      </p>

      <h2>1. Sex / gender and the male / female baseline</h2>
      <p>
        The Mifflin-St Jeor equation we use for Basal Metabolic Rate (BMR)
        was published in 1990 (<em>American Journal of Clinical Nutrition</em>,
        Mifflin et al.) and validated against indirect calorimetry on a
        sample of 498 individuals. It has only two coefficient sets: one for
        Male, one for Female. There is no peer-reviewed equation for
        Non-binary or Prefer-not-to-say baselines.
      </p>
      <p>
        <strong>For users who select Non-binary or Prefer not to say, we
        apply the Female coefficients.</strong> We chose the Female baseline
        rather than the Male baseline because the Female equation produces a
        <strong> lower BMR estimate</strong>, which means lower daily calorie
        targets — the safer direction. Over-eating during a caloric deficit
        ruins the deficit; under-eating recovers within a meal. We optimize
        for the failure mode that's easiest to correct.
      </p>
      <p>
        This is a calculation convention, not a statement about your
        identity. Hormonal and metabolic differences exist on a spectrum
        that the 1990 formula cannot fully capture, especially for trans
        and non-binary users on hormone replacement therapy. If you're on
        HRT and want more accurate numbers, ask a registered dietitian to
        review your targets — they can adjust for your specific metabolic
        adaptations.
      </p>
      <p>
        You can change your sex / gender selection at any time in
        Settings → Preferences → Body stats. Any change recomputes BMR,
        TDEE, and macro targets immediately.
      </p>

      <h2>2. Basal Metabolic Rate (BMR)</h2>
      <p>
        <strong>Equation:</strong> Mifflin-St Jeor (1990).
      </p>
      <p>
        Male: <code>BMR = 10 × weight(kg) + 6.25 × height(cm) − 5 × age(years) + 5</code>
      </p>
      <p>
        Female (and Non-binary / Prefer not to say): <code>BMR = 10 × weight(kg) + 6.25 × height(cm) − 5 × age(years) − 161</code>
      </p>
      <p>
        BMR represents the calories your body burns at complete rest —
        breathing, heartbeat, organ function. It's the floor of your daily
        energy expenditure.
      </p>

      <h3>2.1 Body composition adjustment</h3>
      <p>
        If you select a body fat band on the Body Composition screen, we
        adjust BMR up or down to account for lean mass:
      </p>
      <ul>
        <li><strong>Lean</strong> (≤ 12% male / ≤ 20% female): BMR × 1.05</li>
        <li><strong>Average</strong> (12–22% male / 20–30% female): BMR × 1.00</li>
        <li><strong>High</strong> (&gt; 22% male / &gt; 30% female): BMR × 0.95</li>
      </ul>
      <p>
        Lean tissue burns more calories at rest than fat tissue does, so a
        leaner body composition gets a small upward BMR adjustment. This is
        a simplified proxy; for clinical-grade accuracy, body composition
        analysis (DEXA, BodPod, hydrostatic weighing) is the gold standard.
      </p>

      <h2>3. Total Daily Energy Expenditure (TDEE)</h2>
      <p>
        <strong>Equation:</strong> BMR × activity multiplier.
      </p>
      <p>
        TDEE is your BMR plus the calories burned by daily movement and
        exercise. The activity multipliers follow the standard sports-science
        ranges:
      </p>
      <ul>
        <li><strong>Sedentary</strong>: BMR × 1.2 (desk job, no exercise)</li>
        <li><strong>Light</strong>: BMR × 1.375 (1–2 sessions / week)</li>
        <li><strong>Moderate</strong>: BMR × 1.55 (3–4 sessions / week)</li>
        <li><strong>Very Active</strong>: BMR × 1.725 (5–6 sessions / week)</li>
        <li><strong>Extreme</strong>: BMR × 1.9 (2 sessions / day, manual labor)</li>
      </ul>

      <h2>4. Daily calorie target</h2>
      <p>
        <strong>Equation:</strong> TDEE × (1 + energy balance %).
      </p>
      <p>
        Your daily calorie target = TDEE adjusted by your chosen pace. We
        cap the pace at ±50% in either direction (aggressive fat loss to
        aggressive muscle gain) and bias toward conservative deficits to
        protect lean tissue during cuts.
      </p>

      <h2>5. Macronutrient targets</h2>
      <p>
        Each macro preset (Balanced, High-Protein, High-Carb, Keto) seeds
        initial percentages for protein, fat, and carbs. We then enforce
        two non-negotiable floors derived from body weight:
      </p>
      <ul>
        <li>
          <strong>Protein floor</strong>: 1.6 g per kg of body weight. Below
          this, lean tissue protection is compromised during deficits
          (Helms 2014, <em>Journal of the International Society of Sports
          Nutrition</em>).
        </li>
        <li>
          <strong>Fat floor</strong>: max of 0.5 g/kg body weight OR 20% of
          total calories. Below this, hormonal function and fat-soluble
          vitamin absorption are compromised (Volek 2003, NSCA position
          stand).
        </li>
      </ul>
      <p>
        Carbs fill the remaining calorie budget. For Keto, a hard ceiling
        on carbs (20–50 g/day depending on activity tier) keeps you in
        ketosis; excess fat-budget shifts to fat instead.
      </p>

      <h2>6. Rep-max projections (strength)</h2>
      <p>
        When you log a set, we project your one-rep max (1RM) using the
        average of three formulas — Epley, Brzycki, and Lombardi — except
        on rep ranges above 10 where Brzycki under-projects, so we average
        only Epley and Lombardi.
      </p>
      <ul>
        <li>Epley: <code>1RM = weight × (1 + reps / 30)</code></li>
        <li>Brzycki: <code>1RM = weight × 36 / (37 − reps)</code></li>
        <li>Lombardi: <code>1RM = weight × reps<sup>0.10</sup></code></li>
      </ul>

      <h2>7. Pace projections (cardio)</h2>
      <p>
        Cross-distance pace projections use Riegel's equation (1981):{' '}
        <code>T₂ = T₁ × (D₂ / D₁)<sup>1.06</sup></code>. Per-zone pace
        offsets follow Daniels' Running Formula: Endurance = best + 60 s/km,
        Threshold = best + 10 s/km, VO2 Max = best − 15 s/km. Workout
        prescriptions per zone draw from Maglischo (swimming), Daniels
        (running, threshold/VO2), and Seiler (polarized 80/20 distribution).
      </p>

      <h2>8. Heart rate zones</h2>
      <p>
        HR zones use percent-of-HRmax thresholds from ACSM Guidelines for
        Exercise Testing and Prescription (12th ed., 2025): Endurance
        60–70%, Threshold 80–90%, VO2 Max 90–100%. We surface only three
        zones (skipping Recovery and Tempo) because the polarized training
        model treats those as either non-training or "no man's land" with
        diminishing returns.
      </p>

      <h2>9. Where the data goes</h2>
      <p>
        Your sex / gender, body weight, height, age, and body fat selection
        are stored only on your profile and used only for the calculations
        above. They are never shared with third parties, never used for
        advertising, never used for analytics segmentation, and never
        visible to other users. Coaches who manage your account can see
        them because they need them to set your macro plan correctly.
      </p>
      <p>
        For the full data-handling policy, see our{' '}
        <a href="/privacy">Privacy Policy</a>. For the legally binding
        version of section 1 (sex / gender baseline), see Terms of Service{' '}
        <a href="/terms">section 9.1</a>.
      </p>

      <h2>10. Changes to your numbers</h2>
      <p>
        Update any input — weight, age, activity, body fat, sex / gender,
        goal pace — and your BMR, TDEE, daily calorie target, and macros
        all recompute immediately. The changes apply going forward; your
        previously logged days are not retroactively recalculated.
      </p>

      <h2>11. Talk to us</h2>
      <p>
        If you spot a calculation that looks wrong or have a question about
        how a specific number was produced, email{' '}
        <a href="mailto:team@myrxfit.com">team@myrxfit.com</a>. We'll walk
        you through your specific numbers.
      </p>

    </LegalLayout>
  )
}
