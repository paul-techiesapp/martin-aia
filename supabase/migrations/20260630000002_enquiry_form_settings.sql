-- ============================================================
-- Admin-editable enquiry-form header/footer + PDPA Terms & Conditions, and a
-- configurable admin notification email (recipient for "Get Quote" requests).
-- Stored on the single-row system_settings table (anon-readable already).
-- ============================================================

ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS admin_notification_email TEXT;

ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS enquiry_form JSONB NOT NULL DEFAULT jsonb_build_object(
    'header_logo_url', '',
    'header_title',    'Car Insurance Enquiry — Gold Gift on Renewal',
    'header_subtitle', 'Submit your details and our team will be in touch about your renewal and gold gift.',
    'footer_text',     '© RACC Agency. All rights reserved.',
    'dpo_contact',     'dpo@raccagency.com',
    'tnc_body',        $tnc$Personal Data Protection Act (PDPA)
Consent & Disclosure Clause

1. Collection and Purpose of Use
By submitting this form, you agree that we may collect, use, and process the personal data you provide for the following purposes:
• Communication: To contact you regarding your inquiries, updates, and relevant announcements.
• Fulfilling Requests: To process, manage, and fulfill your specific requests, orders, or transactions.
• Improving Our Services: To conduct internal research, analytics, and evaluation to enhance our products, services, and overall customer experience.

2. Disclosure to Third Parties
To effectively fulfill the purposes stated above, we may disclose and share your personal data with:
• Our trusted business partners who co-provide services or products with us.
• Third-party vendors, service providers, and contractors who perform functions on our behalf (e.g., IT service providers, delivery/logistics partners, data analysts).

Note: We require all third parties to strictly respect the security of your personal data and to treat it in accordance with applicable personal data protection laws. They are only permitted to process your data for specified purposes and in accordance with our instructions.

3. Your Rights and Withdrawal of Consent
You have the right to access, correct, or withdraw your consent for the use and disclosure of your personal data at any time. If you wish to do so, please contact our Data Protection Officer (DPO).$tnc$
  );
