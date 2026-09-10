// Single source of truth for Terms of Service / Privacy Policy body content,
// loaded by both index.html and app.html so the text only ever exists in one
// place. Each host provides its own modal shell (overlay/card/back button)
// and injects LEGAL_CONTENT.terms / LEGAL_CONTENT.privacy into it - this file
// holds no markup for the shell itself, only the content inside the card.
const LEGAL_CONTENT = {
  terms: `
    <h3>Terms of Service</h3>
    <h4>1. Acceptance of Terms</h4>
    <p>By creating an account or using TRAC, you agree to these Terms of Service and the accompanying Privacy Policy.</p>
    <h4>2. Artist Ownership &amp; Rights</h4>
    <p>You retain all copyright and intellectual property rights to your artwork. TRAC serves as a portfolio, archival, and certification platform only, and claims no ownership or commercial rights to your content.</p>
    <h4>3. Portfolio &amp; Certification Services</h4>
    <p>TRAC provides artists with a professional portfolio platform to showcase work to galleries, collectors, and the public, and a certification service that records provenance information for individual artworks as "Certificates of Authenticity" (CoAs). Both services are live today, not planned features.</p>
    <h4>4. Blockchain Minting, Public Ledger Disclosure</h4>
    <p>When you mint a Certificate of Authenticity, a record referencing your artwork is written to a public blockchain (currently Polygon). This record, including the transaction hash and ownership history tied to it, is permanent and cannot be edited, hidden, or deleted by you or by TRAC once minted, even if you later delete your artwork from TRAC or close your account. Do not mint a certificate for anything you may later want fully erased from public record.</p>
    <h4>5. Collector Accounts &amp; Ownership Transfers</h4>
    <p>Collectors may create accounts to view and manage certificates transferred to them. Ownership transfers are recorded in TRAC's ownership history for each certificate, which may include the names and email addresses of past owners. This history is retained as part of the certificate's provenance record even after an account is closed, for the same reason described in Section 4.</p>
    <h4>6. Content Responsibility</h4>
    <p>You are responsible for all artwork, images, and content you upload, and you confirm you have the rights to publish it.</p>
    <h4>7. Certificate Dispute Reporting</h4>
    <p>Collectors who appear in a certificate's ownership history can report an issue with that certificate through the app. TRAC reviews these reports manually; filing a report does not automatically reverse, correct, or flag a certificate, and TRAC does not guarantee a resolution timeframe. This is separate from the arbitration process in Section 11, which governs disputes between you and TRAC directly.</p>
    <h4>8. Resale Royalty Tracking</h4>
    <p>Artists may set a royalty percentage (capped at 25%) associated with a certificate for informational and tracking purposes. TRAC does not currently collect or distribute royalty payments automatically on resale, this is a tracked value only, not an enforced or automated payment mechanism.</p>
    <h4>9. AI Training Prohibition</h4>
    <p>TRAC will never use your artwork, images, or content to train artificial intelligence models, machine learning algorithms, or any AI systems.</p>
    <h4>10. Platform Usage</h4>
    <p>TRAC is provided "as is." We reserve the right to remove content or suspend accounts that violate these terms.</p>
    <h4>11. Dispute Resolution &amp; Arbitration</h4>
    <p>Any dispute arising from these Terms or your use of TRAC will be resolved through binding individual arbitration rather than in court, except where prohibited by law. You waive any right to participate in a class action against TRAC. This clause does not apply to Section 7's certificate dispute reporting process, which is a platform feature, not a legal remedy.</p>
    <h4>12. Governing Law</h4>
    <p>These Terms are governed by the laws of [JURISDICTION], without regard to conflict-of-law principles.</p>
    <h4>13. Changes to These Terms</h4>
    <p>We may update these Terms from time to time. Continued use of TRAC after a change constitutes acceptance of the revised Terms.</p>
    <h4>14. Contact</h4>
    <p>Questions about these Terms: founder@tracstudio.app.</p>
  `,
  privacy: `
    <h3>Privacy Policy</h3>
    <h4>1. Information We Collect</h4>
    <p>Artists: account information (email, name), artwork images and metadata, portfolio content and artist statements, notification preferences, usage data.<br>
    Collectors: account information (email, name), certificate ownership records, notification preferences.<br>
    Everyone: basic security data used to protect accounts (e.g. failed sign-in attempts), stored separately and not used for any other purpose.</p>
    <h4>2. How We Use Your Information</h4>
    <p>To display your public portfolio, provide artist and collector dashboards, record and transfer certificate ownership, deliver notifications you've opted into, protect accounts from abuse, and improve the platform.</p>
    <h4>3. Blockchain &amp; Public Ledger Disclosure</h4>
    <p>Minting a certificate writes a record to a public blockchain (Polygon). This data, including the transaction and the certificate's ownership history, is public, permanent, and cannot be deleted by TRAC or by you, independent of any other data-deletion request described below.</p>
    <h4>4. Public vs. Private Content</h4>
    <p>Artwork images are stored in a public storage bucket and are directly accessible by anyone with the file's URL, this matches the intent of a public portfolio, and those URLs already appear on your public profile page. CV files are stored privately; they are never publicly accessible by URL and are only shared with parties you approve, delivered through a secure, time-limited link.</p>
    <h4>5. Third-Party Service Providers</h4>
    <p>TRAC uses the following third-party services to operate the platform, each of which processes some user data as part of that role:<br>
    Supabase, database hosting, authentication, and file storage.<br>
    Resend, delivery of transactional emails (certificate notifications, account confirmations).<br>
    Cloudflare (Turnstile), bot and abuse protection on sign-in and sign-up.<br>
    Polygon network, the public blockchain certificates are minted to (see Section 3).<br>
    We do not sell your personal data. Gallery/collector introduction requests may be forwarded with your consent. We comply with legal requirements where required by law.</p>
    <h4>6. Data Retention &amp; Deletion</h4>
    <p>You can delete individual pieces of content (artworks, events, collections, and similar items) directly from your dashboard at any time. Certificate and ownership-history records cannot be deleted once minted, for the reasons described in Section 3.<br>
    To request deletion of your account or remaining personal data, contact privacy@tracstudio.app. Account deletion is currently a manual process handled by request rather than a self-service feature.</p>
    <h4>7. Your Rights</h4>
    <p>You can opt out of notification emails and request deletion of your account (see Section 6 for the certificate-data exception).</p>
    <h4>8. AI Training Protection</h4>
    <p>We explicitly prohibit using your artwork, images, or creative content for AI model training, machine learning datasets, generative AI systems, or automated content analysis beyond portfolio display. TRAC does not use any AI system on your data for any other purpose, no AI-based features are currently live on the platform.</p>
    <h4>9. Cookies &amp; Local Storage</h4>
    <p>TRAC uses browser local storage to keep you signed in and to remember your display theme preference (light/dark mode). We do not use third-party advertising trackers or cookies.</p>
    <h4>10. Children's Privacy</h4>
    <p>TRAC is not directed at children under [AGE] and we do not knowingly collect data from users under that age.</p>
    <h4>11. Changes to This Policy</h4>
    <p>We may update this Privacy Policy from time to time. Continued use of TRAC after a change constitutes acceptance of the revised policy.</p>
    <h4>12. Contact</h4>
    <p>Questions about this policy or your data: privacy@tracstudio.app.</p>
  `
};
