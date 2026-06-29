#!/usr/bin/env python3
"""Generate PDF quotations from the amended Excel data - Option A and Option B"""

from fpdf import FPDF

class QuotationPDF(FPDF):
    def __init__(self, accent_color=(31, 78, 121)):
        super().__init__('L', 'mm', 'A4')  # Landscape
        self.accent = accent_color
        self.set_auto_page_break(auto=True, margin=15)

    def header_bar(self, text):
        self.set_fill_color(*self.accent)
        self.set_text_color(255, 255, 255)
        self.set_font('Helvetica', 'B', 10)
        self.cell(0, 8, f'  {text}', ln=True, fill=True)
        self.set_text_color(0, 0, 0)

    def section_bar(self, text):
        self.set_fill_color(214, 228, 240)
        self.set_text_color(31, 78, 121)
        self.set_font('Helvetica', 'B', 9)
        self.cell(0, 7, f'  {text}', ln=True, fill=True)
        self.set_text_color(0, 0, 0)

    def subtotal_bar(self, text, monthly, annual):
        self.set_fill_color(46, 117, 182)
        self.set_text_color(255, 255, 255)
        self.set_font('Helvetica', 'B', 9)
        w = self.w - 20  # page width minus margins
        c1 = 10   # #
        c2 = w - 10 - 50 - 50  # desc
        c3 = 50   # monthly
        c4 = 50   # annual
        self.cell(c1, 7, '', fill=True)
        self.cell(c2, 7, f'  {text}', fill=True)
        self.cell(c3, 7, monthly, align='R', fill=True)
        self.cell(c4, 7, annual, align='R', fill=True)
        self.ln()
        self.set_text_color(0, 0, 0)

    def grand_total_bar(self, text, monthly, annual):
        self.set_fill_color(*self.accent)
        self.set_text_color(255, 255, 255)
        self.set_font('Helvetica', 'B', 11)
        w = self.w - 20
        c1 = 10
        c2 = w - 10 - 50 - 50
        c3 = 50
        c4 = 50
        self.cell(c1, 9, '', fill=True)
        self.cell(c2, 9, f'  {text}', fill=True)
        self.cell(c3, 9, monthly, align='R', fill=True)
        self.cell(c4, 9, annual, align='R', fill=True)
        self.ln()
        self.set_text_color(0, 0, 0)

    def table_header(self):
        self.set_fill_color(*self.accent)
        self.set_text_color(255, 255, 255)
        self.set_font('Helvetica', 'B', 9)
        w = self.w - 20
        c1 = 10
        c2 = w - 10 - 50 - 50
        c3 = 50
        c4 = 50
        self.cell(c1, 7, '#', align='C', fill=True)
        self.cell(c2, 7, 'Description', fill=True)
        self.cell(c3, 7, 'Monthly (RM)', align='C', fill=True)
        self.cell(c4, 7, 'Annual (RM)', align='C', fill=True)
        self.ln()
        self.set_text_color(0, 0, 0)

    def item_row(self, num, desc, monthly, annual, bold=False):
        w = self.w - 20
        c1 = 10
        c2 = w - 10 - 50 - 50
        c3 = 50
        c4 = 50
        self.set_font('Helvetica', 'B' if bold else '', 9)
        self.cell(c1, 6.5, str(num), align='C')
        self.cell(c2, 6.5, f'  {desc}')
        self.cell(c3, 6.5, monthly, align='R')
        self.cell(c4, 6.5, annual, align='R')
        self.ln()

    def quota_row(self, text):
        w = self.w - 20
        c1 = 10
        c2 = w - 10 - 50 - 50
        self.set_font('Helvetica', 'I', 8)
        self.set_text_color(31, 78, 121)
        self.cell(c1, 5.5, '')
        self.cell(c2, 5.5, f'       {text}')
        self.ln()
        self.set_text_color(0, 0, 0)

    def info_row(self, label, value):
        w = self.w - 20
        c1 = 10
        c2 = 80
        c3 = w - 10 - 80
        self.set_font('Helvetica', 'B', 9)
        self.cell(c1, 6, '')
        self.cell(c2, 6, f'  {label}')
        self.set_font('Helvetica', '', 9)
        self.cell(c3, 6, value)
        self.ln()

    def warn_row(self, text):
        self.set_fill_color(252, 228, 236)
        self.set_text_color(192, 0, 0)
        self.set_font('Helvetica', '', 8.5)
        w = self.w - 20
        self.cell(10, 6, '  !', align='C', fill=True)
        self.cell(w - 10, 6, f'  {text}', fill=True)
        self.ln()
        self.set_text_color(0, 0, 0)

    def client_infra_row(self, num, desc, monthly, annual):
        self.set_fill_color(255, 242, 204)
        w = self.w - 20
        c1 = 10
        c2 = w - 10 - 50 - 50
        c3 = 50
        c4 = 50
        self.set_font('Helvetica', '', 9)
        self.cell(c1, 6.5, str(num), align='C', fill=True)
        self.cell(c2, 6.5, f'  {desc}', fill=True)
        self.cell(c3, 6.5, monthly, align='R', fill=True)
        self.cell(c4, 6.5, annual, align='R', fill=True)
        self.ln()

    def client_infra_note(self, text):
        self.set_fill_color(255, 242, 204)
        w = self.w - 20
        self.set_font('Helvetica', 'I', 7.5)
        self.set_text_color(128, 128, 128)
        self.cell(10, 5, '', fill=True)
        self.cell(w - 10, 5, f'       {text}', fill=True)
        self.ln()
        self.set_text_color(0, 0, 0)

    def client_infra_subtotal(self, text, monthly, annual):
        self.set_fill_color(255, 217, 102)
        self.set_text_color(127, 96, 0)
        self.set_font('Helvetica', 'B', 9)
        w = self.w - 20
        c1 = 10
        c2 = w - 10 - 50 - 50
        c3 = 50
        c4 = 50
        self.cell(c1, 7, '', fill=True)
        self.cell(c2, 7, f'  {text}', fill=True)
        self.cell(c3, 7, monthly, align='R', fill=True)
        self.cell(c4, 7, annual, align='R', fill=True)
        self.ln()
        self.set_text_color(0, 0, 0)


