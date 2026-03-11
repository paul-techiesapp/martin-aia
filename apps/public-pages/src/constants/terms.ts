export interface TermsSection {
  title: string;
  body: string;
}

export const TERMS_AND_CONDITIONS: TermsSection[] = [
  {
    title: "1. Event Attendance",
    body: "By registering for this event, you agree to attend at the scheduled date and time. If you are unable to attend, please inform your inviting unit as soon as possible.",
  },
  {
    title: "2. Personal Data Collection",
    body: "Your personal information (name, NRIC, phone number, email address, and occupation) will be collected for event management and verification purposes. This data will be handled in accordance with the Personal Data Protection Act (PDPA) of Singapore.",
  },
  {
    title: "3. Photography & Recording",
    body: "Photographs and videos may be taken during the event for promotional and documentation purposes. By attending, you consent to the use of your likeness in marketing materials.",
  },
  {
    title: "4. Liability",
    body: "The organizer shall not be held liable for any personal injury, loss, or damage to property during the event. Attendees are responsible for their own personal belongings.",
  },
  {
    title: "5. Code of Conduct",
    body: "All attendees are expected to conduct themselves in a professional and respectful manner. The organizer reserves the right to remove any attendee who behaves inappropriately.",
  },
];
