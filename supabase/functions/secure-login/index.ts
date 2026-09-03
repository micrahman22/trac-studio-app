import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Same escalation this project's original Password Verification Attempt
// hook used (that approach turned out to need a Team/Enterprise plan this
// project doesn't have, hence doing the check here instead) - failed_count
// only ever climbs across cycles, a genuine correct password always
// succeeds and resets it immediately regardless of lockout state. See the
// signIn() branch below for why a correct password is never blocked even
// mid-lockout: once someone actually holds it, delaying that one attempt
// adds no security and only enables locking a victim out for up to 24h
// using nothing but their email.
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

function formatRemaining(ms: number): string {
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, password, captchaToken } = await req.json();
    if (!email || !password) {
      return json({ error: "Missing email or password" }, 400);
    }
    const normalizedEmail = email.toLowerCase();

    // Service role for the login_attempts table only - it has no RLS
    // policies at all (deny-everything to anon/authenticated), by design,
    // since it's purely an internal control this function is the sole
    // reader/writer of.
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: existing } = await supabase
      .from("login_attempts")
      .select("failed_count, locked_until")
      .eq("email", normalizedEmail)
      .maybeSingle();

    const now = Date.now();
    const lockedUntilMs = existing?.locked_until ? new Date(existing.locked_until).getTime() : 0;
    const alreadyLocked = lockedUntilMs > now;

    // The actual credential check always runs, locked out or not - anon key
    // is correct here, this is exactly the same call the browser used to
    // make directly. Skipping it while locked (an earlier version of this
    // function did) would also skip the one case that has to keep working:
    // a genuinely correct password. That's safe to do unconditionally
    // because every *wrong* password gets an identical opaque response
    // whether or not it was actually checked - an attacker mid-lockout
    // learns nothing extra by continuing to guess, since "wrong" always
    // looks the same. Only a correct password produces a different result.
    //
    // captchaToken is forwarded straight through to this call - it's what
    // Supabase Auth itself verifies server-side against Turnstile
    // (security_captcha_enabled), regardless of caller. That's the real
    // defense against a direct REST API call bypassing this function
    // entirely; the lockout logic above is only a secondary layer for
    // whoever's going through this form specifically.
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({
      email: normalizedEmail,
      password,
      options: { captchaToken },
    });

    if (signInError || !signInData.session) {
      if (alreadyLocked) {
        // Still locked - reject with the same message as a fresh lockout,
        // without incrementing further. No need to make an already-maxed
        // window worse, and this keeps every wrong-during-lockout response
        // identical regardless of whether the guess happened to be closer.
        return json({
          error: `Too many failed attempts. Try again in ${formatRemaining(lockedUntilMs - now)}.`,
        }, 429);
      }

      const newFailedCount = (existing?.failed_count ?? 0) + 1;
      const durationMs = lockoutDurationFor(newFailedCount);
      const newLockedUntil = durationMs > 0 ? new Date(now + durationMs).toISOString() : null;

      await supabase.from("login_attempts").upsert({
        email: normalizedEmail,
        failed_count: newFailedCount,
        locked_until: newLockedUntil,
        updated_at: new Date().toISOString(),
      });

      if (newLockedUntil) {
        return json({
          error: `Too many failed attempts. Try again in ${formatRemaining(durationMs)}.`,
        }, 429);
      }

      // Under threshold - same generic message GoTrue itself would have
      // given the caller directly, so this adds friction without revealing
      // the count.
      return json({ error: signInError?.message || "Invalid login credentials" }, 400);
    }

    // Genuine successful login - wipe the slate clean immediately, even if
    // they were partway up the failure tiers under a previous wrong guess.
    if (existing && (existing.failed_count > 0 || existing.locked_until)) {
      await supabase
        .from("login_attempts")
        .update({ failed_count: 0, locked_until: null, updated_at: new Date().toISOString() })
        .eq("email", normalizedEmail);
    }

    return json({
      user: signInData.user,
      session: {
        access_token: signInData.session.access_token,
        refresh_token: signInData.session.refresh_token,
      },
    });
  } catch (err) {
    console.error("Unhandled error:", err.message);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