def fmt(n):
    """Format number with comma separator"""
    if n is None or n == '' or n == 0:
        return ''
    return f'{int(n):,}'


# ═══════════════════════════════════════════════════════════
# OPTION A PDF
# ═══════════════════════════════════════════════════════════
pdf = QuotationPDF()
pdf.add_page()

# Title
pdf.set_font('Helvetica', 'B', 16)
pdf.set_text_color(31, 78, 121)
pdf.cell(0, 10, 'AGENT ONBOARDING SYSTEM - MONTHLY SaaS SUBSCRIPTION', align='C', ln=True)
pdf.set_font('Helvetica', 'I', 9)
pdf.set_text_color(128, 128, 128)
pdf.cell(0, 5, 'All prices in MYR (Malaysian Ringgit) | Monthly Lump Sum with Usage Quotas', align='C', ln=True)
pdf.set_text_color(0, 0, 0)
pdf.ln(4)

# Table header
pdf.table_header()

# A. SaaS Platform
pdf.section_bar('A. SaaS PLATFORM')
pdf.item_row(1, 'Admin Portal - Event management, agent/unit management, tier & rewards config, reports', '300', '3,600')
pdf.item_row(2, 'Agent Portal - Campaign browsing, link generation & sharing, partner management, rewards', '300', '3,600')
pdf.item_row(3, 'Public Pages - Registration, QR check-in display, OTP checkout, feedback', '300', '3,600')
pdf.subtotal_bar('Subtotal - SaaS Platform', '900', '10,800')

