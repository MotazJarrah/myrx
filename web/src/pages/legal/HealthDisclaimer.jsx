import LegalLayout from './LegalLayout'

export default function HealthDisclaimer() {
  return (
    <LegalLayout title="Health & Medical Disclaimer" effectiveDate="May 26, 2026">
      <p>
        <strong>MyRX is a fitness coaching platform, not a medical service.</strong>{' '}
        This page explains the limits of what MyRX (operated by Northern
        Princess LLC) can and cannot do for your health, and the
        responsibilities that come with using the platform. This Disclaimer
        is part of our <a href="/terms">Terms of Service</a> — by using
        MyRX, you agree to it.
      </p>

      <h2>1. MyRX is not medical advice</h2>
      <p>
        Nothing in the MyRX app, website, content, or coaching prescriptions
        constitutes medical advice, diagnosis, treatment, or care. The
        information you see — including target weights, projected one-rep maxes,
        target paces, calorie targets, macro splits, heart-rate zones, sleep
        recommendations, hydration targets, and any coaching content provided
        by you or a Coach on the platform — is for educational and fitness
        purposes only.
      </p>
      <p>
        <strong>MyRX is not a substitute for the advice of a physician,
        registered dietitian, licensed mental-health professional, or other
        qualified healthcare provider.</strong> Do not use MyRX to diagnose or
        treat a medical condition. Always consult a qualified healthcare
        provider before starting, changing, or stopping any exercise program,
        diet plan, supplement regimen, or treatment for a medical condition.
      </p>

      <h2>2. Consult a physician before starting a fitness program</h2>
      <p>
        Exercise carries inherent risks, including injury, illness, and (in
        rare cases) death. The risks are higher if you:
      </p>
      <ul>
        <li>Have a heart condition, high blood pressure, or other cardiovascular condition.</li>
        <li>Have a musculoskeletal injury, joint condition, or recent surgery.</li>
        <li>Are pregnant, postpartum, or trying to conceive.</li>
        <li>Have a metabolic condition (diabetes, thyroid disorder, etc.).</li>
        <li>Take medications that affect heart rate, blood pressure, blood sugar, hydration, or exercise capacity.</li>
        <li>Are recovering from an eating disorder or have a history of disordered eating.</li>
        <li>Have not exercised regularly in the past 6 months.</li>
        <li>Are over 40 (or over 50 for women) and starting a new program.</li>
      </ul>
      <p>
        <strong>If any of the above apply to you, consult your physician
        before starting any MyRX-prescribed program.</strong> MyRX coaching
        prescriptions are designed for healthy adults with no contraindications
        to exercise. They are not designed to accommodate undisclosed medical
        conditions, and MyRX does not screen you for medical conditions on
        signup.
      </p>

      <h2>3. Stop and seek care if you feel unwell</h2>
      <p>
        Stop training and seek medical attention immediately if you experience
        any of the following during or after exercise:
      </p>
      <ul>
        <li>Chest pain, pressure, or discomfort that radiates to your arm, jaw, or back.</li>
        <li>Shortness of breath that is disproportionate to the effort.</li>
        <li>Dizziness, faintness, or loss of consciousness.</li>
        <li>Sudden or severe joint or muscle pain that does not feel like ordinary training soreness.</li>
        <li>Heart rate that does not return to normal within reasonable recovery time.</li>
        <li>Persistent nausea or vomiting.</li>
      </ul>
      <p>
        These can be signs of a serious medical event. Do not push through
        them, and do not rely on MyRX or any Coach on the platform to assess
        them. <strong>Call your local emergency number (911 in the US, 999 in
        the UK, 112 in the EU) if symptoms are severe.</strong>
      </p>

      <h2>4. Coaches on the platform are not medical professionals (unless flagged)</h2>
      <p>
        The default Coach on MyRX is a fitness coach, not a medical
        professional. Coaches may hold certifications like NSCA-CSCS, NASM-CPT,
        ACE-CPT, ACSM-CPT, or precision-nutrition certifications, but these
        are <strong>not</strong> medical licenses. A certified fitness coach
        cannot:
      </p>
      <ul>
        <li>Diagnose a medical condition (including overtraining syndrome, RED-S, eating disorders, injuries).</li>
        <li>Prescribe or recommend medications, supplements, or treatments for a medical condition.</li>
        <li>Provide medical nutrition therapy (MNT) — the personalized clinical management of a disease via diet.</li>
        <li>Provide mental-health therapy or counseling.</li>
      </ul>
      <p>
        Some Coaches on MyRX may additionally hold healthcare licenses, such
        as Registered Dietitian (RD/RDN), Physical Therapist (DPT), Athletic
        Trainer (ATC), or licensed mental-health credentials. When this is the
        case, MyRX displays a verified credential badge on the Coach's
        profile. Even when a Coach is licensed, the advice they give you on
        MyRX is limited to the scope of their license and does not establish a
        physician-patient or clinical relationship between you and that
        professional unless they have explicitly told you otherwise.
      </p>
      <p>
        <strong>If you have a medical condition, you need to disclose it to
        your Coach AND to your own physician.</strong> A Coach is not equipped
        to design a safe program around a condition you have not disclosed.
      </p>

      <h2>5. Specific disclaimers</h2>

      <h3>5.1 Calorie and macro targets</h3>
      <p>
        Calorie and macro targets in MyRX are calculated using published
        formulas (Mifflin-St Jeor, Katch-McArdle, Cunningham, etc., depending
        on profile). These formulas are based on population averages and have
        a known accuracy of roughly ±10 % for any individual. They are not
        personalized to your specific metabolism, are not informed by lab work
        (resting metabolic rate testing, thyroid panels, etc.), and are not
        appropriate for clinical use. They are starting points for adjustment,
        not prescriptions.
      </p>
      <p>
        <strong>If you have an eating disorder history, a metabolic condition,
        are pregnant or postpartum, or are under medical supervision for your
        weight, do not follow MyRX calorie or macro targets without first
        consulting your physician or RD.</strong> MyRX will not detect that
        these targets are inappropriate for your situation.
      </p>

      <h3>5.2 Training prescriptions</h3>
      <p>
        Training prescriptions (1RM projections, target paces, training zones,
        progression plans) are derived from established sports-science formulas
        (Epley, Brzycki, Lombardi, Riegel, Daniels, Maffetone, etc.). They
        assume baseline fitness and absence of contraindicating injuries. They
        do not account for fatigue, illness, sleep debt, age-related recovery
        constraints, medications, or other factors that change what is safe
        for you on a given day. <strong>Adjust intensity to how you feel,
        not what the app says.</strong>
      </p>

      <h3>5.3 Heart-rate zones</h3>
      <p>
        Heart-rate zones (Z1–Z5) are derived using a "% of maximum heart rate"
        model with max HR estimated from age (220 minus age, with corrections).
        This estimate has substantial individual variation. If your true max
        HR is higher or lower than the estimate, the zones MyRX shows you will
        be off. A medically supervised stress test is the only reliable way to
        determine your true max HR.
      </p>

      <h3>5.4 Sleep and hydration recommendations</h3>
      <p>
        Sleep and hydration targets reflect general adult recommendations (≈ 7
        h sleep / night, ≈ 35 ml water per kg body weight per day). Your
        actual needs may be higher or lower based on individual physiology,
        activity, climate, and health conditions.
      </p>

      <h3>5.5 Wearable data</h3>
      <p>
        Data synced from wearables (Apple Health, Samsung Health, Garmin,
        Whoop, Polar, Fitbit, Strava) is presented as-is. Wearables have
        known accuracy limitations, especially for heart-rate during high-
        intensity exercise, calories burned, and sleep staging. Treat the
        numbers as directional, not as clinical measurements.
      </p>

      <h2>6. Special populations</h2>

      <h3>6.1 Pregnancy and postpartum</h3>
      <p>
        MyRX is not designed for pregnant or postpartum users. Standard
        fitness formulas (calorie targets, progression plans) do not account
        for the changes pregnancy and postpartum impose. If you are pregnant
        or in the first 6 months postpartum, consult your physician and a
        qualified pre/postnatal fitness specialist before using MyRX
        prescriptions.
      </p>

      <h3>6.2 Minors</h3>
      <p>
        MyRX is not designed for minors. You must be at least 13 to use MyRX
        (16 in jurisdictions with higher digital-consent ages). Even for
        teenagers above the minimum age, the calorie / macro / training
        prescriptions are calibrated for adults and may not be safe for
        adolescents. Adolescent athletes should train under the supervision
        of a qualified coach who specializes in youth athletics.
      </p>

      <h3>6.3 Eating-disorder history</h3>
      <p>
        Calorie tracking and weight tracking can be harmful for individuals
        with a current or past eating disorder. If you are in recovery or are
        at risk, please consult your treatment team before using MyRX's
        calorie or weight features. MyRX is not designed as a recovery tool
        and may reinforce disordered patterns.
      </p>

      <h3>6.4 Chronic conditions</h3>
      <p>
        If you have a chronic condition (diabetes, hypertension, autoimmune
        disorders, etc.), MyRX prescriptions do not account for your specific
        clinical management. Use only in coordination with your physician,
        and do not modify medication, insulin dosing, blood-pressure
        management, or other clinical care based on MyRX data.
      </p>

      <h2>7. No emergency services</h2>
      <p>
        MyRX is not designed for emergencies. If you are experiencing a
        medical emergency, mental-health crisis, or risk of self-harm,{' '}
        <strong>do not contact a MyRX Coach or MyRX support</strong>. Call
        your local emergency number (911 in the US, 999 in the UK, 112 in the
        EU) or go to your nearest emergency department. In the US, the 988
        Suicide & Crisis Lifeline is available 24/7 by call or text.
      </p>

      <h2>8. Assumption of risk; release</h2>
      <p>
        By using MyRX, you acknowledge that exercise carries inherent risks
        of injury and illness, that you assume those risks voluntarily, and
        that you release MyRX, its Coaches, its officers, directors,
        employees, and contractors from liability for any injury, illness,
        or adverse outcome you experience while following any MyRX
        prescription or Coach advice. This release does not waive liability
        for gross negligence, willful misconduct, or in jurisdictions where
        such a release is not enforceable.
      </p>

      <h2>9. Contact</h2>
      <p>
        Questions about this Disclaimer:{' '}
        <a href="mailto:support@myrxfit.com">support@myrxfit.com</a>. Please
        do not use this email for medical emergencies — see Section 7.
      </p>
    </LegalLayout>
  )
}
