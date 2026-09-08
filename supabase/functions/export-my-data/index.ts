import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Same auth pattern as mint-coa/finalize-transfer: verify the caller's
    // own JWT via the anon-key client, then do the actual reads with the
    // service-role client, scoped everywhere by this verified id/email -
    // never by anything the client could supply.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const uid = user.id;
    const email = (user.email || "").toLowerCase();

    // Every query below is scoped by uid/email pulled from the verified
    // token above, not by anything in the request body - there is no
    // request body this function reads at all.

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", uid)
      .maybeSingle();

    // "Artist data" - everything keyed to this account as the creator/owner.
    // Queried regardless of whether a profiles row exists, since an artist
    // account always has one, but this keeps the export honest (empty
    // arrays, not skipped) if that row is ever missing for some reason.
    const [
      artworksRes,
      collectionsRes,
      blockchainCoasRes,
      coaOwnershipAsArtistRes,
      coaPendingAsArtistRes,
      eventsRes,
      customPresetsRes,
      cvRequestsRes,
      moodboardItemsRes,
      wipProjectsRes,
      wipNotesRes,
      wipSketchesRes,
      wipConnectedArtworksRes,
      royaltyNotificationsAsArtistRes,
      activitiesRes,
    ] = await Promise.all([
      supabase.from("artworks").select("*").eq("artist_id", uid),
      supabase.from("collections").select("*").eq("artist_id", uid),
      supabase.from("blockchain_coas").select("*").eq("artist_id", uid),
      supabase.from("coa_ownership_history").select("*").eq("artist_id", uid),
      supabase.from("coa_pending_transfers").select("*").eq("artist_id", uid),
      supabase.from("events").select("*").eq("artist_id", uid),
      supabase.from("custom_presets").select("*").eq("artist_id", uid),
      supabase.from("cv_requests").select("*").eq("artist_id", uid),
      supabase.from("moodboard_items").select("*").eq("artist_id", uid),
      supabase.from("wip_projects").select("*").eq("artist_id", uid),
      supabase.from("wip_notes").select("*").eq("artist_id", uid),
      supabase.from("wip_sketches").select("*").eq("artist_id", uid),
      supabase.from("wip_connected_artworks").select("*").eq("artist_id", uid),
      supabase.from("royalty_notifications").select("*").eq("artist_id", uid),
      supabase.from("activities").select("*").eq("artist_id", uid),
    ]);

    // artwork_collections is a many-to-many join with no artist_id of its
    // own - scoped indirectly through the artist's own artwork ids.
    const artworkIds = (artworksRes.data || []).map((a: { id: string }) => a.id);
    const { data: artworkCollections } = artworkIds.length
      ? await supabase.from("artwork_collections").select("*").in("artwork_id", artworkIds)
      : { data: [] };

    const artistData = {
      artworks: artworksRes.data || [],
      collections: collectionsRes.data || [],
      artwork_collections: artworkCollections || [],
      blockchain_coas: blockchainCoasRes.data || [],
      coa_ownership_history: coaOwnershipAsArtistRes.data || [],
      coa_pending_transfers: coaPendingAsArtistRes.data || [],
      events: eventsRes.data || [],
      custom_presets: customPresetsRes.data || [],
      cv_requests: cvRequestsRes.data || [],
      moodboard_items: moodboardItemsRes.data || [],
      wip_projects: wipProjectsRes.data || [],
      wip_notes: wipNotesRes.data || [],
      wip_sketches: wipSketchesRes.data || [],
      wip_connected_artworks: wipConnectedArtworksRes.data || [],
      royalty_notifications: royaltyNotificationsAsArtistRes.data || [],
      activities: activitiesRes.data || [],
    };

    // "Collector data" - everything keyed to this account's email as a
    // certificate owner, plus their own collector_accounts row. Matched by
    // email (lowercased both sides), same as the RLS policies these tables
    // already use for a collector's own reads - not by uid, since these
    // tables identify a collector by email, not auth id.
    const [
      collectorAccountRes,
      coaOwnershipAsCollectorRes,
      disputesFiledRes,
      incomingPendingTransfersRes,
      royaltyAsBuyerRes,
    ] = await Promise.all([
      supabase.from("collector_accounts").select("*").or(`supabase_user_id.eq.${uid},email.ilike.${email}`).maybeSingle(),
      supabase.from("coa_ownership_history").select("*").ilike("owner_email", email),
      supabase.from("coa_disputes").select("*").eq("collector_id", uid),
      supabase.from("coa_pending_transfers").select("*").ilike("new_collector_email", email),
      supabase.from("royalty_notifications").select("*").ilike("new_owner_email", email),
    ]);

    const collectorData = {
      collector_account: collectorAccountRes.data || null,
      certificate_ownership_history: coaOwnershipAsCollectorRes.data || [],
      disputes_filed: disputesFiledRes.data || [],
      incoming_pending_transfers: incomingPendingTransfersRes.data || [],
      royalty_notifications_as_buyer: royaltyAsBuyerRes.data || [],
    };

    // Security data: disclosed in the Privacy Policy (Section 1) as data
    // TRAC holds about every account. Keyed by email, not uid - this table
    // predates any session and isn't tied to auth.users.
    const { data: loginAttempts } = await supabase
      .from("login_attempts")
      .select("*")
      .ilike("email", email);

    const exportPayload = {
      export_generated_at: new Date().toISOString(),
      account: { id: uid, email: user.email },
      profile: profile || null,
      artist_data: artistData,
      collector_data: collectorData,
      security: { login_attempts: loginAttempts || [] },
    };

    const filename = `trac-data-export-${new Date().toISOString().slice(0, 10)}.json`;

    return new Response(JSON.stringify(exportPayload, null, 2), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
