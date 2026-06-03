import LegalLayout from './LegalLayout'

export default function CoachAgreement() {
  return (
    <LegalLayout title="Coach Agreement" effectiveDate="May 26, 2026">
      <h2>1. Who this Agreement is between</h2>
      <p>
        This Coach Agreement ("Agreement") is between you (the individual or
        business operating as a "Coach") and Northern Princess LLC, a Michigan
        limited liability company, doing business as MyRX ("MyRX," "we," "us,"
        or "our"). It governs your use of the MyRX coach platform — the admin
        portal, the client roster, the coaching prescription tools, and the
        coach billing relationship — and supplements (but does not replace) our
        general <a href="/terms">Terms of Service</a> and{' '}
        <a href="/privacy">Privacy Policy</a>, which still apply to you in your
        capacity as a MyRX user.
      </p>
      <p>
        <strong>By starting a coach subscription, creating coach invites, or
        accepting clients into your roster, you agree to this Agreement.</strong>{' '}
        If you do not agree, do not use the coach platform.
      </p>

      <h2>2. What the coach platform is</h2>
      <p>
        The MyRX coach platform lets you:
      </p>
      <ul>
        <li>Invite end users ("Clients") to join your roster.</li>
        <li>View Clients' training data, body data, food logs, heart-rate samples, sleep, hydration, and any other data they have logged in MyRX or synced from a connected wearable.</li>
        <li>Set or override Clients' calorie / macro targets, training plans, and progression goals.</li>
        <li>Message Clients via the in-app chat, send coaching suggestions, and post adjustments.</li>
        <li>Access analytics and reports across your roster.</li>
      </ul>
      <p>
        You also receive a full personal MyRX athlete account included with
        your subscription — the same client app your Clients use — for your own
        training, at no extra cost.
      </p>

      <h2>3. Subscription, billing, and auto-renewal</h2>

      <h3>3.1 Tiers</h3>
      <p>
        The coach platform is offered in three tiers, with the only material
        difference being the maximum number of Clients you can have in your
        roster at one time:
      </p>
      <ul>
        <li><strong>Starter</strong> — up to 10 Clients, $19/month or $189 for the first year.</li>
        <li><strong>Pro</strong> — up to 25 Clients, $39/month or $389 for the first year.</li>
        <li><strong>Elite</strong> — unlimited Clients, $99/month or $989 for the first year.</li>
      </ul>
      <p>
        Annual prices reflect a first-year promotional discount of approximately
        17 % (roughly two months free). At renewal, annual subscriptions renew at
        the full annual rate of the then-current monthly price multiplied by
        twelve (e.g., $228, $468, $1,188 for Starter, Pro, Elite respectively
        at current pricing). Renewal pricing is disclosed at the time of
        checkout on every annual price quote.
      </p>

      <h3>3.2 Free trial</h3>
      <p>
        Every coach subscription includes a 14-day free trial. You must enter a
        payment method at signup, but you are not charged on day 1. Your first
        charge happens on day 15 unless you cancel before the trial ends.
      </p>

      <h3>3.3 Auto-renewal disclosure</h3>
      <p>
        <strong>Coach subscriptions renew automatically.</strong> Monthly
        subscriptions renew every month on the calendar day matching your trial-
        end date. Annual subscriptions renew every twelve months on the calendar
        day matching your trial-end date. By starting a paid subscription you
        authorize us (or our payment processor, Stripe) to charge your saved
        payment method for each renewal at the then-current price for your tier
        and billing cadence until you cancel.
      </p>
      <p>
        You can cancel at any time, with no early-termination fee. Cancellation
        stops future charges; it does not refund the current billing period
        unless required by law (see Section 3.5 and our{' '}
        <a href="/refund-policy">Refund Policy</a>).
      </p>

      <h3>3.4 Switching tiers</h3>
      <p>
        Upgrades take effect immediately and your Client cap expands at once;
        billing is pro-rated for the remainder of the period. Downgrades take
        effect at the next billing cycle, so you keep the higher cap for the
        rest of the period you have already paid for. If a downgrade would put
        you above the new tier's Client cap, you must remove or suspend Clients
        before the downgrade takes effect; we will not auto-disconnect Clients
        on your behalf.
      </p>

      <h3>3.5 Refunds</h3>
      <p>
        Refund mechanics for coach subscriptions are governed by our{' '}
        <a href="/refund-policy">Refund Policy</a>, which is incorporated into
        this Agreement by reference.
      </p>

      <h3>3.6 Price changes</h3>
      <p>
        We may change subscription prices. Changes affect future renewals only,
        not the period you have already paid for, and we will give you at least
        30 days advance notice by email before any price change takes effect on
        your account.
      </p>

      <h2>4. Client data you can access</h2>
      <p>
        When a Client accepts your invite, the Client grants you scoped access
        to their MyRX data, including:
      </p>
      <ul>
        <li>Identifying information (name, email, phone, avatar) the Client provided to MyRX.</li>
        <li>Body data (age, gender, weight, height, body-fat band) and weight history.</li>
        <li>Training logs across Strength, Cardio, and any other surface MyRX adds.</li>
        <li>Food logs, calorie targets, and macro splits.</li>
        <li>Heart-rate samples, sleep data, hydration entries, step counts, and other wearable-synced data.</li>
        <li>Chat messages exchanged between you and that Client.</li>
        <li>The Client's history with you on the platform (date connected, plans assigned, notes, etc.).</li>
      </ul>
      <p>
        You may use this data <strong>only</strong> to coach that specific
        Client. You may not:
      </p>
      <ul>
        <li>Sell, share, or transfer Client data to any third party, including other coaches.</li>
        <li>Use Client data to train machine-learning models, build derivative datasets, or for any commercial purpose beyond coaching that Client.</li>
        <li>Retain Client data after the Client disconnects from your roster, except for the limited subset MyRX permits you to retain for your own historical records (currently: summary metadata about the duration of the coaching relationship and aggregate progress milestones — never raw logs or PII).</li>
        <li>Access data of any individual who is not a Client in your roster, including via screen scraping, API misuse, or social-engineering MyRX support.</li>
      </ul>
      <p>
        With respect to your Clients' personal data, you act as an independent
        controller (alongside MyRX), and you are responsible for complying with
        the data-protection laws that apply to your relationship with that
        Client (e.g., GDPR if you are coaching an EU resident). If you process
        Client data on behalf of an employer or other entity, you may need a
        separate Data Processing Agreement with MyRX; see our{' '}
        <a href="/dpa">DPA</a>.
      </p>

      <h2>5. Code of Conduct</h2>
      <p>
        You agree to conduct yourself professionally on the MyRX platform. This
        means, at a minimum:
      </p>
      <ul>
        <li>
          <strong>Respect.</strong> No harassment, discrimination, threats, or
          abusive language toward Clients, MyRX staff, or other coaches.
        </li>
        <li>
          <strong>Honesty about credentials.</strong> Do not claim certifications,
          licenses, or expertise you do not have. If MyRX flags an account as
          "licensed" (e.g., RD, RDN, NSCA-CSCS, CPT), you must hold and maintain
          the represented credential in good standing.
        </li>
        <li>
          <strong>No medical claims.</strong> You may not diagnose medical
          conditions, prescribe medication, claim to treat or cure any disease,
          or provide nutrition advice that crosses into medical nutrition
          therapy (MNT) unless you are an appropriately licensed professional
          and have disclosed that to your Client. See our{' '}
          <a href="/health-disclaimer">Health & Medical Disclaimer</a>.
        </li>
        <li>
          <strong>Reasonable responsiveness.</strong> If you offer a Client
          chat-based coaching, respond within a reasonable timeframe (typically
          within 72 hours of message receipt). If you go on vacation or need a
          break, communicate it.
        </li>
        <li>
          <strong>Client autonomy.</strong> Do not pressure Clients to log
          inaccurate data, hide setbacks from themselves, or continue training
          while injured.
        </li>
        <li>
          <strong>Confidentiality.</strong> Do not discuss one Client's data,
          progress, or struggles with another Client or any third party.
        </li>
      </ul>

      <h2>6. Acceptable Use</h2>
      <p>
        In addition to this Agreement, you are bound by the MyRX{' '}
        <a href="/acceptable-use">Acceptable Use Policy</a>, which prohibits
        scraping, spam, impersonation, illegal activity, abuse of MyRX systems,
        and similar conduct. Material breach of the AUP is also a material
        breach of this Agreement.
      </p>

      <h2>7. Independent-contractor relationship; no agency</h2>
      <p>
        You and MyRX are independent contractors. Nothing in this Agreement
        creates an employment, agency, partnership, joint-venture, or fiduciary
        relationship between you and MyRX. You alone are responsible for:
      </p>
      <ul>
        <li>Your taxes (income, self-employment, sales/use as applicable).</li>
        <li>Your business licensing in your jurisdiction.</li>
        <li>Your professional insurance (e.g., professional liability for personal trainers, dietitians).</li>
        <li>Any agreements you enter into directly with Clients (e.g., a side coaching contract, a refund policy you offer Clients on top of MyRX's).</li>
      </ul>
      <p>
        MyRX is not a party to the coaching relationship you have with your
        Client. We provide the platform; you provide the coaching. MyRX does
        not endorse, vet, or guarantee any individual coach's competence,
        results, advice, or outcomes, and does not act on behalf of any coach
        in the coach-Client relationship.
      </p>

      <h2>8. Indemnification</h2>
      <p>
        You agree to defend, indemnify, and hold harmless MyRX and its
        officers, directors, employees, contractors, and agents from and
        against any claim, demand, loss, liability, damage, or expense
        (including reasonable attorneys' fees) arising out of or related to:
      </p>
      <ul>
        <li>The coaching advice, programs, or content you deliver to any Client.</li>
        <li>Any injury, illness, or adverse outcome a Client experiences in connection with following your advice.</li>
        <li>Your breach of this Agreement, our Terms of Service, our Acceptable Use Policy, or any applicable law.</li>
        <li>Your handling, transfer, or disclosure of Client data in violation of this Agreement.</li>
        <li>Any side agreement you have with a Client and any dispute arising from that side agreement.</li>
      </ul>
      <p>
        We reserve the right to assume the exclusive defense and control of any
        matter for which you are required to indemnify us. You agree to
        cooperate fully with our defense of any such claim. You will not settle
        any claim without our prior written consent if the settlement requires
        any payment or admission by MyRX.
      </p>

      <h2>9. Suspension and termination</h2>

      <h3>9.1 Your termination right</h3>
      <p>
        You can cancel your subscription at any time, with no early-termination
        fee, via your account billing settings. Cancellation stops future
        charges and ends your access to the coach platform at the end of your
        current billing period. Your Clients are notified and given the option
        to continue with MyRX as self-coached athletes (their data is
        preserved); MyRX does not transfer your Clients to another coach
        without each Client's explicit consent.
      </p>

      <h3>9.2 Our termination right</h3>
      <p>
        We may suspend or terminate your coach account, with or without notice,
        if:
      </p>
      <ul>
        <li>You materially breach this Agreement, the Terms of Service, the AUP, or any applicable law.</li>
        <li>You misrepresent professional credentials.</li>
        <li>A Client reports conduct that, in our reasonable judgment, places the Client at risk of harm.</li>
        <li>You repeatedly fail to respond to Clients in the chat-based coaching window you committed to.</li>
        <li>You attempt to circumvent MyRX (e.g., systematically convincing Clients to move off-platform to avoid Client-cap or subscription fees).</li>
        <li>Your subscription payment fails and is not cured within 14 days of a payment-failure notice.</li>
      </ul>
      <p>
        Suspension may include temporary loss of access to your roster.
        Termination ends your subscription, removes your access permanently,
        and (where the termination is for cause) does not entitle you to a
        refund of the current billing period. Termination does not retroactively
        terminate your obligations under Sections 4 (data), 5 (conduct), or 8
        (indemnification), which survive.
      </p>

      <h3>9.3 Effect of termination on Clients</h3>
      <p>
        When your coach account ends (for any reason), each of your Clients is
        notified. They continue to have full access to their MyRX account and
        all data they have logged. They are offered the option to be matched
        with another MyRX coach or to continue as a self-coached athlete. We
        will not delete a Client's data because you have terminated.
      </p>

      <h3>9.4 Account termination — coach data handling</h3>
      <p>
        You may self-delete your coach account at any time via Settings →
        Danger zone → Delete account. The same 30-day grace period that
        applies to athlete accounts applies to coach accounts: during the
        grace window you can sign in and reactivate; nothing is lost.
        See our <a href="/privacy">Privacy Policy</a> for the full lifecycle.
      </p>
      <p>
        <strong>Effect on your roster on anonymization.</strong> When your
        coach account anonymizes — at the end of the grace period or
        immediately on request — every Client in your roster is
        automatically unlinked from your account. Their coach_id is cleared
        and they become self-managed athletes. They retain full access to
        all of their own training data, body data, food logs, and history;
        nothing belonging to a Client is deleted as a consequence of your
        deletion.
      </p>
      <p>
        <strong>Subscription handling.</strong> Your Stripe subscription is
        paused for the duration of the 30-day grace period. If anonymization
        completes, the subscription is cancelled. Pro-rated refunds (if any)
        are governed by our <a href="/refund-policy">Refund Policy</a>.
      </p>
      <p>
        <strong>Chat history retention.</strong> Chat history between you and
        each of your Clients is retained for ten years after anonymization
        for legal compliance, and is accessible only to MyRX administrators
        via the audit-logged Export Conversation tool described in the
        Privacy Policy. Your former Clients do not lose access to their own
        side of the conversation, but the thread now shows your side as
        "Deleted User."
      </p>
      <p>
        <strong>Billing records retention.</strong> Subscription payments,
        refunds, and dispute records are retained for ten years per United
        States tax retention requirements, and accessible only to
        administrators via an audit-logged Export Billing tool.
      </p>

      <h2>10. Intellectual property</h2>

      <h3>10.1 Your content</h3>
      <p>
        Coaching plans, notes, messages, and other content you create on the
        MyRX platform ("Coach Content") remain your intellectual property. You
        grant MyRX a non-exclusive, worldwide, royalty-free license to host,
        display, transmit, and process Coach Content as necessary to operate
        the Service for you and your Clients (e.g., displaying a training plan
        on your Client's device, generating PDF exports). This license ends
        when the Coach Content is deleted from MyRX, with the exception of
        backups that are retained for the retention period in our Privacy Policy.
      </p>

      <h3>10.2 MyRX content</h3>
      <p>
        MyRX-generated content — including the coaching prescription engine
        outputs, the formula library, the tier templates, and the platform UI
        — remains MyRX's intellectual property. You may use it within MyRX to
        coach your Clients; you may not copy, reverse-engineer, redistribute,
        or use it to build a competing product.
      </p>

      <h2>11. Confidentiality</h2>
      <p>
        You may receive non-public information about the MyRX platform (e.g.,
        unreleased features in a beta, internal pricing tools). You agree to
        keep this information confidential and not disclose it to third parties
        without our prior written consent, except as required by law.
      </p>

      <h2>12. Warranties and disclaimers</h2>
      <p>
        The coach platform is provided <strong>as-is</strong> and{' '}
        <strong>as-available</strong>. MyRX makes no warranty that the
        platform will meet your business expectations, generate any specific
        number of Clients, produce any specific coaching outcome, or be
        uninterrupted or error-free. We disclaim all implied warranties of
        merchantability, fitness for a particular purpose, and non-infringement
        to the maximum extent permitted by law.
      </p>

      <h2>13. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, MyRX's total liability to you
        under this Agreement is limited to the greater of (a) the amount you
        paid MyRX for the coach subscription in the 12 months preceding the
        event giving rise to the claim, or (b) $100. MyRX is not liable for
        any indirect, incidental, special, consequential, exemplary, or
        punitive damages, including lost profits, lost Clients, loss of
        goodwill, or loss of data.
      </p>
      <p>
        These limitations do not apply where they are not permitted by law
        (e.g., for gross negligence, willful misconduct, or — in some
        jurisdictions — personal-injury claims).
      </p>

      <h2>14. Governing law and disputes</h2>
      <p>
        This Agreement is governed by the laws of the State of Michigan,
        without regard to its conflict-of-laws principles. Disputes are
        resolved exclusively in the state or federal courts located in
        Washtenaw County, Michigan, and you consent to personal jurisdiction
        in those courts.
      </p>
      <p>
        Nothing in this Section limits your right to pursue small-claims
        actions in your local court for amounts within that court's
        jurisdictional limit, or to pursue injunctive relief in any court of
        competent jurisdiction.
      </p>

      <h2>15. Changes to this Agreement</h2>
      <p>
        We may update this Agreement from time to time. Material changes (e.g.,
        new fees, new obligations on you) will be communicated by email at
        least 30 days before they take effect on your account; you may
        terminate your subscription before the changes take effect if you do
        not agree. Continued use of the coach platform after the effective
        date constitutes acceptance.
      </p>

      <h2>16. Contact</h2>
      <p>
        Questions about this Agreement? Email{' '}
        <a href="mailto:coaches@myrxfit.com">coaches@myrxfit.com</a>.
      </p>
    </LegalLayout>
  )
}
