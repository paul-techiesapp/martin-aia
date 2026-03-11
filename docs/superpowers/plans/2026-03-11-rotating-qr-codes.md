# Rotating QR Codes for Check-in/Out — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace static QR codes with 60-second rotating, HMAC-signed QR codes for venue check-in/out, with a full-screen venue display page.

**Architecture:** Supabase Edge Functions for HMAC signing/verification (server-side secret). Display tokens in DB for public venue URL access. Auto-switch between check-in/check-out based on slot time windows. Backward compatible with existing static QR codes.

**Tech Stack:** Supabase Edge Functions (Deno 2), HMAC-SHA256, PostgreSQL, React 18, TanStack Router, qrcode.react

**Spec:** `docs/superpowers/specs/2026-03-11-rotating-qr-codes-design.md`

---

## Chunk 1: Database & Edge Functions

### Task 1: Create display_tokens migration

**Files:**
- Create: `supabase/migrations/20260311000001_display_tokens.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260311000001_display_tokens.sql`:

```sql
-- Display tokens for public venue QR display URLs
CREATE TABLE display_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slot_id UUID NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  token UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_display_tokens_slot ON display_tokens(slot_id);
CREATE INDEX idx_display_tokens_token ON display_tokens(token);

-- RLS
ALTER TABLE display_tokens ENABLE ROW LEVEL SECURITY;

-- Admin: full access (matches existing pattern using is_admin() helper)
CREATE POLICY "Admin full access to display_tokens" ON display_tokens
  FOR ALL TO authenticated USING (is_admin());

-- Public (anon): read only to validate token on display page
CREATE POLICY "Public can read display_tokens" ON display_tokens
  FOR SELECT TO anon USING (true);
```

- [ ] **Step 2: Apply migration locally**

```bash
cd /Users/paullee/Documents/project/martin/DATA
npx supabase db reset
```

