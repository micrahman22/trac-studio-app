import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ethers } from "https://esm.sh/ethers@6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const POLYGON_RPC_URL = Deno.env.get("POLYGON_RPC_URL")!;
const POLYGON_PRIVATE_KEY = Deno.env.get("PLATFORM_WALLET_PRIVATE_KEY")!;
const POLYGON_CONTRACT_ADDRESS = Deno.env.get("POLYGON_CONTRACT_ADDRESS")!;
const POLYGON_CHAIN_ID = 80002; // Polygon Amoy testnet - fixed, not a secret.

const CONTRACT_ABI = [
  "function mintCoa(string metadataURI) returns (uint256)",
  "function recordTransfer(uint256 tokenId, string note)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { pending_transfer_id, royalty_confirmed } = await req.json();

    if (!pending_transfer_id) {
      return json({ error: "Missing pending_transfer_id" }, 400);
    }
    if (royalty_confirmed !== true) {
      return json({ error: "Royalty must be confirmed before finalizing." }, 400);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Atomic claim: pending -> finalized, only if it's still pending AND owned
    // by this caller, in the same UPDATE that checks both. Same pattern as
    // send-cv-email's pending->approved claim - whichever concurrent call
    // (or repeat call) loses the race gets zero rows back here and stops
    // immediately, before anything else happens. This is what makes double-
    // finalizing a given pending_transfer_id impossible, not just unlikely.
    const { data: pending, error: claimError } = await supabase
      .from("coa_pending_transfers")
      .update({ status: "finalized", finalized_at: new Date().toISOString(), royalty_confirmed: true })
      .eq("id", pending_transfer_id)
      .eq("artist_id", user.id)
      .eq("status", "pending")
      .select()
      .single();

    if (claimError || !pending) {
      return json({ error: "Pending transfer not found or already finalized" }, 404);
    }

    // Every failure path from here needs to hand the claim back to pending -
    // otherwise a transient failure leaves this permanently "finalized" with
    // no ownership record ever written, and no way to retry (the unique
    // one-open-transfer-per-coa index would block a fresh initiate too).
    async function revertToPending() {
      await supabase
        .from("coa_pending_transfers")
        .update({ status: "pending", finalized_at: null, royalty_confirmed: false })
        .eq("id", pending_transfer_id)
        .eq("artist_id", user.id);
    }

    // Everything from here runs after the claim above has already flipped this
    // row to "finalized" - any exception between here and the final success
    // response, anticipated or not, must hand the claim back to pending before
    // this function exits. The specific branches below still call
    // revertToPending() themselves so they can return their own clear error
    // message; this wrapping try/catch exists for anything they didn't
    // anticipate (e.g. a thrown network error from a query, rather than a
    // normal returned {error}) - without it, that kind of failure would leave
    // the row stuck at "finalized" with no ownership record ever written.
    try {
      // Require an actual, completed collector account - not auto-provisioned
      // here. A collector_accounts row can exist as just an invite stub
      // (invite_status: 'pending') created by some earlier, unrelated mint/
      // transfer upsert elsewhere in the app; that doesn't count as "signed up".
      const { data: collectorAccount } = await supabase
        .from("collector_accounts")
        .select("email, display_name")
        .eq("email", pending.new_collector_email)
        .eq("invite_status", "registered")
        .maybeSingle();

      if (!collectorAccount) {
        await revertToPending();
        return json({ error: "This collector hasn't signed up yet. They need a TRAC Collector account before the transfer can be finalized." }, 400);
      }

      const { data: coa } = await supabase
        .from("blockchain_coas")
        .select("token_id")
        .eq("id", pending.coa_id)
        .single();

      if (!coa) {
        await revertToPending();
        return json({ error: "Certificate not found" }, 404);
      }

      // Records this transfer as an on-chain provenance event against the
      // existing token. The token itself never moves - it stays in platform
      // custody the whole time (see contracts/TracCoa.sol).
      let txHash: string;
      try {
        const provider = new ethers.JsonRpcProvider(POLYGON_RPC_URL, POLYGON_CHAIN_ID);
        const wallet = new ethers.Wallet(POLYGON_PRIVATE_KEY, provider);
        const contract = new ethers.Contract(POLYGON_CONTRACT_ADDRESS, CONTRACT_ABI, wallet);

        const tx = await contract.recordTransfer(coa.token_id, `Transferred to ${collectorAccount.email}`);
        await tx.wait(1);
        txHash = tx.hash;
      } catch (chainErr) {
        console.error("On-chain recordTransfer failed:", chainErr.message);
        await revertToPending();
        return json({ error: "Could not record transfer on-chain. Please try again." }, 502);
      }

      const { data: historyRow, error: historyError } = await supabase
        .from("coa_ownership_history")
        .insert({
          coa_id: pending.coa_id,
          artist_id: user.id,
          // Never fall back to the raw email here - it's rendered as the
          // displayed owner name everywhere this column shows up (the
          // artist's "Owner:" line, the collector's own provenance view).
          owner_name: collectorAccount.display_name || "Pending Collector",
          owner_email: collectorAccount.email,
          transfer_date: new Date().toISOString(),
          is_original_purchase: false,
          tx_hash: txHash,
        })
        .select()
        .single();

      if (historyError) {
        console.error("coa_ownership_history insert error:", historyError);
        await revertToPending();
        return json({ error: "Could not record transfer" }, 500);
      }

      let notified = true;
      try {
        const notifyRes = await fetch(`${SUPABASE_URL}/functions/v1/notify-collector`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ history_id: historyRow.id, event_type: "transfer" }),
        });
        notified = notifyRes.ok;
        if (!notifyRes.ok) console.error("notify-collector failed:", await notifyRes.text());
      } catch (notifyErr) {
        notified = false;
        console.error("notify-collector call failed:", notifyErr);
      }

      return json({ success: true, history_id: historyRow.id, notified });
    } catch (postClaimErr) {
      console.error("Unexpected error after claiming transfer:", postClaimErr.message);
      await revertToPending();
      return json({ error: "Could not finalize transfer. Please try again." }, 500);
    }
  } catch (err) {
    console.error("Unhandled error:", err.message);
    return json({ error: err.message }, 500);
  }
});
