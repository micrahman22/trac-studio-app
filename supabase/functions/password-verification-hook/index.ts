import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// The signing secret GoTrue shows once "Password Verification Attempt" is
// enabled in Dashboard > Auth > Hooks - same env-secret pattern already used
// for RESEND_API_KEY/PLATFORM_WALLET_PRIVATE_KEY elsewhere in this project.
const HOOK_SECRET = Deno.env.get("PASSWORD_HOOK_SECRET")!;

// Escalating lockout: failed_count only ever climbs across cycles (a
// genuine successful login is the only thing that resets it), so a
// sustained attacker keeps working up these tiers instead of just waiting
// out one fixed window and resuming. Only wrong guesses are throttled - see
// the valid:true branch below for why a correct password is never blocked,
// even mid-lockout.
const LOCKOUT_TIERS: Array<[threshold: number, durationMs: number]> = [
  [20, 24 * 60 * 60 * 1000], // 24h
  [15, 30 * 60 * 1000],      // 30m
  [10, 5 * 60 * 1000],       // 5m
  [5, 60 * 1000],            // 1m
];

function lockoutDurationFor(failedCount: number): number {
  for (const [threshold, duration] of LOCKOUT_TIERS) {
    if (failedCount >= threshold) return duration;
  }
  return 0;
}

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

// Constant-time compare - this guards a signature check, so a
// length/short-circuit-revealing comparison would defeat the point of
// verifying the signature at all.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Standard Webhooks verification (the scheme GoTrue's Auth Hooks use) -
// implemented directly against Deno's built-in crypto.subtle rather than
// pulling in the standardwebhooks package, matching this repo's existing
// preference for a handful of well-understood bare imports over extra
// dependencies for something this small.
async function verifyHookSignature(payload: string, headers: Headers, secret: string): Promise<boolean> {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatureHeader = headers.get("webhook-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  const secretBytes = base64ToBytes(secret.replace(/^whsec_/, ""));
  const signedContent = `${id}.${timestamp}.${payload}`;

  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent));
  const expectedSig = bytesToBase64(new Uint8Array(sigBuffer));

  // webhook-signature can carry multiple space-separated "v1,<sig>" values
  // (key rotation) - any one matching is enough.
  return signatureHeader
    .split(" ")
    .some((part) => {
      const sig = part.split(",")[1];
      return sig ? timingSafeEqual(sig, expectedSig) : false;
    });
}

function formatRemaining(ms: number): string {
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function decision(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  const rawBody = await req.text();

  const verified = await verifyHookSignature(rawBody, req.headers, HOOK_SECRET);
  if (!verified) {
    console.error("Password verification hook: signature check failed");
    // Not a "decision" response - this is GoTrue-shaped auth for the call
    // itself, not a verdict about the login attempt, so it gets a real
    // 401 rather than a {decision: reject} body.
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let payload: { user_id?: string; valid?: boolean };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const { user_id, valid } = payload;
  if (!user_id || typeof valid !== "boolean") {
    return new Response(JSON.stringify({ error: "Missing user_id or valid" }), { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: existing } = await supabase
    .from("login_attempts")
    .select("failed_count, locked_until")
    .eq("user_id", user_id)
    .maybeSingle();

  const now = Date.now();
  const lockedUntilMs = existing?.locked_until ? new Date(existing.locked_until).getTime() : 0;

  // A provably correct password always gets through, locked out or not -
  // checked before the lockout gate, not after. Reasoning changed from the
  // original design (which rejected valid:true too) after live-testing the
  // actual password-reset flow: index.html's reset UX explicitly signs the
  // user out and asks them to sign back in with the new password through
  // this same grant_type=password path once they've reset it, so rejecting
  // a correct password here would strand a legitimate user who just reset
  // their way past a lockout they were caught in under their OLD password.
  // Blocking a *known-correct* credential adds no real security once
  // someone already possesses it - whoever's holding it either is the
  // owner, or the account is already compromised regardless of whether this
  // one attempt is delayed - while a firm reject here directly enables
  // locking a victim out for up to 24h with nothing but their email and no
  // way back in except waiting. The lockout still fully throttles every
  // *wrong* guess, which is the actual thing being brute-forced.
  if (valid) {
    if (existing && (existing.failed_count > 0 || existing.locked_until)) {
      await supabase
        .from("login_attempts")
        .update({ failed_count: 0, locked_until: null, updated_at: new Date().toISOString() })
        .eq("user_id", user_id);
    }
    return decision({ decision: "continue" });
  }

  // Wrong password. Already inside an active lockout window from earlier
  // wrong guesses - reject without incrementing further, no need to make an
  // already-maxed-out window worse.
  if (lockedUntilMs > now) {
    return decision({
      decision: "reject",
      message: `Too many failed attempts. Try again in ${formatRemaining(lockedUntilMs - now)}.`,
    });
  }

  const newFailedCount = (existing?.failed_count ?? 0) + 1;
  const durationMs = lockoutDurationFor(newFailedCount);
  const newLockedUntil = durationMs > 0 ? new Date(now + durationMs).toISOString() : null;

  await supabase.from("login_attempts").upsert({
    user_id,
    failed_count: newFailedCount,
    locked_until: newLockedUntil,
    updated_at: new Date().toISOString(),
  });

  if (newLockedUntil) {
    return decision({
      decision: "reject",
      message: `Too many failed attempts. Try again in ${formatRemaining(durationMs)}.`,
    });
  }

  // Under threshold - GoTrue still returns its own normal "invalid
  // credentials" error to the client either way; this hook only ever adds
  // friction on top, never reveals the count itself.
  return decision({ decision: "continue" });
});