Expected: Migration applies successfully.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260311000001_display_tokens.sql
git commit -m "feat(db): add display_tokens table for venue QR display"
```

---

### Task 2: Create generate-qr-token Edge Function

**Files:**
- Create: `supabase/functions/generate-qr-token/index.ts`

- [ ] **Step 1: Create the Edge Function directory**

```bash
mkdir -p /Users/paullee/Documents/project/martin/DATA/supabase/functions/generate-qr-token
```

- [ ] **Step 2: Write the Edge Function**

Create `supabase/functions/generate-qr-token/index.ts`:

```typescript
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function hmacSign(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { slot_id, mode } = await req.json();

    if (!slot_id || !mode || !["checkin", "checkout"].includes(mode)) {
      return new Response(
        JSON.stringify({ error: "slot_id and mode (checkin|checkout) required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const secret = Deno.env.get("QR_HMAC_SECRET");
    if (!secret) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ts = Math.floor(Date.now() / 1000).toString();
    const message = `${slot_id}:${mode}:${ts}`;
    const sig = await hmacSign(secret, message);

    const path = mode === "checkin" ? "/public/checkin" : "/public/checkout";
    const qrUrl = `${path}?slot=${slot_id}&ts=${ts}&sig=${sig}`;

    return new Response(
      JSON.stringify({ url: qrUrl, expires_in: 60 }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/generate-qr-token/index.ts
git commit -m "feat(edge-fn): add generate-qr-token for rotating QR codes"
```

---

### Task 3: Create verify-qr-token Edge Function

**Files:**
- Create: `supabase/functions/verify-qr-token/index.ts`

- [ ] **Step 1: Create the Edge Function directory**

```bash
mkdir -p /Users/paullee/Documents/project/martin/DATA/supabase/functions/verify-qr-token
```

- [ ] **Step 2: Write the Edge Function**

Create `supabase/functions/verify-qr-token/index.ts`:

```typescript
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALIDITY_WINDOW_SECONDS = 90;

async function hmacSign(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { slot_id, mode, ts, sig } = await req.json();

    if (!slot_id || !mode || !ts || !sig) {
      return new Response(
        JSON.stringify({ valid: false, error: "Missing required parameters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const secret = Deno.env.get("QR_HMAC_SECRET");
    if (!secret) {
      return new Response(
        JSON.stringify({ valid: false, error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify HMAC
    const message = `${slot_id}:${mode}:${ts}`;
    const expectedSig = await hmacSign(secret, message);

    if (sig !== expectedSig) {
      return new Response(
        JSON.stringify({ valid: false, error: "Invalid QR code" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify timestamp within window
    const now = Math.floor(Date.now() / 1000);
    const tokenTime = parseInt(ts, 10);
    const age = now - tokenTime;

    if (age > VALIDITY_WINDOW_SECONDS || age < -10) {
      return new Response(
        JSON.stringify({ valid: false, error: "QR code expired. Please scan the current code at the venue." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ valid: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ valid: false, error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/verify-qr-token/index.ts
git commit -m "feat(edge-fn): add verify-qr-token for QR code validation"
```

---

## Chunk 2: Venue Display Pages

### Task 4: Create shared slot time utilities

**Files:**
- Create: `apps/public-pages/src/lib/slot-time.ts`

This utility determines which time window a slot is currently in. Used by both the admin and public venue display pages.

- [ ] **Step 1: Create the utility**

Create `apps/public-pages/src/lib/slot-time.ts`:

```typescript
export type SlotPhase = "waiting" | "checkin" | "in-progress" | "checkout" | "ended";

interface SlotConfig {
  day_of_week: number;
  start_time: string; // "HH:MM:SS"
  end_time: string;   // "HH:MM:SS"
  checkin_window_minutes: number;
  checkout_window_minutes: number;
}

export function getCurrentSlotPhase(slot: SlotConfig): SlotPhase {
  const now = new Date();
  const currentDay = now.getDay();

  if (currentDay !== slot.day_of_week) {
    return "waiting";
  }

  const [startH, startM] = slot.start_time.split(":").map(Number);
  const [endH, endM] = slot.end_time.split(":").map(Number);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  const checkinStart = startMinutes - slot.checkin_window_minutes;
  const checkoutEnd = endMinutes + slot.checkout_window_minutes;

  if (nowMinutes < checkinStart) return "waiting";
  if (nowMinutes < startMinutes) return "checkin";
  if (nowMinutes < endMinutes) return "in-progress";
  if (nowMinutes < checkoutEnd) return "checkout";
  return "ended";
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/public-pages/src/lib/slot-time.ts
git commit -m "feat(public-pages): add slot time phase utility"
```

---

### Task 5: Create public venue Display page

**Files:**
- Create: `apps/public-pages/src/pages/Display.tsx`
- Modify: `apps/public-pages/src/router.tsx`

- [ ] **Step 1: Install dependency (if not already present)**

The public-pages app should already have `qrcode.react`. Verify:

```bash
cd /Users/paullee/Documents/project/martin/DATA
grep qrcode.react apps/public-pages/package.json || pnpm --filter public-pages add qrcode.react
```

- [ ] **Step 2: Create the Display page**

Create `apps/public-pages/src/pages/Display.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearch } from '@tanstack/react-router';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../lib/supabase';
import { getCurrentSlotPhase, type SlotPhase } from '../lib/slot-time';

interface SlotData {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  checkin_window_minutes: number;
  checkout_window_minutes: number;
  campaign: {
    name: string;
    venue: string;
  };
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const REFRESH_INTERVAL = 60;

export function Display() {
  const { slotId } = useParams({ strict: false });
  const search = useSearch({ strict: false }) as { token?: string };
  const displayToken = search.token;

  const [slot, setSlot] = useState<SlotData | null>(null);
  const [qrUrl, setQrUrl] = useState<string>('');
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const [phase, setPhase] = useState<SlotPhase>('waiting');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Validate display token and fetch slot data
  useEffect(() => {
    async function init() {
      if (!slotId || !displayToken) {
        setError('Invalid display URL');
        setIsLoading(false);
        return;
      }

      // Validate token
      const { data: tokenData, error: tokenError } = await supabase
        .from('display_tokens')
        .select('id, expires_at')
        .eq('slot_id', slotId)
        .eq('token', displayToken)
        .single();

      if (tokenError || !tokenData) {
        setError('Invalid or expired display token');
        setIsLoading(false);
        return;
      }

      if (new Date(tokenData.expires_at) < new Date()) {
        setError('Display token has expired');
        setIsLoading(false);
        return;
      }

      // Fetch slot with campaign
      const { data: slotData, error: slotError } = await supabase
        .from('slots')
        .select('id, day_of_week, start_time, end_time, checkin_window_minutes, checkout_window_minutes, campaign:campaigns(name, venue)')
        .eq('id', slotId)
        .single();

      if (slotError || !slotData) {
        setError('Slot not found');
        setIsLoading(false);
        return;
      }

      setSlot(slotData as unknown as SlotData);
      setIsLoading(false);
    }

    init();
  }, [slotId, displayToken]);

  // Generate QR token
  const generateQr = useCallback(async () => {
    if (!slot) return;

    const currentPhase = getCurrentSlotPhase(slot);
    setPhase(currentPhase);

    if (currentPhase !== 'checkin' && currentPhase !== 'checkout') {
      setQrUrl('');
      return;
    }

    const mode = currentPhase === 'checkin' ? 'checkin' : 'checkout';

    try {
      const { data, error } = await supabase.functions.invoke('generate-qr-token', {
        body: { slot_id: slot.id, mode },
      });

      if (error || !data?.url) {
        console.error('Failed to generate QR token:', error);
        return;
      }

      // Prepend the public pages base URL
      const baseUrl = window.location.origin;
      setQrUrl(`${baseUrl}${data.url}`);
    } catch (err) {
      console.error('QR generation error:', err);
    }

    setCountdown(REFRESH_INTERVAL);
  }, [slot]);

  // Refresh QR every 60 seconds
  useEffect(() => {
    if (!slot) return;

    generateQr();
    const refreshInterval = setInterval(generateQr, REFRESH_INTERVAL * 1000);

    return () => clearInterval(refreshInterval);
  }, [slot, generateQr]);

  // Countdown timer
  useEffect(() => {
    if (phase !== 'checkin' && phase !== 'checkout') return;

    const timer = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? REFRESH_INTERVAL : prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [phase]);

  // Update phase every 30 seconds
  useEffect(() => {
    if (!slot) return;

    const phaseCheck = setInterval(() => {
      const newPhase = getCurrentSlotPhase(slot);
      if (newPhase !== phase) {
        setPhase(newPhase);
        if (newPhase === 'checkin' || newPhase === 'checkout') {
          generateQr();
        }
      }
    }, 30000);

    return () => clearInterval(phaseCheck);
  }, [slot, phase, generateQr]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <p className="text-slate-400 text-lg">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <p className="text-red-400 text-lg">{error}</p>
      </div>
    );
  }

  const isActive = phase === 'checkin' || phase === 'checkout';
  const themeColor = phase === 'checkin' ? '#22c55e' : '#f59e0b';

  const phaseLabels: Record<SlotPhase, string> = {
    waiting: 'Event Starts Soon',
    checkin: 'CHECK IN',
    'in-progress': 'Event in Progress',
    checkout: 'CHECK OUT',
    ended: 'Event Ended',
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-8 text-center">
      <div className="text-xs uppercase tracking-[3px] font-semibold" style={{ color: isActive ? themeColor : '#64748b' }}>
        {phaseLabels[phase]}
      </div>

      <h1 className="text-2xl font-bold text-white mt-3">{slot?.campaign.name}</h1>
      <p className="text-sm text-slate-500 mt-1">
        {slot?.campaign.venue} &bull; {DAYS[slot?.day_of_week ?? 0]} {slot?.start_time.slice(0, 5)} – {slot?.end_time.slice(0, 5)}
      </p>

      {isActive && qrUrl ? (
        <>
          <div className="mt-8 bg-white p-6 rounded-2xl">
            <QRCodeSVG value={qrUrl} size={280} />
          </div>

          <p className="text-slate-400 text-sm mt-6">
            Scan to {phase === 'checkin' ? 'check in' : 'check out'}
          </p>

          <div className="mt-4 inline-flex items-center gap-2 bg-slate-900 px-4 py-2 rounded-full">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: themeColor }} />
            <span className="text-sm text-slate-400">
              Refreshes in <strong className="text-white">{countdown}s</strong>
            </span>
          </div>
        </>
      ) : (
        <div className="mt-16">
          <p className="text-slate-500 text-lg">{phaseLabels[phase]}</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add route to public-pages router**

Add to `apps/public-pages/src/router.tsx`:

After the import block, add:
```typescript
import { Display } from './pages/Display';
```

After `checkoutRoute` definition, add:
```typescript
const displayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/public/display/$slotId',
  component: Display,
});
```

Add `displayRoute` to the routeTree children array:
```typescript
const routeTree = rootRoute.addChildren([
  indexRoute,
  registerRoute,
  checkinRoute,
  checkoutRoute,
  displayRoute,
]);
```

- [ ] **Step 4: Verify build**

```bash
pnpm --filter public-pages build
```

- [ ] **Step 5: Commit**

```bash
git add apps/public-pages/src/pages/Display.tsx apps/public-pages/src/router.tsx
git commit -m "feat(public-pages): add venue display page with rotating QR codes"
```

---

### Task 6: Create admin VenueDisplay page

**Files:**
- Create: `apps/admin-portal/src/pages/VenueDisplay.tsx`
- Modify: `apps/admin-portal/src/router.tsx`

- [ ] **Step 1: Create the admin VenueDisplay page**

Create `apps/admin-portal/src/pages/VenueDisplay.tsx`. This is a simplified version — the admin page authenticates via the user's session (no display token needed) and calls the Edge Function directly.

The component logic is very similar to the public Display page but:
- No token validation (admin is authenticated)
- Fetches slot data directly via authenticated Supabase client
- Same QR generation, countdown, and auto-switch logic

```tsx
import { useState, useEffect, useCallback } from 'react';
import { useParams } from '@tanstack/react-router';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../lib/supabase';

type SlotPhase = "waiting" | "checkin" | "in-progress" | "checkout" | "ended";

interface SlotData {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  checkin_window_minutes: number;
  checkout_window_minutes: number;
  campaign: { name: string; venue: string };
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const REFRESH_INTERVAL = 60;

function getPhase(slot: SlotData): SlotPhase {
  const now = new Date();
  if (now.getDay() !== slot.day_of_week) return "waiting";
  const [sH, sM] = slot.start_time.split(":").map(Number);
  const [eH, eM] = slot.end_time.split(":").map(Number);
  const mins = now.getHours() * 60 + now.getMinutes();
  const start = sH * 60 + sM;
  const end = eH * 60 + eM;
  if (mins < start - slot.checkin_window_minutes) return "waiting";
  if (mins < start) return "checkin";
  if (mins < end) return "in-progress";
  if (mins < end + slot.checkout_window_minutes) return "checkout";
  return "ended";
}

export function VenueDisplay() {
  const { slotId } = useParams({ strict: false });
  const [slot, setSlot] = useState<SlotData | null>(null);
  const [qrUrl, setQrUrl] = useState('');
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const [phase, setPhase] = useState<SlotPhase>('waiting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slotId) return;
    supabase
      .from('slots')
      .select('id, day_of_week, start_time, end_time, checkin_window_minutes, checkout_window_minutes, campaign:campaigns(name, venue)')
      .eq('id', slotId)
      .single()
      .then(({ data, error }) => {
        if (error || !data) { setError('Slot not found'); return; }
        setSlot(data as unknown as SlotData);
      });
  }, [slotId]);

  const generateQr = useCallback(async () => {
    if (!slot) return;
    const p = getPhase(slot);
    setPhase(p);
    if (p !== 'checkin' && p !== 'checkout') { setQrUrl(''); return; }
    const mode = p === 'checkin' ? 'checkin' : 'checkout';
    const { data } = await supabase.functions.invoke('generate-qr-token', {
      body: { slot_id: slot.id, mode },
    });
    if (data?.url) {
      const publicPagesUrl = import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin;
      setQrUrl(`${publicPagesUrl}${data.url}`);
    }
    setCountdown(REFRESH_INTERVAL);
  }, [slot]);

  useEffect(() => { if (!slot) return; generateQr(); const i = setInterval(generateQr, REFRESH_INTERVAL * 1000); return () => clearInterval(i); }, [slot, generateQr]);
  useEffect(() => { if (phase !== 'checkin' && phase !== 'checkout') return; const i = setInterval(() => setCountdown(p => p <= 1 ? REFRESH_INTERVAL : p - 1), 1000); return () => clearInterval(i); }, [phase]);
  useEffect(() => { if (!slot) return; const i = setInterval(() => { const p = getPhase(slot); if (p !== phase) { setPhase(p); generateQr(); } }, 30000); return () => clearInterval(i); }, [slot, phase, generateQr]);

  if (error) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><p className="text-red-400">{error}</p></div>;
  if (!slot) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><p className="text-slate-400">Loading...</p></div>;

  const isActive = phase === 'checkin' || phase === 'checkout';
  const color = phase === 'checkin' ? '#22c55e' : '#f59e0b';
  const labels: Record<SlotPhase, string> = { waiting: 'Event Starts Soon', checkin: 'CHECK IN', 'in-progress': 'Event in Progress', checkout: 'CHECK OUT', ended: 'Event Ended' };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-8 text-center">
      <div className="text-xs uppercase tracking-[3px] font-semibold" style={{ color: isActive ? color : '#64748b' }}>{labels[phase]}</div>
      <h1 className="text-2xl font-bold text-white mt-3">{slot.campaign.name}</h1>
      <p className="text-sm text-slate-500 mt-1">{slot.campaign.venue} &bull; {DAYS[slot.day_of_week]} {slot.start_time.slice(0, 5)} – {slot.end_time.slice(0, 5)}</p>
      {isActive && qrUrl ? (
        <>
          <div className="mt-8 bg-white p-6 rounded-2xl"><QRCodeSVG value={qrUrl} size={280} /></div>
          <p className="text-slate-400 text-sm mt-6">Scan to {phase === 'checkin' ? 'check in' : 'check out'}</p>
          <div className="mt-4 inline-flex items-center gap-2 bg-slate-900 px-4 py-2 rounded-full">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: color }} />
            <span className="text-sm text-slate-400">Refreshes in <strong className="text-white">{countdown}s</strong></span>
          </div>
        </>
      ) : (
        <div className="mt-16"><p className="text-slate-500 text-lg">{labels[phase]}</p></div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add route to admin router**

In `apps/admin-portal/src/router.tsx`:

Add import:
```typescript
import { VenueDisplay } from './pages/VenueDisplay';
```

Add route (outside protected layout — venue display is full-screen):
```typescript
const venueDisplayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/venue-display/$slotId',
  component: () => (
    <ProtectedRoute>
      <VenueDisplay />
    </ProtectedRoute>
  ),
});
```

Add to routeTree:
```typescript
const routeTree = rootRoute.addChildren([
  loginRoute,
  venueDisplayRoute,
  protectedLayoutRoute.addChildren([...]),
]);
```

- [ ] **Step 3: Verify build**

```bash
pnpm --filter admin-portal build
```

- [ ] **Step 4: Commit**

```bash
git add apps/admin-portal/src/pages/VenueDisplay.tsx apps/admin-portal/src/router.tsx
git commit -m "feat(admin): add VenueDisplay page with rotating QR codes"
```

---

## Chunk 3: Integration

### Task 7: Add QR token verification to CheckIn and CheckOut pages

**Files:**
- Modify: `apps/public-pages/src/pages/CheckIn.tsx`
- Modify: `apps/public-pages/src/pages/CheckOut.tsx`

Both pages get the same change: check for `ts` and `sig` query params. If present, call `verify-qr-token` before showing the form. If absent, show form as-is (backward compatible).

- [ ] **Step 1: Update CheckIn.tsx**

First, update the React import at line 1 to include `useEffect`:
```typescript
import { useState, useEffect } from 'react';
```

Add a verification state and effect at the top of the `CheckIn` component (after existing state declarations, line 39):

```typescript
const [isVerifying, setIsVerifying] = useState(false);
const [isQrValid, setIsQrValid] = useState<boolean | null>(null);
const [qrError, setQrError] = useState<string | null>(null);

const searchParams = search as { slot?: string; ts?: string; sig?: string };
const hasQrToken = !!(searchParams.ts && searchParams.sig);
```

Add a useEffect for QR verification (after existing code, before `onSubmit`):

```typescript
useEffect(() => {
  if (!hasQrToken || !slotId) {
    setIsQrValid(true); // No QR token = legacy flow, allow
    return;
  }

  setIsVerifying(true);
  supabase.functions
    .invoke('verify-qr-token', {
      body: {
        slot_id: slotId,
        mode: 'checkin',
        ts: searchParams.ts,
        sig: searchParams.sig,
      },
    })
    .then(({ data, error }) => {
      if (error || !data?.valid) {
        setIsQrValid(false);
        setQrError(data?.error || 'Invalid QR code');
      } else {
        setIsQrValid(true);
      }
      setIsVerifying(false);
    });
}, [hasQrToken, slotId]);
```

Add a guard before the form render. If verifying, show loading. If invalid, show error:

```tsx
if (isVerifying) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-sky-900 flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-white/95 backdrop-blur-sm shadow-2xl border-0">
        <CardContent className="p-10 text-center">
          <p className="text-slate-600">Verifying QR code...</p>
        </CardContent>
      </Card>
    </div>
  );
}

if (isQrValid === false) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-sky-900 flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-white/95 backdrop-blur-sm shadow-2xl border-0">
        <CardContent className="p-10 text-center space-y-4">
          <p className="text-red-600 font-medium">{qrError}</p>
          <p className="text-slate-500 text-sm">Please scan the current QR code at the venue.</p>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Update CheckOut.tsx with the same pattern**

Same changes as CheckIn.tsx: add `useEffect` to the React import (line 1), add QR verification state and effect, add guard renders. Use `mode: 'checkout'` in the verify call.

- [ ] **Step 3: Verify build**

```bash
pnpm --filter public-pages build
```

- [ ] **Step 4: Commit**

```bash
git add apps/public-pages/src/pages/CheckIn.tsx apps/public-pages/src/pages/CheckOut.tsx
git commit -m "feat(public-pages): add QR token verification to check-in/out pages"
```

---

### Task 8: Add display token management to PinCodes page

**Files:**
- Modify: `apps/admin-portal/src/pages/PinCodes.tsx`

- [ ] **Step 1: Add display token generation UI**

After the existing "QR Codes for Venue" card (line 144-206), add a new card for display token management. This includes:
- A "Generate Display Link" button
- Shows existing display tokens for the selected slot
- Copy URL button for each token
- Delete button to revoke tokens

Add state:
```typescript
const [displayTokens, setDisplayTokens] = useState<Array<{ id: string; token: string; expires_at: string }>>([]);
```

Add fetch effect (when selectedSlotId changes):
```typescript
useEffect(() => {
  if (!selectedSlotId) { setDisplayTokens([]); return; }
  supabase
    .from('display_tokens')
    .select('id, token, expires_at')
    .eq('slot_id', selectedSlotId)
    .then(({ data }) => setDisplayTokens(data || []));
}, [selectedSlotId]);
```

Add generate handler:
```typescript
const handleGenerateDisplayToken = async () => {
  if (!selectedSlotId || !selectedCampaign) return;
  const { data } = await supabase
    .from('display_tokens')
    .insert({
      slot_id: selectedSlotId,
      expires_at: selectedCampaign.end_date,
    })
    .select()
    .single();
  if (data) setDisplayTokens((prev) => [...prev, data]);
};
```

Add a card after the QR codes card:
```tsx
{selectedSlotId && (
  <Card className="glass-card">
    <CardHeader>
      <div className="flex items-center justify-between">
        <div>
          <CardTitle className="text-lg">Venue Display Links</CardTitle>
          <CardDescription>Share these links with venue devices for rotating QR codes</CardDescription>
        </div>
        <Button onClick={handleGenerateDisplayToken}>
          <Plus className="h-4 w-4 mr-2" />
          Generate Link
        </Button>
      </div>
    </CardHeader>
    <CardContent>
      {displayTokens.length === 0 ? (
        <p className="text-muted-foreground">No display links generated yet.</p>
      ) : (
        <div className="space-y-2">
          {displayTokens.map((dt) => {
            const publicUrl = import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin;
            const url = `${publicUrl}/public/display/${selectedSlotId}?token=${dt.token}`;
            return (
              <div key={dt.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <code className="text-xs text-slate-600 truncate max-w-[300px]">{url}</code>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(url)}>Copy</Button>
                  <Button size="sm" variant="ghost" onClick={async () => {
                    await supabase.from('display_tokens').delete().eq('id', dt.id);
                    setDisplayTokens((prev) => prev.filter((t) => t.id !== dt.id));
                  }}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </CardContent>
  </Card>
)}
```

- [ ] **Step 2: Verify build**

```bash
pnpm --filter admin-portal build
```

- [ ] **Step 3: Commit**

```bash
git add apps/admin-portal/src/pages/PinCodes.tsx
git commit -m "feat(admin): add display token management to PinCodes page"
```

---

### Task 9: Set QR_HMAC_SECRET and deploy Edge Functions

- [ ] **Step 1: Set the secret locally**

```bash
cd /Users/paullee/Documents/project/martin/DATA
echo "QR_HMAC_SECRET=$(openssl rand -hex 32)" >> supabase/.env
```

- [ ] **Step 2: Set the secret in production**

```bash
npx supabase secrets set QR_HMAC_SECRET=$(openssl rand -hex 32) --project-ref wictbtiulqmzzneyoelv
```

- [ ] **Step 3: Deploy Edge Functions to production**

```bash
npx supabase functions deploy generate-qr-token --project-ref wictbtiulqmzzneyoelv
npx supabase functions deploy verify-qr-token --project-ref wictbtiulqmzzneyoelv
```

- [ ] **Step 4: Apply migration to production**

```bash
npx supabase db push --project-ref wictbtiulqmzzneyoelv
```

- [ ] **Step 5: Commit any remaining changes and push**

```bash
git add -A
git commit -m "feat: rotating QR codes - environment setup"
git push origin main
```
