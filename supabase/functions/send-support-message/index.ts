import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "onboarding@resend.dev";
const SUPPORT_TO_EMAIL = Deno.env.get("SUPPORT_TO_EMAIL") || "support@tracstudio.app";

const MESSAGE_MAX_LENGTH = 4000;
const SUBJECT_MAX_LENGTH = 200;
const RATE_LIMIT_WINDOW_HOURS = 1;
const RATE_LIMIT_MAX_MESSAGES = 5;

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

// Escapes a value for safe interpolation into the HTML email body below.
function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { subject, message } = await req.json();

    if (!message || typeof message !== "string" || !message.trim()) {
      return json({ error: "Message cannot be empty." }, 400);
    }
    if (message.length > MESSAGE_MAX_LENGTH) {
      return json({ error: `Message must be ${MESSAGE_MAX_LENGTH} characters or fewer.` }, 400);
    }
    if (subject !== undefined && subject !== null && String(subject).length > SUBJECT_MAX_LENGTH) {
      return json({ error: `Subject must be ${SUBJECT_MAX_LENGTH} characters or fewer.` }, 400);
    }

    // Same auth pattern as send-cv-email: verify the caller's own JWT via
    // the anon-key client, never trust a client-supplied identity - the
    // sender's name/email in the message always comes from their verified
    // session below, not anything in the request body.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user || !user.email) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Light per-user throttle, same spirit as mint-coa's rate limit - just
    // enough to stop someone from spamming the form, not strict. Checked
    // before sending anything, so a blocked attempt costs nothing.
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    const { count: recentMessageCount } = await supabase
      .from("support_messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", windowStart);

    if ((recentMessageCount ?? 0) >= RATE_LIMIT_MAX_MESSAGES) {
      return json({
        error: `You've reached the limit of ${RATE_LIMIT_MAX_MESSAGES} messages per hour. Please try again later.`,
      }, 429);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, username")
      .eq("id", user.id)
      .maybeSingle();
    const senderName = profile?.full_name || profile?.username || user.email;

    const subjectLine = subject && String(subject).trim()
      ? String(subject).trim()
      : "New support message";

    const emailHtml = [
      '<div style="font-family: -apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif; max-width: 560px; margin: 0 auto; background: #fff; border: 1px solid #e5e5e5; border-radius: 12px; overflow: hidden;">',
      '  <div style="padding: 1.75rem 2rem 1.25rem; border-bottom: 1px solid #e5e5e5;">',
      '    <span style="display: inline-block; background: #0d0d0c; color: #ffffff; font-weight: 600; letter-spacing: 0.02em; border-radius: 6px; padding: 0.5rem 0.9rem; font-size: 1rem;">TRAC</span>',
      '  </div>',
      '  <div style="padding: 2rem; color: #333;">',
      '    <h2 style="font-weight: 300; font-size: 1.6rem; margin: 0 0 1rem;">',
      '      New message from ' + escapeHtml(senderName),
      '    </h2>',
      // Reply-to instruction moved above the message box and made a
      // distinct callout, not a small gray afterthought line - this is the
      // one action that matters most in this specific email, so it gets
      // the same visual weight the black CTA buttons get elsewhere, not a
      // plain paragraph.
      '    <div style="border-left: 3px solid #0d0d0c; padding: 0.1rem 0 0.1rem 1rem; margin: 0 0 1.5rem; font-size: 0.85rem; color: #0d0d0c; line-height: 1.5;">',
      '      <strong>Reply directly to this email</strong> to respond - it goes straight back to ' + escapeHtml(user.email) + '.',
      '    </div>',
      '    <div style="background: #f9f9f9; border: 1px solid #e5e5e5; border-radius: 8px; padding: 1.25rem;">',
      '      <p style="margin: 0 0 0.5rem 0;"><strong>From:</strong> ' + escapeHtml(senderName) + ' (' + escapeHtml(user.email) + ')</p>',
      '      <p style="margin: 0 0 0.5rem 0;"><strong>Subject:</strong> ' + escapeHtml(subjectLine) + '</p>',
      '      <p style="margin: 0.75rem 0 0 0;"><strong>Message:</strong><br>' + escapeHtml(message).replace(/\n/g, '<br>') + '</p>',
      '    </div>',
      '  </div>',
      '  <div style="padding: 1.25rem 2rem; border-top: 1px solid #e5e5e5; text-align: center;">',
      '    <p style="color: #999; font-size: 0.75rem; margin: 0; line-height: 1.5;">',
      '      Sent via <a href="https://tracstudio.app" style="color: #999; text-decoration: underline;">TRACStudio</a>',
      '    </p>',
      '  </div>',
      '</div>',
    ].join("\n");

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: SUPPORT_TO_EMAIL,
        reply_to: user.email,
        subject: "[Support] " + subjectLine,
        html: emailHtml,
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error("Resend error:", errText);
      return json({ error: "Could not send your message. Please try again." }, 500);
    }

    // Logged after the send succeeds, not before - this row is purely a
    // rate-limit counter and audit record, not a claim/queue like
    // cv_requests, so there's nothing to revert on a send failure above.
    await supabase.from("support_messages").insert({
      user_id: user.id,
      user_email: user.email,
      subject: subjectLine,
      message,
    });

    return json({ success: true });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
