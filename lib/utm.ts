/**
 * UTM campaign params that must survive a server redirect.
 *
 * tools.useoctree.com links and form-posts into the app with
 * `utm_source/utm_medium/utm_campaign`. PostHog shares the distinct_id across
 * subdomains via cookie, but campaign params are stored per origin, so the
 * app's first pageview has to carry the query. A 303 drops the POST URL's
 * query, hence copying them onto the redirect target.
 */
// Lowercase letters only, as tools and PostHog's campaign keys use them:
// `UTM_Source`, `utm_` and `utm_content2` are dropped on purpose.
// Values are capped before URLSearchParams re-encodes them, so the cap
// can never split a percent-escape.
const UTM_KEY = /^utm_[a-z]+$/;
const UTM_MAX_VALUE_CHARS = 200;

export function pickUtmParams(searchParams: URLSearchParams): [string, string][] {
  const picked: [string, string][] = [];
  const seen = new Set<string>();
  for (const [key, value] of searchParams) {
    if (!UTM_KEY.test(key) || seen.has(key) || !value) continue;
    seen.add(key);
    picked.push([key, value.slice(0, UTM_MAX_VALUE_CHARS)]);
  }
  return picked;
}

/** Copies the utm_* params of `source` onto `target` (mutates and returns it). */
export function appendUtmParams(target: URL, source: URLSearchParams): URL {
  for (const [key, value] of pickUtmParams(source)) {
    target.searchParams.set(key, value);
  }
  return target;
}
