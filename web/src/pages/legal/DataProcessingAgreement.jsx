import LegalLayout from './LegalLayout'

export default function DataProcessingAgreement() {
  return (
    <LegalLayout title="Data Processing Agreement" effectiveDate="May 26, 2026">
      <p>
        This Data Processing Agreement ("DPA") is entered into between you
        (the "Controller") and Northern Princess LLC, doing business as MyRX
        ("MyRX," "Processor"), and forms part of (and is subject to the terms
        of) our <a href="/terms">Terms of Service</a> and, where you are a
        Coach, our <a href="/coach-agreement">Coach Agreement</a>. It applies
        whenever you use MyRX to Process Personal Data of identifiable
        individuals (typically your Clients) and any applicable data-protection
        law — including the EU/EEA General Data Protection Regulation
        ("GDPR"), the UK GDPR and Data Protection Act 2018, and the
        California Consumer Privacy Act / California Privacy Rights Act
        ("CCPA/CPRA") — requires a written data-processing arrangement.
      </p>
      <p>
        <strong>This DPA is effective automatically upon your acceptance of
        the Coach Agreement (for Coaches) or your enabling of features that
        cause MyRX to Process Personal Data on your behalf (for other users).</strong>{' '}
        No signature is required for the DPA to take effect. A signed
        countersigned copy is available on request at{' '}
        <a href="mailto:privacy@myrxfit.com">privacy@myrxfit.com</a>.
      </p>

      <h2>1. Definitions</h2>
      <p>
        Capitalized terms not defined here have the meanings given in GDPR
        (or, where context indicates, in CCPA/CPRA or another applicable law).
        For clarity:
      </p>
      <ul>
        <li>
          <strong>Controller</strong> — the entity that determines the
          purposes and means of Processing Personal Data. For Coach-Client
          relationships on MyRX, the Coach is typically a joint Controller
          alongside MyRX with respect to that Coach's Clients.
        </li>
        <li>
          <strong>Processor</strong> — MyRX, when Processing Personal Data
          on behalf of the Controller as instructed.
        </li>
        <li>
          <strong>Subprocessor</strong> — any third party MyRX engages to
          Process Personal Data on behalf of the Controller (see Section 6).
        </li>
        <li>
          <strong>Personal Data</strong> — any information relating to an
          identified or identifiable natural person, as defined by applicable
          law.
        </li>
        <li>
          <strong>Personal Data Breach</strong> — a breach of security
          leading to the accidental or unlawful destruction, loss,
          alteration, unauthorized disclosure of, or access to, Personal Data.
        </li>
      </ul>

      <h2>2. Scope, roles, and instructions</h2>

      <h3>2.1 Roles</h3>
      <p>
        For Personal Data of Coaches' Clients that MyRX Processes within the
        coach platform:
      </p>
      <ul>
        <li>
          The Coach is a <strong>Controller</strong> with respect to the
          Client data the Coach actively manages (plans, notes, chat
          messages, exported reports).
        </li>
        <li>
          MyRX is the <strong>Controller</strong> with respect to
          platform-operational Personal Data (account credentials, billing,
          security logs, analytics).
        </li>
        <li>
          MyRX is a <strong>Processor</strong> with respect to Client data
          the Coach instructs MyRX to store, display, transmit, or compute on
          (e.g., calorie targets the Coach sets for the Client, chat
          messages between Coach and Client).
        </li>
      </ul>

      <h3>2.2 Instructions</h3>
      <p>
        MyRX Processes Personal Data only on documented instructions from the
        Controller. The documented instructions include this DPA, the Coach
        Agreement, our Terms of Service, the configuration of the MyRX
        platform that the Coach selects (e.g., "share live food log with
        coach: on"), and any additional written instructions the Coach gives
        to MyRX support. MyRX will notify the Controller if, in MyRX's
        opinion, a Controller instruction infringes GDPR or other applicable
        data-protection law.
      </p>

      <h3>2.3 Categories of Personal Data and Data Subjects</h3>
      <p>
        Personal Data Processed under this DPA typically includes (but is
        not limited to):
      </p>
      <ul>
        <li>Identifying data: name, email, phone, avatar, date of birth, gender.</li>
        <li>Body data: height, weight, weight history, body-fat band.</li>
        <li>Health and fitness data: training logs, calorie logs, food entries, mobility ROM, heart-rate samples, sleep duration / staging, hydration, step counts.</li>
        <li>Wearable-synced data from connected devices (Samsung Health, Apple Health, Garmin, Whoop, Polar, Fitbit, Strava).</li>
        <li>Communications: messages exchanged between Coach and Client in the in-app chat.</li>
      </ul>
      <p>
        Data Subjects are the Clients in the Coach's roster on MyRX.
      </p>

      <h3>2.4 Duration</h3>
      <p>
        MyRX Processes Personal Data for the duration of the coaching
        relationship between the Coach and the Client on MyRX, plus the
        retention period defined in our{' '}
        <a href="/privacy">Privacy Policy</a>. On termination of the coaching
        relationship, MyRX deletes the Coach's access to that Client's data
        immediately and applies the Privacy Policy's retention rules to the
        underlying Client records.
      </p>

      <h2>3. Confidentiality</h2>
      <p>
        MyRX ensures that personnel authorized to Process Personal Data are
        subject to written confidentiality obligations or are under an
        appropriate statutory obligation of confidentiality. Access is
        granted on a need-to-know basis and is logged.
      </p>

      <h2>4. Security measures</h2>
      <p>
        MyRX has implemented and maintains appropriate technical and
        organizational measures to protect Personal Data against accidental
        or unlawful destruction, loss, alteration, unauthorized disclosure,
        or access. These measures include:
      </p>
      <ul>
        <li>Encryption of Personal Data in transit (TLS 1.2+ for all client-server traffic) and at rest (database-level encryption via Supabase / Postgres).</li>
        <li>Role-based access control with row-level security (RLS) at the database layer; Coaches can only read data of Clients in their own roster, enforced server-side.</li>
        <li>Strong authentication for staff (multi-factor authentication required for production-system access).</li>
        <li>Logging of authentication events, administrative actions, and access to sensitive data; retention of these logs for at least 12 months.</li>
        <li>Regular vulnerability scanning of dependencies; timely patching of high-severity issues.</li>
        <li>Secret management: credentials and API keys stored in encrypted secret stores (Supabase Edge Function secrets, Cloudflare Worker secrets) — never in source control.</li>
        <li>Backup and disaster-recovery: Supabase point-in-time recovery enabled with a configurable retention window; restore procedures tested periodically.</li>
        <li>Incident-response plan with defined notification timelines (see Section 8).</li>
      </ul>
      <p>
        These measures are reviewed regularly. We may update them to reflect
        changes in technology or risk, provided the updated measures do not
        materially reduce the level of protection.
      </p>

      <h2>5. Data-subject requests</h2>
      <p>
        MyRX provides functionality within the platform that lets Controllers
        respond to Data Subject Requests (access, rectification, erasure,
        restriction, portability, objection) for their Clients:
      </p>
      <ul>
        <li>Clients can export their data from their own account at any time.</li>
        <li>Clients can delete their account (and trigger erasure of their data, subject to legal retention obligations) from their own account.</li>
        <li>Coaches can request that MyRX assist with a specific data-subject request for one of their Clients by emailing{' '}
          <a href="mailto:privacy@myrxfit.com">privacy@myrxfit.com</a>.
        </li>
      </ul>
      <p>
        MyRX will assist the Controller in fulfilling Data Subject Requests
        within the statutory response window (typically 30 days under GDPR,
        45 days under CCPA), insofar as the Controller cannot self-serve
        through the platform.
      </p>

      <h2>6. Subprocessors</h2>

      <h3>6.1 Authorization</h3>
      <p>
        The Controller authorizes MyRX to engage Subprocessors to Process
        Personal Data, subject to the conditions in this Section. MyRX
        remains responsible for the Subprocessor's performance.
      </p>

      <h3>6.2 Current Subprocessors</h3>
      <p>
        MyRX uses the following Subprocessors as of the Effective Date:
      </p>
      <ul>
        <li>
          <strong>Supabase, Inc.</strong> (US) — Postgres database, Auth,
          Edge Functions, Storage. Hosts all primary Personal Data. EU data
          residency available on request for EU-resident Controllers.
        </li>
        <li>
          <strong>Cloudflare, Inc.</strong> (US) — CDN, web hosting (Pages),
          serverless workers, D1 (food library), R2 (file mirrors). Handles
          incoming traffic; no primary Personal Data storage beyond logs.
        </li>
        <li>
          <strong>Stripe, Inc.</strong> (US) — Payment processing for coach
          subscriptions and B2C purchases. Processes billing identifiers,
          payment-method tokens, transaction metadata. Stripe itself is a
          Controller for payment-card data (PCI scope) and a Processor for
          our customer billing metadata.
        </li>
        <li>
          <strong>Twilio Inc.</strong> (US) — SMS for phone-number
          verification (Twilio Verify). Processes phone numbers and OTP
          codes for the duration of a verification attempt.
        </li>
        <li>
          <strong>Resend / SendGrid / equivalent</strong> (US) — Transactional
          email (signup OTPs, password resets, billing notifications).
          Processes email addresses and message content. The specific
          provider may change; the current provider is disclosed on request.
        </li>
        <li>
          <strong>Samsung Electronics Co., Ltd.</strong> (KR) — Samsung
          Health Data SDK for wearable HR / step / workout sync. Data flows
          from the user's Samsung Health on device → MyRX mobile app → MyRX
          database; Samsung does not receive data from MyRX in return.
        </li>
        <li>
          <strong>Apple Inc.</strong> (US) — HealthKit on iOS for wearable
          sync (pending). Same one-way flow as Samsung.
        </li>
        <li>
          <strong>Google LLC</strong> (US) — Health Connect on Android for
          wearable sync (fallback path). Same one-way flow.
        </li>
        <li>
          <strong>Strava, Garmin, Whoop, Polar, Fitbit</strong> — Wearable /
          fitness integrations (pending). Each integrated provider becomes a
          Subprocessor on activation.
        </li>
      </ul>
      <p>
        For each Subprocessor, MyRX has a written agreement that imposes
        data-protection obligations no less protective than this DPA.
      </p>

      <h3>6.3 Notification of new Subprocessors</h3>
      <p>
        MyRX will notify the Controller of any addition or replacement of
        Subprocessors at least <strong>30 days</strong> in advance, by email
        to the account-of-record address or via in-app notification, giving
        the Controller the opportunity to object on reasonable data-protection
        grounds. If the Controller objects on such grounds and the parties
        cannot agree on a resolution, the Controller may terminate the
        portion of the Service that relies on the new Subprocessor (typically
        meaning cancelling the coach subscription with pro-rated refund per
        the <a href="/refund-policy">Refund Policy</a>).
      </p>

      <h2>7. International transfers</h2>
      <p>
        MyRX is established in the United States. To the extent we transfer
        Personal Data from the EU/EEA, the UK, or other jurisdictions with
        cross-border-transfer restrictions to the US (or to a Subprocessor
        located in a third country), the transfer is conducted under
        appropriate safeguards, including:
      </p>
      <ul>
        <li>The EU Standard Contractual Clauses ("SCCs") in the modules applicable to the transfer (Controller-to-Processor; Processor-to-Subprocessor), incorporated by reference into this DPA.</li>
        <li>The UK International Data Transfer Addendum to the SCCs for transfers from the UK.</li>
        <li>Supplementary technical and organizational measures as described in Section 4 (encryption in transit and at rest, strong access controls).</li>
      </ul>
      <p>
        If a Subprocessor is certified under a recognized adequacy framework
        (e.g., EU-US Data Privacy Framework), that framework also applies in
        addition to the SCCs.
      </p>

      <h2>8. Personal Data Breach notification</h2>
      <p>
        MyRX will notify the Controller without undue delay — and in any
        event within <strong>72 hours</strong> — of becoming aware of a
        Personal Data Breach affecting the Controller's Personal Data. The
        notification will include, to the extent known at the time of
        notification:
      </p>
      <ul>
        <li>The nature of the breach.</li>
        <li>The categories and approximate number of Data Subjects and Personal Data records affected.</li>
        <li>The likely consequences.</li>
        <li>The measures taken or proposed to address the breach and mitigate its effects.</li>
      </ul>
      <p>
        If full information is not available within 72 hours, MyRX will
        provide it in phases as it becomes available.
      </p>

      <h2>9. Audits and compliance</h2>
      <p>
        On reasonable written request (and no more than once per 12-month
        period, unless required by a supervisory authority), MyRX will
        provide the Controller with:
      </p>
      <ul>
        <li>The most recent SOC 2 Type II report (or equivalent independent attestation) of MyRX's primary Subprocessor (Supabase), to the extent that MyRX is permitted to disclose it.</li>
        <li>A written response to the Controller's reasonable security questionnaire.</li>
        <li>Where the above are insufficient to demonstrate compliance, MyRX will allow an on-site audit by the Controller (or an independent auditor agreed in writing) during normal business hours, with at least 30 days advance notice, at the Controller's cost.</li>
      </ul>
      <p>
        Information disclosed in connection with an audit is subject to the
        confidentiality obligations of the Coach Agreement and may not be
        used for any purpose other than verifying MyRX's compliance with
        this DPA.
      </p>

      <h2>10. Deletion or return of Personal Data</h2>
      <p>
        On termination of the underlying agreement (Coach Agreement or
        Terms of Service), and at the Controller's choice, MyRX will either
        delete or return all Personal Data Processed on the Controller's
        behalf, and delete existing copies, unless retention is required by
        law (e.g., tax / accounting records). MyRX's default behavior on
        termination is deletion in accordance with the retention schedule
        in our Privacy Policy; the Controller may request return-then-
        deletion in writing.
      </p>

      <h2>11. Liability</h2>
      <p>
        The liability of each party under this DPA is subject to the
        limitations and exclusions of liability set out in the underlying
        agreement (Coach Agreement and Terms of Service). Nothing in this
        DPA excludes either party's liability for fines imposed by a
        supervisory authority under GDPR Art. 83 or comparable provisions of
        other data-protection law, to the extent that liability is allocated
        to the party at fault.
      </p>

      <h2>12. Order of precedence</h2>
      <p>
        If there is a conflict between this DPA and the Coach Agreement /
        Terms of Service / Privacy Policy with respect to Processing of
        Personal Data, this DPA prevails. The SCCs (where incorporated)
        prevail over this DPA.
      </p>

      <h2>13. Changes to this DPA</h2>
      <p>
        We may update this DPA from time to time to reflect changes in law,
        regulatory guidance, our security practices, or our Subprocessor
        list. Material changes will be communicated by email with at least
        30 days advance notice. Continued use of the Service after the
        effective date constitutes acceptance.
      </p>

      <h2>14. Contact</h2>
      <p>
        Data-protection contact:{' '}
        <a href="mailto:privacy@myrxfit.com">privacy@myrxfit.com</a>.
        Northern Princess LLC, Michigan, USA. For inquiries from EU/EEA
        Data Subjects requiring a representative in the Union, contact us
        at the same address and we will route the inquiry appropriately.
      </p>
    </LegalLayout>
  )
}