# B. Cloud Infra
pdf.section_bar('B. CLOUD INFRASTRUCTURE & SERVICES (BUNDLED WITH QUOTA)')
pdf.item_row(4, 'Cloud Hosting - 3 production apps, CI/CD auto-deployment, SSL', '200', '2,400')
pdf.quota_row('Quota: 3 apps, 100GB bandwidth/mo')
pdf.item_row(5, 'Database & Backend - PostgreSQL, Auth, Edge Functions, automated backups', '250', '3,000')
pdf.quota_row('Quota: 8GB database, 500MB storage')
pdf.item_row(6, 'Email Service - Event reminders, notifications, transactional emails (Resend)', '150', '1,800')
pdf.quota_row('Quota: 5,000 emails/mo')
pdf.item_row(7, 'Domain & SSL Management (Per Year)', '250', '')
pdf.subtotal_bar('Subtotal - Cloud Infrastructure & Services', '850', '7,450')

# C. Support
pdf.section_bar('C. SUPPORT & SLA')
pdf.item_row(8, 'SLA Support - 99.5% uptime guarantee, P1-P4 incident response', '300', '3,600')
pdf.item_row(9, 'Bug Fixes, System Monitoring & Maintenance', '200', '2,400')
pdf.item_row(10, 'Minor Adjustments & Updates (up to 2 hours/month)', '200', '2,400')
pdf.subtotal_bar('Subtotal - Support & SLA', '700', '8,400')

# D. Training
pdf.section_bar('D. TRAINING & ENABLEMENT')
pdf.item_row(11, 'New Agent/Unit Onboarding Sessions (1 session/month, up to 20 pax)', '200', '2,400')
pdf.subtotal_bar('Subtotal - Training & Enablement', '200', '2,400')

pdf.ln(2)
pdf.grand_total_bar('TOTAL MONTHLY LUMP SUM', '2,650', '31,800')

# Quotas section
pdf.ln(4)
pdf.section_bar('INCLUDED MONTHLY QUOTAS')
pdf.info_row('Cloud Hosting', '3 production apps, 100GB bandwidth/mo, CI/CD auto-deploy')
pdf.info_row('Database & Storage', '8GB PostgreSQL database, 500MB file storage, automated daily backups')
pdf.info_row('Email (Resend)', '5,000 transactional emails/month')
pdf.info_row('SSL & Domain', 'Managed SSL certificates, custom domain support')
pdf.info_row('Support Hours', '2 hours/month minor adjustments included')
pdf.info_row('Training', '1 group onboarding session/month (up to 20 pax)')

# Overages
pdf.ln(3)
pdf.section_bar('OVERAGE RATES (BEYOND MONTHLY QUOTA)')
pdf.info_row('Additional emails (beyond 5,000/mo)', 'RM 0.01/email')
pdf.info_row('Additional OTP verifications (beyond 500/mo)', 'RM 0.30/OTP')
pdf.info_row('Database storage upgrade (beyond 8GB)', 'RM 50/GB/mo')
pdf.info_row('Additional support hours (beyond 2 hrs/mo)', 'RM 150/hour')
pdf.info_row('Additional training sessions', 'RM 500/session')

# Add-ons
pdf.ln(3)
pdf.section_bar('OPTIONAL ADD-ONS (QUOTED SEPARATELY)')
pdf.info_row('New Feature Development', 'RM 150/hour')
pdf.info_row('Custom Integrations (CRM, HR, ERP)', 'Quoted per scope')

pdf.output('/Users/paullee/Documents/project/martin/DATA/docs/Option-A-Managed-SaaS.pdf')
print('Option A PDF saved.')


# ═══════════════════════════════════════════════════════════
# OPTION B PDF
# ═══════════════════════════════════════════════════════════
pdf2 = QuotationPDF(accent_color=(191, 143, 0))
pdf2.add_page()

# Title
pdf2.set_font('Helvetica', 'B', 16)
pdf2.set_text_color(191, 143, 0)
pdf2.cell(0, 10, 'OPTION B: SELF-MANAGED INFRASTRUCTURE', align='C', ln=True)
pdf2.set_font('Helvetica', 'I', 9)
pdf2.set_text_color(128, 128, 128)
pdf2.cell(0, 5, 'Client manages own cloud accounts & services | Lower monthly fee, higher operational effort', align='C', ln=True)
pdf2.set_text_color(0, 0, 0)
pdf2.ln(4)

