import LegalLayout from './LegalLayout'

export default function AcceptableUsePolicy() {
  return (
    <LegalLayout title="Acceptable Use Policy" effectiveDate="May 9, 2026">
      <h2>1. Purpose</h2>
      <p>
        This Acceptable Use Policy ("AUP") describes how you may and may
        not use the MyRX mobile application, website, and related services
        (the "Service") operated by Northern Princess LLC. It is incorporated
        into our <a href="/terms">Terms of Service</a> by reference.
      </p>
      <p>
        Violations of this AUP may result in temporary suspension or
        permanent termination of your account, removal of content, and
        (where applicable) reporting to law enforcement.
      </p>

      <h2>2. Prohibited content</h2>
      <p>You may not post, upload, transmit, or share any content that:</p>
      <ul>
        <li>Is unlawful, defamatory, or fraudulent</li>
        <li>
          Sexualizes or exploits minors, or includes any child sexual abuse
          material (CSAM)
        </li>
        <li>
          Promotes, glorifies, or instructs on serious self-harm, suicide,
          eating disorders, or violence against any individual or group
        </li>
        <li>
          Contains harassment, threats, hate speech, or content directed at
          a person or group based on race, ethnicity, national origin,
          religion, sex, gender identity, sexual orientation, age, or
          disability
        </li>
        <li>Infringes any patent, trademark, copyright, trade secret, or other intellectual property right</li>
        <li>Contains malicious code, malware, viruses, or anything designed to disrupt the Service or other systems</li>
        <li>Violates the privacy or publicity rights of others</li>
        <li>
          Constitutes medical advice, diagnosis, prescription, or any
          regulated healthcare service
        </li>
        <li>Contains spam, scams, pyramid schemes, or unsolicited promotional material</li>
      </ul>

      <h2>3. Prohibited conduct</h2>
      <p>You may not:</p>
      <ul>
        <li>Create an account using false information or impersonate any person or entity</li>
        <li>Share your account credentials or use someone else's account without their permission</li>
        <li>
          Attempt to gain unauthorized access to any part of the Service,
          another user's account, or our infrastructure
        </li>
        <li>
          Probe, scan, or test the vulnerability of any system or network
          without our prior written consent (responsible-disclosure
          security research is an exception — see Section 6)
        </li>
        <li>
          Reverse engineer, decompile, or disassemble any part of the Service,
          except to the extent permitted by applicable law
        </li>
        <li>
          Use bots, scrapers, or any automated tool to access the Service
          beyond what is needed for normal individual use
        </li>
        <li>
          Resell, rent, or sublicense your access to the Service unless
          expressly authorized in writing (this includes re-exposing the
          API or repackaging the Service for others)
        </li>
        <li>
          Interfere with the operation of the Service, e.g. by overloading
          servers, deliberately triggering errors, or circumventing rate
          limits
        </li>
        <li>
          Use the Service in a way that violates any applicable law,
          regulation, or third-party right
        </li>
      </ul>

      <h2>4. Health and safety</h2>
      <p>
        MyRX is general fitness software, not medical software. You agree
        not to use the Service:
      </p>
      <ul>
        <li>To diagnose, treat, cure, or prevent any disease or medical condition</li>
        <li>As a substitute for professional medical advice, diagnosis, or treatment</li>
        <li>In a medical emergency (call your local emergency number instead)</li>
      </ul>

      <h2>5. Coach-specific obligations</h2>
      <p>If you are using a coach subscription, you additionally agree:</p>
      <ul>
        <li>
          Not to provide medical advice, diagnosis, prescriptions, or any
          regulated healthcare service through the Service
        </li>
        <li>
          To handle client data confidentially and use it only for the
          coaching service the client signed up for
        </li>
        <li>
          To hold any licenses, certifications, and other authorizations
          required by your jurisdiction for the coaching activities you
          conduct
        </li>
        <li>
          Not to send unsolicited messages, marketing, or promotional
          material to clients beyond what they have consented to
        </li>
        <li>
          Not to retain or repurpose client data after a client has revoked
          their consent or terminated the coaching relationship
        </li>
      </ul>

      <h2>6. Security research</h2>
      <p>
        We welcome responsible security research. If you discover a
        vulnerability, please disclose it to us privately at{' '}
        <a href="mailto:privacy@myrxfit.com">privacy@myrxfit.com</a> and
        give us a reasonable opportunity to fix it before publishing. We
        will not pursue legal action against researchers who:
      </p>
      <ul>
        <li>Test only against accounts they own or have explicit permission to test</li>
        <li>
          Avoid privacy violations, destruction of data, and interruption
          or degradation of the Service
        </li>
        <li>Disclose the issue privately first and give us reasonable time to respond</li>
      </ul>

      <h2>7. Reporting violations</h2>
      <p>
        If you become aware of any content or conduct that violates this
        AUP, please report it to{' '}
        <a href="mailto:privacy@myrxfit.com">privacy@myrxfit.com</a>. We
        review reports promptly and take appropriate action.
      </p>

      <h2>8. Enforcement</h2>
      <p>
        We may, at our sole discretion and without prior notice:
      </p>
      <ul>
        <li>Issue a warning</li>
        <li>Remove or modify content that violates this AUP</li>
        <li>Suspend or terminate your account</li>
        <li>Block access to specific features</li>
        <li>Cooperate with law enforcement and disclose information as required by law</li>
      </ul>
      <p>
        We will generally try to give notice and a chance to remedy minor
        first-time violations, but we are not required to. Severe
        violations (e.g. CSAM, threats of violence, attacks against the
        Service) may result in immediate termination without notice.
      </p>

      <h2>9. Changes to this policy</h2>
      <p>
        We may update this AUP from time to time. The "Effective date" at
        the top of this page reflects the latest revision. Material
        changes will be communicated as described in our Terms of Service.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions or reports? Email{' '}
        <a href="mailto:privacy@myrxfit.com">privacy@myrxfit.com</a>.
      </p>
    </LegalLayout>
  )
}
