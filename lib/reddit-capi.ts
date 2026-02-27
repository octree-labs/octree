const REDDIT_CAPI_URL = 'https://ads-api.reddit.com/api/v2.0/conversions/events/a2_eqcdwpyzgy6x';

type StandardTrackingType = 'PageVisit' | 'ViewContent' | 'Search' | 'AddToCart' | 'AddToWishlist' | 'Purchase' | 'Lead' | 'SignUp';

type EventType =
  | { tracking_type: StandardTrackingType }
  | { tracking_type: 'Custom'; custom_event_name: string };

interface RedditConversionEvent {
  event_at: string;
  event_type: EventType;
  user?: {
    ip_address?: string;
    user_agent?: string;
    email?: string;
    external_id?: string;
  };
  event_metadata?: {
    conversion_id?: string;
  };
}

export async function trackRedditConversion({
  eventName,
  conversionId,
  email,
  externalId,
  ipAddress,
  userAgent,
}: {
  eventName: string;
  conversionId: string;
  email?: string;
  externalId?: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  const token = process.env.REDDIT_CAPI_ACCESS_TOKEN;
  if (!token) return;

  const standardEvents: StandardTrackingType[] = [
    'PageVisit', 'ViewContent', 'Search', 'AddToCart',
    'AddToWishlist', 'Purchase', 'Lead', 'SignUp',
  ];

  const eventType: EventType = standardEvents.includes(eventName as StandardTrackingType)
    ? { tracking_type: eventName as StandardTrackingType }
    : { tracking_type: 'Custom', custom_event_name: eventName };

  const event: RedditConversionEvent = {
    event_at: new Date().toISOString(),
    event_type: eventType,
    event_metadata: {
      conversion_id: conversionId,
    },
  };

  const user: RedditConversionEvent['user'] = {};
  if (ipAddress) user.ip_address = ipAddress;
  if (userAgent) user.user_agent = userAgent;
  if (email) user.email = email;
  if (externalId) user.external_id = externalId;
  if (Object.keys(user).length > 0) event.user = user;

  try {
    const res = await fetch(REDDIT_CAPI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ events: [event] }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('Reddit CAPI error:', res.status, body);
    }
  } catch (err) {
    console.error('Reddit CAPI request failed:', err);
  }
}
