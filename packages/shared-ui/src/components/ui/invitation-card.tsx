import * as React from 'react';
import { cn } from '../../lib/utils';
import { Badge, getStatusVariant } from './badge';
import { Users } from 'lucide-react';

export interface InvitationCardProps {
  /** Event/campaign name */
  eventName: string;
  /** Event venue */
  venue: string;
  /** Parsed slot start date — caller uses parseISO(slot.start_at) */
  date: Date;
  /** Pre-formatted start time — caller uses formatSlotTime(slot.start_at) (Asia/Singapore) */
  startTime: string;
  /** Pre-formatted end time — optional, used in PDF context. Use formatSlotTime(slot.end_at). */
  endTime?: string;

  /**
   * Invitee name. Pass `null` to show "Not registered" text.
   * Omit entirely (undefined) to hide the invitee label row.
   */
  inviteeName?: string | null;
  /** Capacity type — displayed as formatted label */
  inviteeType?: 'agent' | 'business_partner';
  /** Invitation status — when omitted, badge is hidden */
  status?: string;
  /**
   * Number of people registered via this link. When provided (and no single
   * inviteeName is shown), renders a "N registered" label in the bottom row.
   */
  registeredCount?: number;

  /** Company name displayed on card. Falls back to "RACC Agency". */
  companyName?: string;
  /** Company logo URL. Falls back to no image. */
  logoUrl?: string | null;

  /** Action buttons rendered in bottom-right of right panel */
  actions?: React.ReactNode;
  className?: string;

  /** Left-panel gradient override — defaults preserve the classic navy card. */
  gradientFrom?: string;
  gradientTo?: string;
}

export function InvitationCard({
  eventName,
  venue,
  date,
  startTime,
  endTime,
  inviteeName,
  inviteeType,
  status,
  registeredCount,
  companyName,
  logoUrl,
  actions,
  className,
  gradientFrom,
  gradientTo,
}: InvitationCardProps) {
  // All events are Singapore events; render the date in the event timezone so
  // it is correct regardless of the viewer's device timezone. The `date` prop
  // is the exact UTC instant (parseISO(slot.start_at)).
  const EVENT_TIME_ZONE = 'Asia/Singapore';
  const day = date.toLocaleString('en', { day: 'numeric', timeZone: EVENT_TIME_ZONE });
  const month = date.toLocaleString('en', { month: 'short', timeZone: EVENT_TIME_ZONE }).toUpperCase();
  const year = date.toLocaleString('en', { year: 'numeric', timeZone: EVENT_TIME_ZONE });

  // Show bottom row when there's any content to render below the divider
  const hasBottomRow =
    inviteeName !== undefined ||
    inviteeType !== undefined ||
    actions !== undefined ||
    registeredCount !== undefined;

  return (
    <div
      role="article"
      className={cn(
        'flex rounded-xl overflow-hidden bg-white',
        'shadow-[0_2px_12px_rgba(0,0,0,0.08)]',
        'hover:shadow-[0_4px_20px_rgba(0,0,0,0.12)] hover:-translate-y-px',
        'transition-all duration-200',
        className,
      )}
    >
      {/* Left Panel — gradient date display */}
      <div
        className="w-[100px] md:w-[120px] flex-shrink-0 flex flex-col justify-between p-4"
        style={{ background: `linear-gradient(135deg, ${gradientFrom ?? '#0F172A'}, ${gradientTo ?? '#0369A1'})` }}
      >
        <div>
          {logoUrl && (
            <img src={logoUrl} alt={companyName || 'RACC Agency'} className="w-8 h-8 object-contain mb-1" />
          )}
          <div
            className="text-[8px] font-semibold uppercase tracking-[1px]"
            style={{ color: '#DAA520' }}
          >
            {companyName || 'RACC Agency'}
          </div>
          <div className="text-[8px] text-white/60">Event Invitation</div>
        </div>
        <div>
          <div className="text-xl md:text-2xl font-extrabold text-white leading-none">
            {day}
          </div>
          <div className="text-[10px] md:text-[11px] font-semibold text-white/80">
            {month} {year}
          </div>
          <div className="text-[10px] text-white/60 mt-0.5">
            {startTime}
            {endTime ? ` - ${endTime}` : ''}
          </div>
        </div>
      </div>

      {/* Right Panel — event details + invitee + actions */}
      <div className="flex-1 p-3 md:p-4 flex flex-col justify-between min-w-0">
        {/* Header: event name + status badge */}
        <div>
          <div className="flex justify-between items-start gap-2">
            <h3 className="text-sm font-bold text-slate-900 line-clamp-2">
              {eventName}
            </h3>
            {status && (
              <Badge
                variant={getStatusVariant(status)}
                aria-label={`Status: ${status}`}
                className="flex-shrink-0 capitalize"
              >
                {status}
              </Badge>
            )}
          </div>
          <p className="text-[10px] text-slate-500 mt-1 truncate">
            📍 {venue}
          </p>
        </div>

        {/* Bottom row: invitee info + capacity type + actions */}
        {hasBottomRow && (
          <>
            <div className="border-t border-dashed border-slate-200 my-2" />
            <div className="flex justify-between items-end gap-2">
              {/* Left side: invitee name or capacity type */}
              <div className="min-w-0">
                {inviteeName !== undefined ? (
                  <>
                    <div className="text-[9px] text-slate-400 uppercase">
                      Invitee
                    </div>
                    {inviteeName ? (
                      <div className="text-[11px] font-semibold text-slate-900 truncate">
                        {inviteeName}
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-400 italic">
                        Not registered
                      </div>
                    )}
                  </>
                ) : registeredCount !== undefined ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600">
                    <Users className="size-3" />
                    {registeredCount} registered
                  </span>
                ) : inviteeType ? (
                  <span className="text-[10px] text-slate-500 capitalize">
                    {inviteeType.replace('_', ' ')}
                  </span>
                ) : null}
              </div>

              {/* Right side: capacity type (when invitee shown) + actions */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {inviteeName !== undefined && inviteeType && (
                  <span className="text-[9px] text-slate-500 capitalize hidden sm:inline">
                    {inviteeType.replace('_', ' ')}
                  </span>
                )}
                {actions}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
