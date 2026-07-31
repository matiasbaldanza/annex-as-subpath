/**
 * The network shell.
 *
 * Everything here talks to the world and returns a plain object. Nothing here
 * decides whether a result is good — that is `checks.js`, which is pure and
 * therefore testable against fixtures without a network.
 */

import { promises as dns } from "node:dns";

/**
 * Fetch a URL, following redirects by hand.
 *
 * By hand because the redirect *chain* is the evidence. Several of the
 * failures this tool exists to catch are invisible in the final response and
 * obvious in the hops: a 301 back to the apex, a `Location` carrying a
 * deployment host, a trailing-slash normalisation that changes origin.
 */
export async function probe(url, { fetchImpl = fetch, timeout = 10_000, maxHops = 10 } = {}) {
  const chain = [];
  let current = url;

  for (let hop = 0; hop <= maxHops; hop += 1) {
    let response;
    try {
      response = await fetchImpl(current, {
        redirect: "manual",
        headers: { "user-agent": "annex-as-subpath/doctor" },
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      return {
        requestedUrl: url,
        finalUrl: current,
        chain,
        error: describeNetworkError(error),
      };
    }

    const headers = headersToObject(response.headers);
    const location = headers.location ?? null;
    const isRedirect = response.status >= 300 && response.status < 400 && location;

    if (isRedirect) {
      chain.push({
        url: current,
        status: response.status,
        // Kept raw as well as resolved: whether Next emitted a relative
        // `Location` is the difference between a harmless normalisation and a
        // redirect that leaks the deployment host to the browser.
        location,
        locationIsRelative: !/^[a-z][a-z0-9+.-]*:/i.test(location) && !location.startsWith("//"),
        resolved: new URL(location, current).href,
      });
      current = new URL(location, current).href;
      continue;
    }

    return {
      requestedUrl: url,
      finalUrl: current,
      status: response.status,
      headers,
      chain,
      body: await response.text().catch(() => ""),
    };
  }

  return {
    requestedUrl: url,
    finalUrl: current,
    chain,
    error: `More than ${maxHops} redirects — this is a loop.`,
  };
}

/**
 * Fetch only the head of the chain: status and headers of the first response,
 * without following it. Used where the redirect itself is the subject.
 */
export async function probeNoFollow(url, { fetchImpl = fetch, timeout = 10_000 } = {}) {
  try {
    const response = await fetchImpl(url, {
      redirect: "manual",
      headers: { "user-agent": "annex-as-subpath/doctor" },
      signal: AbortSignal.timeout(timeout),
    });
    const headers = headersToObject(response.headers);
    return {
      requestedUrl: url,
      status: response.status,
      headers,
      location: headers.location ?? null,
      resolved: headers.location ? new URL(headers.location, url).href : null,
    };
  } catch (error) {
    return { requestedUrl: url, error: describeNetworkError(error) };
  }
}

/** Resolve CNAME records, returning `[]` rather than throwing on NXDOMAIN. */
export async function resolveCname(hostname, { resolver = dns } = {}) {
  try {
    return { records: await resolver.resolveCname(hostname) };
  } catch (error) {
    return { records: [], error: error.code ?? error.message };
  }
}

function headersToObject(headers) {
  const out = {};
  for (const [key, value] of headers) out[key.toLowerCase()] = value;
  return out;
}

function describeNetworkError(error) {
  if (error.name === "TimeoutError") return "Timed out.";
  // undici wraps DNS and TLS failures one level down, where the useful code is.
  const cause = error.cause?.code ?? error.cause?.message;
  return cause ? `${error.message} (${cause})` : error.message;
}