pdf2.table_header()

# A. Software License
pdf2.section_bar('A. SOFTWARE LICENSE (PAID TO Techies)')
pdf2.item_row(1, 'Admin Portal - Event management, agent/unit management, tier & rewards config, reports', '300', '3,600')
pdf2.item_row(2, 'Agent Portal - Campaign browsing, link generation & sharing, partner management, rewards', '300', '3,600')
pdf2.item_row(3, 'Public Pages - Registration, QR check-in display, OTP checkout, feedback', '300', '3,600')
pdf2.subtotal_bar('Subtotal - Software License', '900', '10,800')

# B. Support
pdf2.section_bar('B. SUPPORT & SLA (PAID TO Techies)')
pdf2.item_row(4, 'SLA Support - 99.5% uptime guarantee (application layer only)', '250', '3,000')
pdf2.item_row(5, 'Bug Fixes & Application Monitoring', '200', '2,400')
pdf2.item_row(6, 'Minor Adjustments & Updates (up to 2 hours/month)', '200', '2,400')
pdf2.subtotal_bar('Subtotal - Support & SLA', '650', '7,800')

# C. Training
pdf2.section_bar('C. TRAINING & ENABLEMENT (PAID TO Techies)')
pdf2.item_row(7, 'New Agent/Unit Onboarding Sessions (1 session/month, up to 20 pax)', '200', '2,400')
pdf2.subtotal_bar('Subtotal - Training & Enablement', '200', '2,400')

pdf2.ln(2)
pdf2.grand_total_bar('SUBTOTAL - PAID TO Techies (Software + Support + Training)', '1,750', '21,000')

# D. Client infra
pdf2.ln(4)
pdf2.section_bar('D. CLIENT-MANAGED INFRASTRUCTURE (PAID DIRECTLY BY CLIENT)')
pdf2.client_infra_row(8, 'Supabase Pro - Database, Auth, Edge Functions, Storage', '110', '1,320')
pdf2.client_infra_note('Sign up: supabase.com - Pro Plan USD 25/mo')
pdf2.client_infra_row(9, 'Render - Cloud Hosting (3 Static Sites, CI/CD)', '50', '600')
pdf2.client_infra_note('Sign up: render.com - Free tier or Starter USD ~12/mo')
pdf2.client_infra_row(10, 'Resend - Email Service (reminders, notifications)', '90', '1,080')
pdf2.client_infra_note('Sign up: resend.com - Pro Plan USD 20/mo')
pdf2.client_infra_row(11, 'Domain Registration & DNS (.com)', '15', '180')
pdf2.client_infra_note('Sign up: namecheap.com / cloudflare - ~USD 12/yr')
pdf2.client_infra_subtotal('Subtotal - Client-Managed Infrastructure (est.)', '265', '3,180')

pdf2.ln(2)
pdf2.grand_total_bar('TOTAL MONTHLY COST TO CLIENT (Techies Bill + Own Infra)', '2,015', '24,180')

# E. Client Responsibilities
pdf2.ln(4)
pdf2.section_bar('E. CLIENT RESPONSIBILITIES (SELF-MANAGED)')
responsibilities = [
    'Sign up & maintain accounts: Supabase, Render, Resend',
    'Manage billing & payments for all cloud service subscriptions',
    'Monitor database storage and email quota usage',
    'Handle Supabase database backups & disaster recovery',
    'Manage domain DNS settings, SSL certificate renewals',
    'Coordinate with cloud providers for any service outages',
    'Upgrade service plans as usage grows',
    'Provide service credentials/API keys to developer for setup & deployments',
    'Infrastructure uptime NOT covered under SLA (application-level SLA only)',
]
for r in responsibilities:
    pdf2.warn_row(r)

pdf2.output('/Users/paullee/Documents/project/martin/DATA/docs/Option-B-Self-Managed-Infra.pdf')
print('Option B PDF saved.')
