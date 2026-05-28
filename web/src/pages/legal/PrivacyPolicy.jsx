import LegalLayout from './LegalLayout'

export default function PrivacyPolicy() {
  return (
    <LegalLayout title="Privacy Policy" effectiveDate="May 26, 2026">
      <h2>1. About this policy</h2>
      <p>
        This Privacy Policy describes how MyRX ("MyRX," "we," "us," or "our"),
        operated by Northern Princess LLC, a Michigan limited liability company,
        collects, uses, and shares information about you when you use the
        MyRX mobile application, website, and related services (collectively,
        the "Service").
      </p>
      <p>
        By using the Service, you agree to this Policy. If you do not agree,
        please do not use the Service.
      </p>

      <h2>2. Who we are</h2>
      <p>
        MyRX is operated by Northern Princess LLC, registered in the State of
        Michigan, USA. For any privacy-related question, request, or
        complaint, contact us at <a href="mailto:privacy@myrxfit.com">privacy@myrxfit.com</a>.
      </p>

      <h2>3. Information we collect</h2>

      <h3>3.1 Information you provide</h3>
      <p>When you create an account and use the Service, we collect:</p>
      <ul>
        <li>
          <strong>Account information</strong>: email address, phone number,
          password (hashed by our authentication provider — we never see your
          plaintext password), first and last name, profile photo.
        </li>
        <li>
          <strong>Body and fitness data</strong>: date of birth, gender,
          height, weight, weight history, training preferences (units,
          modality), fitness goals.
        </li>
        <li>
          <strong>Activity logs</strong>: workout entries (strength, cardio,
          mobility, bodyweight), nutrition and calorie logs, lesson interactions,
          mobility / range-of-motion assessments, personal records.
        </li>
        <li>
          <strong>Coach communications</strong>: messages between you and your
          coach (when chat is enabled), suggestions you submit through the app.
        </li>
        <li>
          <strong>Subscription and billing information</strong>: subscription tier,
          purchase history, and limited payment metadata. Full payment card
          details are handled by Stripe and never stored on our servers (see
          Section 6).
        </li>
        <li>
          <strong>Settings and preferences</strong>: notification preferences,
          chat preferences, share-with-coach flags, biometric / lock-app
          preference (which is stored locally on your device and never
          transmitted to us).
        </li>
      </ul>

      <h3>3.2 Information collected automatically</h3>
      <ul>
        <li>
          <strong>Device information</strong>: device type, operating system,
          app version, IP address, language, timezone.
        </li>
        <li>
          <strong>Usage data</strong>: features accessed, time spent, action
          timestamps, errors encountered.
        </li>
        <li>
          <strong>Approximate location</strong>: derived from your IP address.
          We do not collect precise GPS location.
        </li>
      </ul>

      <h3>3.3 Information from wearables and fitness platforms</h3>
      <p>
        If you explicitly connect a wearable or fitness platform via
        Settings → Connect, MyRX reads fitness-grade signals from that
        platform on your behalf. Currently supported platforms:
      </p>
      <ul>
        <li><strong>Samsung Health Data SDK</strong> (Android — Galaxy and other Samsung devices)</li>
        <li><strong>Google Health Connect</strong> (Android — Pixel and other Android devices)</li>
        <li><strong>Apple HealthKit</strong> (iOS — pending implementation)</li>
        <li>
          <strong>OAuth-based services</strong> (pending implementation):
          Strava, Garmin, Whoop, Polar, Fitbit
        </li>
      </ul>
      <p>
        From these platforms we read only the data types you have
        granted through the platform's own consent UI, limited to:
        heart-rate samples (ambient and per-workout), step counts,
        workout sessions and associated session-level HR streams,
        sleep stages and durations, and body measurements (weight,
        body composition). We store this data in your MyRX account
        (see Section 7, Data retention, for how long) so we can
        render your trends and coaching surfaces. If you disconnect
        a platform from Settings → Connect, we stop reading new data
        from it; data already synced remains until you delete your
        account or request deletion of that data type.
      </p>

      <h3>3.4 Information we do not collect</h3>
      <p>We do not collect or process:</p>
      <ul>
        <li>Precise GPS location</li>
        <li>Government-issued identification numbers</li>
        <li>
          Clinical health records from healthcare providers (e.g. lab
          results, prescriptions, diagnoses, imaging) — only the
          fitness-grade wearable signals described in Section 3.3
        </li>
        <li>Information from third-party social networks unless you explicitly connect them</li>
      </ul>

      <h2>4. How we use your information</h2>
      <p>We use the information we collect to:</p>
      <ul>
        <li>Provide, operate, and maintain the Service</li>
        <li>Authenticate you when you sign in</li>
        <li>Process subscriptions and payments</li>
        <li>Sync your data between devices and ensure data integrity</li>
        <li>
          Communicate with you for transactional purposes (verification codes,
          password resets, account alerts, security notices, billing receipts,
          customer support)
        </li>
        <li>
          Send marketing communications, where you have opted in (newsletters,
          promotional offers, re-engagement messages, product announcements)
        </li>
        <li>Personalize your experience (e.g. projecting your 1RM from logged sets)</li>
        <li>Detect and prevent fraud, abuse, and security incidents</li>
        <li>Aggregate, anonymize, and analyze usage to improve the Service</li>
        <li>Comply with legal obligations</li>
      </ul>

      <h3>4.1 How we use your sex / gender</h3>
      <p>
        Your sex / gender selection is used <strong>only</strong> for metabolic
        calculations: Basal Metabolic Rate (BMR), Total Daily Energy Expenditure
        (TDEE), and macronutrient targets. The Mifflin-St Jeor equation we use
        for BMR only has validated coefficients for Male and Female baselines —
        for users who select Non-binary or Prefer not to say, we apply the
        Female coefficients as the more conservative (safer) estimate. See our
        Terms of Service section 9.1 for the full explanation.
      </p>
      <p>
        Your sex / gender is never visible to other users, never shared with
        third parties, never used for advertising or analytics segmentation,
        and never used as a factor in pricing or feature gating. Coaches who
        manage your account can see it because they need it to set your macro
        plan correctly; nobody else can.
      </p>

      <h2>5. Legal bases for processing (EU/UK users)</h2>
      <p>
        If you are in the European Economic Area, the United Kingdom, or
        Switzerland, we rely on the following legal bases under the GDPR
        and UK GDPR to process your information:
      </p>
      <ul>
        <li>
          <strong>Performance of a contract</strong> — where processing is
          necessary to provide the Service you signed up for (authenticating
          your sign-in, syncing your training data, processing your subscription).
        </li>
        <li>
          <strong>Legitimate interests</strong> — where we have a legitimate
          business interest that does not override your rights (fraud
          prevention, security, debugging, product improvement).
        </li>
        <li>
          <strong>Consent</strong> — where you have given us consent (for
          marketing communications, optional analytics where applicable).
          You may withdraw consent at any time.
        </li>
        <li>
          <strong>Legal obligation</strong> — where we must process data to
          comply with applicable law.
        </li>
      </ul>

      <h2>6. How we share your information</h2>
      <p>
        We do not sell your personal information. We share your information
        only in the limited circumstances below.
      </p>

      <h3>6.1 Service providers (subprocessors)</h3>
      <p>
        We use third-party service providers to operate the Service.
        They process your information only on our instructions and
        under written confidentiality and data-processing agreements.
        The same list appears in our{' '}
        <a href="/dpa">Data Processing Agreement</a>; if a discrepancy
        ever appears between the two, the DPA is the authoritative
        list.
      </p>
      <p><strong>Infrastructure</strong></p>
      <ul>
        <li><strong>Supabase, Inc.</strong> — Postgres database, authentication, file storage, edge functions (United States)</li>
        <li><strong>Cloudflare, Inc.</strong> — web hosting (Pages), edge workers, D1 (United States, with global edge POPs)</li>
        <li><strong>Expo, Inc.</strong> — over-the-air app updates and build infrastructure (United States)</li>
      </ul>
      <p><strong>Communications &amp; payments</strong></p>
      <ul>
        <li><strong>Stripe, Inc.</strong> — payment processing for web-sold subscriptions and one-time purchases (United States)</li>
        <li><strong>Twilio Inc.</strong> — SMS verification codes via Twilio Verify (United States)</li>
        <li><strong>Resend</strong> and/or <strong>SendGrid</strong> — transactional email delivery used by our authentication provider (United States)</li>
      </ul>
      <p><strong>App distribution</strong></p>
      <ul>
        <li><strong>Apple Inc.</strong> — App Store distribution and (when used) Apple In-App Purchase billing</li>
        <li><strong>Google LLC</strong> — Google Play distribution and (when used) Google Play Billing</li>
      </ul>
      <p><strong>Wearable &amp; fitness platforms (only if you connect them)</strong></p>
      <ul>
        <li><strong>Samsung Electronics</strong> — Samsung Health Data SDK (Galaxy and other Samsung Android devices)</li>
        <li><strong>Google LLC</strong> — Google Health Connect (Android)</li>
        <li><strong>Apple Inc.</strong> — Apple HealthKit (iOS, pending implementation)</li>
        <li><strong>Strava, Inc.</strong>, <strong>Garmin International, Inc.</strong>, <strong>Whoop, Inc.</strong>, <strong>Polar Electro Oy</strong>, <strong>Fitbit LLC</strong> — pending implementation</li>
      </ul>

      <h3>6.2 Coach access</h3>
      <p>
        If you connect with a Coach on MyRX, the Coach has access to data
        you have explicitly chosen to share — your workout logs, body
        data, nutrition logs, and chat messages with that Coach. You can
        review and adjust what is shared in Settings under your sharing
        preferences. The Coach is bound by our{' '}
        <a href="/coach-agreement">Coach Agreement</a> and (in their
        handling of your Personal Data as your Coach) our{' '}
        <a href="/dpa">Data Processing Agreement</a>, which together
        require the Coach to keep your data confidential, use it only
        for the coaching service, and not retain it after the coaching
        relationship ends.
      </p>

      <h3>6.3 Legal compliance and safety</h3>
      <p>
        We may disclose your information if required by law, in response to
        valid legal process, or where we believe disclosure is necessary to
        protect the rights, property, or safety of MyRX, our users, or others.
      </p>

      <h3>6.4 Business transfers</h3>
      <p>
        If MyRX (or Northern Princess LLC) is acquired or merges with another
        entity, your information may be transferred to the successor as part
        of that transaction. We will notify you of any change of control and
        your rights afterwards.
      </p>

      <h3>6.5 With your consent</h3>
      <p>We may share your information for any other purpose with your explicit consent.</p>

      <h3>6.6 For Coaches: handling of your Clients' data</h3>
      <p>
        If you are a Coach with Clients on MyRX, our handling of your
        Clients' Personal Data on your behalf is governed by our{' '}
        <a href="/dpa">Data Processing Agreement</a> (DPA). In that
        relationship, you are the Controller (you decide what coaching
        to provide and what data you need) and MyRX is the Processor
        (we hold and process your Clients' data on your documented
        instructions). The DPA, which is incorporated into our{' '}
        <a href="/terms">Terms of Service</a> and{' '}
        <a href="/coach-agreement">Coach Agreement</a> by reference,
        covers: the full subprocessor list and 30-day change notice,
        EU Standard Contractual Clauses for international transfers,
        72-hour Personal Data Breach notification, technical and
        organizational security measures, audit rights, and our
        deletion / return obligations when a coaching relationship
        ends. This Privacy Policy continues to govern our processing of
        Personal Data we collect from Coaches in our own right (account
        registration, billing, support).
      </p>

      <h2>7. Data retention</h2>
      <p>
        We retain your information for as long as your account is active and
        as needed to provide the Service. Specifically:
      </p>
      <ul>
        <li><strong>Account data</strong>: retained while your account is active.</li>
        <li><strong>Activity logs</strong>: retained while your account is active so we can show you trends and history.</li>
        <li><strong>Backups</strong>: retained for up to 90 days for disaster recovery.</li>
        <li>
          <strong>Deleted accounts</strong>: account data is deleted within 30
          days of your deletion request, except where retention is required by
          law (e.g. financial records associated with your subscription, retained
          for the period required by applicable tax law).
        </li>
      </ul>
      <p>
        You can request deletion of your account at any time by contacting{' '}
        <a href="mailto:privacy@myrxfit.com">privacy@myrxfit.com</a> or using
        the "Delete Account" option in Settings (where available).
      </p>

      <h3>7.1 Account deletion + data retention</h3>
      <p>
        Deletion of your MyRX account follows a structured lifecycle designed
        to protect you against accidental loss while honoring your right to
        erasure.
      </p>
      <p>
        <strong>30-day grace period.</strong> When you (or an admin acting on
        your behalf) schedule deletion of your account, your account enters a
        30-day grace period. During this window, you can sign in and click
        "Reactivate my account" on the gate page to cancel the deletion. The
        reactivation is fully recoverable; nothing is lost during grace, and
        your data, settings, history, and connected integrations remain
        intact.
      </p>
      <p>
        <strong>Anonymization at day 30 (or sooner if you request immediate
        deletion).</strong> After 30 days — or immediately, if you or an
        admin chooses to anonymize without waiting out the grace period —
        your profile data (name, phone number, date of birth, gender, avatar
        image) is permanently scrubbed and replaced with the placeholder
        "Deleted User." Your authentication credentials (email, password
        hash) are scrubbed and banned from re-registration. Your training
        data — efforts, bodyweight history, calorie and food logs, ROM
        records, calorie plan, wearable-synced data — is permanently
        deleted. Anonymization is irreversible.
      </p>
      <p>
        <strong>Retained for legal compliance (10-year hold).</strong> A
        narrow set of records is retained for ten years after anonymization
        to satisfy GDPR Article 17(3) (the right-to-erasure carve-out for
        legal and financial recordkeeping), United States tax retention
        requirements, and fraud / safety investigation needs. The retained
        records are:
      </p>
      <ul>
        <li>
          The <strong>deleted_account_archive</strong> snapshot — a single
          row capturing your original email address, phone number, name,
          date of birth, gender, Stripe customer id (if any), and account
          role at the moment of anonymization.
        </li>
        <li>
          Your <strong>chat history</strong> with any coach or client (for
          coaches) you exchanged messages with.
        </li>
        <li>
          Your <strong>billing events</strong> — subscription payments,
          refunds, invoices, and dispute records.
        </li>
      </ul>
      <p>
        The retained chat messages are accessible only to MyRX administrators
        via an audit-logged Export Conversation tool. Every export writes a
        row to an admin access log capturing who exported, when, the stated
        reason, and how many messages were included. The retained billing
        records are accessible only to administrators via an audit-logged
        Export Billing tool with the same access-log pattern.
      </p>
      <p>
        You may revoke your access to platform features at any time by
        scheduling deletion. Once anonymization completes, it cannot be
        undone — there is no path to restore an anonymized account.
      </p>

      <h2>8. Your rights</h2>

      <h3>8.1 General rights (all users)</h3>
      <ul>
        <li><strong>Access</strong> — request a copy of the information we hold about you.</li>
        <li>
          <strong>Correction</strong> — ask us to correct information that is
          inaccurate or incomplete. Most fields can be edited directly in your profile.
        </li>
        <li><strong>Deletion</strong> — request that we delete your account and personal information.</li>
        <li><strong>Portability</strong> — receive your data in a structured, machine-readable format.</li>
        <li>
          <strong>Withdraw consent</strong> — where we process your data based
          on consent, withdraw it at any time without affecting the lawfulness
          of processing before withdrawal.
        </li>
      </ul>
      <p>
        To exercise any of these rights, email{' '}
        <a href="mailto:privacy@myrxfit.com">privacy@myrxfit.com</a>. We will
        respond within 30 days. We may need to verify your identity before
        responding.
      </p>

      <h3>8.2 Residents of California (CCPA / CPRA)</h3>
      <p>If you are a California resident, you have the additional rights to:</p>
      <ul>
        <li>
          Know what categories of personal information we collect, the
          purposes for which we use it, and the categories of third parties
          with whom we share it.
        </li>
        <li>
          Opt out of "sale" or "sharing" of personal information for
          cross-context behavioral advertising. <strong>We do not sell or share
          your personal information for these purposes.</strong>
        </li>
        <li>
          Limit the use of "sensitive personal information." We do not use
          sensitive personal information for purposes beyond those permitted by law.
        </li>
        <li>Be free from retaliation for exercising your rights.</li>
      </ul>

      <h3>8.3 Residents of the EU, UK, and Switzerland (GDPR / UK GDPR)</h3>
      <p>In addition to the General Rights above, you have the right to:</p>
      <ul>
        <li><strong>Object</strong> to processing based on legitimate interests.</li>
        <li><strong>Restrict</strong> processing in certain circumstances.</li>
        <li>
          <strong>Lodge a complaint</strong> with your local data protection
          authority. A list is available at{' '}
          <a href="https://edpb.europa.eu/about-edpb/board/members_en" target="_blank" rel="noreferrer">
            edpb.europa.eu/about-edpb/board/members_en
          </a>.
        </li>
      </ul>

      <h2>9. International data transfers</h2>
      <p>
        The Service and our service providers are based in the United States.
        By using the Service, you understand that your information may be
        transferred to, stored, and processed in the United States or other
        countries that may have different data protection laws than your
        country of residence.
      </p>
      <p>
        For transfers from the EU, UK, or Switzerland to the United States,
        we rely on Standard Contractual Clauses approved by the European
        Commission and additional technical and organizational measures to
        protect your information.
      </p>

      <h2>10. Security</h2>
      <p>
        We use industry-standard technical and organizational measures to
        protect your information from loss, theft, misuse, and unauthorized
        access. These include:
      </p>
      <ul>
        <li>Encryption in transit (TLS 1.2 or higher) and at rest</li>
        <li>Secure password hashing handled by our authentication provider</li>
        <li>Access controls and least-privilege permissions for our team</li>
        <li>Regular security reviews and dependency updates</li>
        <li>Encrypted device-local storage (iOS Keychain / Android Keystore) for biometric credentials</li>
      </ul>
      <p>
        No system is perfectly secure. While we strive to protect your
        information, we cannot guarantee absolute security. If you become
        aware of a security issue with the Service, please report it to{' '}
        <a href="mailto:privacy@myrxfit.com">privacy@myrxfit.com</a>.
      </p>

      <h2>11. Children's privacy</h2>
      <p>
        The Service is not directed to children under 13, and we do not
        knowingly collect personal information from children under 13. If we
        learn we have collected information from a child under 13, we will
        delete it promptly. If you are a parent or guardian and believe your
        child has provided us with personal information, contact us at{' '}
        <a href="mailto:privacy@myrxfit.com">privacy@myrxfit.com</a>.
      </p>
      <p>
        If you are in the EU, UK, or another jurisdiction where a higher
        minimum age applies (typically 16), you must be at least that age
        to use the Service.
      </p>

      <h2>12. Marketing communications</h2>
      <p>
        We may send you marketing communications (newsletters, promotional
        offers, re-engagement messages, product announcements) by email or
        push notification only after you have opted in. You can opt out at
        any time by:
      </p>
      <ul>
        <li>Tapping the unsubscribe link in any marketing email</li>
        <li>Disabling marketing notifications in app Settings</li>
        <li>Contacting us at <a href="mailto:privacy@myrxfit.com">privacy@myrxfit.com</a></li>
      </ul>
      <p>
        We will continue to send you transactional messages — verification
        codes, password resets, security alerts, billing receipts, and similar
        — regardless of your marketing preferences, because these are
        necessary to provide the Service.
      </p>

      <h2>13. Cookies and similar technologies</h2>
      <p>
        The MyRX website uses cookies and similar technologies to authenticate
        you, remember your preferences, and analyze usage. For more
        information, see our <a href="/cookies">Cookie Policy</a>. The mobile
        app does not use browser cookies but stores comparable data locally
        in encrypted device storage (iOS Keychain / Android Keystore) and
        AsyncStorage for the same purposes.
      </p>

      <h2>14. Changes to this policy</h2>
      <p>
        We may update this Policy from time to time. The "Effective date" at
        the top of this page reflects the latest revision. If we make
        material changes, we will notify you in advance — by email, in-app
        banner, or both — and where required by law we will obtain your
        renewed consent before the new Policy takes effect for you.
      </p>

      <h2>15. Contact us</h2>
      <p>
        If you have questions, complaints, or requests about this Policy or
        our handling of your personal information, contact us at:
      </p>
      <p>
        <strong>Northern Princess LLC</strong><br />
        Doing business as MyRX<br />
        Registered in: Michigan, USA<br />
        Email: <a href="mailto:privacy@myrxfit.com">privacy@myrxfit.com</a>
      </p>
    </LegalLayout>
  )
}
