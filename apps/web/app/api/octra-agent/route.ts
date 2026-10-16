import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasUnlimitedEdits } from '@/lib/paywall';
import type { TablesInsert } from '@/database.types';

// Import helper modules
import { createSSEHeaders } from '@/lib/octra-agent/stream-handling';
import { FREE_DAILY_EDIT_LIMIT, PRO_MONTHLY_EDIT_LIMIT } from '@/data/constants';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return NextResponse.json(
        { error: 'Unauthorized. Please log in to use AI features.' },
        { status: 401 }
      );
    }

    const user = session.user;

    // Check if user has unlimited edits (whitelisted)
    const hasUnlimited = hasUnlimitedEdits(user.email);

    // If not unlimited, check usage limits
    if (!hasUnlimited) {
      const usageRes = await supabase
        .from('user_usage')
        .select('edit_count, monthly_edit_count, is_pro, daily_reset_date, monthly_reset_date')
        .eq('user_id', user.id)
        .single();
      
      let usageData = usageRes.data as {
        edit_count: number;
        monthly_edit_count: number;
        is_pro: boolean;
        daily_reset_date: string | null;
        monthly_reset_date: string | null;
      } | null;
      const usageError = usageRes.error;

      // If no usage record exists, create one with default free tier limits
      // This prevents new users from bypassing quota checks entirely
      if (usageError && usageError.code === 'PGRST116') {
        console.log('[Security] Creating user_usage record for new user:', user.id);
        
        const newUsagePayload: TablesInsert<'user_usage'> = {
          user_id: user.id,
          edit_count: 0,
          monthly_edit_count: 0,
          monthly_reset_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          is_pro: false,
          subscription_status: 'inactive',
        };

        const newUsageRes = await (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          supabase.from('user_usage') as any
        )
          .insert(newUsagePayload)
          .select('edit_count, monthly_edit_count, daily_reset_date, monthly_reset_date, is_pro')
          .single();
        
        if (newUsageRes.error) {
          console.error('[Security] Failed to create usage record:', newUsageRes.error);
          return NextResponse.json(
            { error: 'Failed to initialize usage tracking' },
            { status: 500 }
          );
        }
        
        usageData = newUsageRes.data as {
          edit_count: number;
          monthly_edit_count: number;
          is_pro: boolean;
          daily_reset_date: string | null;
          monthly_reset_date: string | null;
        } | null;
      } else if (usageError) {
        console.error('[Security] Failed to fetch usage data:', usageError);
        return NextResponse.json(
          { error: 'Failed to check usage limits' },
          { status: 500 }
        );
      }

      // Now usageData is guaranteed to exist, perform limit checks
      if (usageData) {
        const isPro = usageData.is_pro;
        const editCount = usageData.edit_count || 0;
        const monthlyEditCount = usageData.monthly_edit_count || 0;

        // Check if daily reset is needed for free users
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dailyResetDate = usageData.daily_reset_date 
          ? new Date(usageData.daily_reset_date + 'T00:00:00')
          : null;
        const needsDailyReset = !isPro && dailyResetDate && today > dailyResetDate;

        // Check limits
        const hasReachedLimit = isPro
          ? monthlyEditCount >= PRO_MONTHLY_EDIT_LIMIT
          : (!needsDailyReset && editCount >= FREE_DAILY_EDIT_LIMIT);

        if (hasReachedLimit) {
          const limitMessage = isPro
            ? `You've reached your monthly limit of ${PRO_MONTHLY_EDIT_LIMIT} edits. Your limit will reset on your billing date.`
            : `You've reached your daily limit of ${FREE_DAILY_EDIT_LIMIT} edits. Upgrade to Pro for ${PRO_MONTHLY_EDIT_LIMIT} edits per month!`;

          return NextResponse.json(
            { error: limitMessage, limitReached: true },
            { status: 429 }
          );
        }
      }
    }

    if (!hasUnlimited) {
      let incrementResult;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await supabase.rpc('increment_edit_count', { p_user_id: user.id } as any);
        
        if (error) {
          console.error('Failed to increment edit count:', error);
          return NextResponse.json(
            { error: 'Failed to update usage tracking' },
            { status: 500 }
          );
        }
        
        incrementResult = data as boolean;
      } catch (incrementError) {
        console.error('Exception incrementing edit count:', incrementError);
        return NextResponse.json(
          { error: 'Failed to update usage tracking' },
          { status: 500 }
        );
      }

      // If increment returned false, the limit was reached between our check and the increment (concurrent requests).
      // Deny the request to prevent over-quota usage.
      if (!incrementResult) {
        console.warn(`[Security] Race condition detected: increment denied for user ${user.id}`);
        
        // Re-fetch current usage to provide accurate error message
        const usageRes = await supabase
          .from('user_usage')
          .select('is_pro, edit_count, monthly_edit_count')
          .eq('user_id', user.id)
          .single();
        
        const usageData = usageRes.data as { is_pro: boolean; edit_count: number; monthly_edit_count: number } | null;
        const isPro = usageData?.is_pro || false;
        
        const limitMessage = isPro
          ? `You've reached your monthly limit of ${PRO_MONTHLY_EDIT_LIMIT} edits. Your limit will reset on your billing date.`
          : `You've reached your daily limit of ${FREE_DAILY_EDIT_LIMIT} edits. Upgrade to Pro for ${PRO_MONTHLY_EDIT_LIMIT} edits per month!`;

        return NextResponse.json(
          { error: limitMessage, limitReached: true },
          { status: 429 }
        );
      }
    } else {
      console.log(`[Unlimited] Skipping quota tracking for whitelisted user: ${user.email}`);
    }

    const remoteUrl = process.env.CLAUDE_AGENT_SERVICE_URL;
    if (!remoteUrl) {
      console.error('[Octra Proxy] CLAUDE_AGENT_SERVICE_URL is not configured');
      return NextResponse.json(
        {
          error: 'Agent service unavailable',
          details: 'CLAUDE_AGENT_SERVICE_URL is not configured on the server',
        },
        { status: 503 }
      );
    }

    const body = await request.json();
    console.log(
      '[Octra Proxy] Forwarding authenticated request to remote Claude Code server:',
      remoteUrl
    );

    const res = await fetch(remoteUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        'authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok || !res.body) {
      console.error('[Octra Proxy] Remote server failed:', res.status, res.statusText);
      return NextResponse.json(
        { error: 'Remote agent service failed', status: res.status },
        { status: 502 }
      );
    }

    console.log('[Octra Proxy] Streaming response from remote server...');

    // Create a transform stream to log events as they pass through
    const { readable, writable } = new TransformStream();
    const reader = res.body.getReader();
    const writer = writable.getWriter();
    const decoder = new TextDecoder();

    // Stream and log events
    (async () => {
      try {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Pass through immediately
          await writer.write(value);

          // Log events for debugging
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          // Parse complete events (separated by \n\n)
          let sepIndex;
          while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
            const event = buffer.slice(0, sepIndex);
            buffer = buffer.slice(sepIndex + 2);

            // Log the event type
            const eventMatch = event.match(/event:\s*(\S+)/);
            const dataMatch = event.match(/data:\s*([\s\S]+)/);
            if (eventMatch) {
              const eventType = eventMatch[1];
              console.log(`[Octra Proxy] Event received: ${eventType}`);

              // Log tool events in detail
              if (eventType === 'tool' && dataMatch) {
                try {
                  const data = JSON.parse(dataMatch[1]);
                  console.log(
                    `[Octra Proxy] Tool called: ${data.name}, count: ${data.count || 0}`
                  );
                } catch {}
              }
            }
          }
        }
        // Close writer if not already closed
        try {
          await writer.close();
        } catch (e) {
          // Writer already closed, ignore
        }
      } catch (err) {
        // Ignore abort errors (expected when client stops)
        const error = err as Error;
        if (error?.name === 'AbortError' || error?.constructor?.name === 'ResponseAborted') {
          console.log('[Octra Proxy] Stream aborted by client');
        } else {
          console.error('[Octra Proxy] Stream error:', err);
        }
        // Try to abort writer if not already closed
        try {
          await writer.abort();
        } catch {
          // Already closed, ignore
        }
      } finally {
        // Clean up reader
        try {
          await reader.cancel();
        } catch {
          // Already cancelled, ignore
        }
      }
    })();

    return new Response(readable, { headers: createSSEHeaders() });
  } catch (error) {
    console.error('Octra Agent SDK error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to process agent request', details: message },
      { status: 500 }
    );
  }
}
