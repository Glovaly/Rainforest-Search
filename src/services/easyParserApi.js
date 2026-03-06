const config = require('../config');

class RateLimitError extends Error {
  constructor(retryAfterMs) {
    super('Rate limit exceeded');
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

class ApiError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
  }
}

async function searchProduct(title) {
  const url = new URL('https://realtime.easyparser.com/v1/request');
  url.searchParams.set('api_key', config.EASYPARSER_API_KEY);
  url.searchParams.set('platform', 'AMZ');
  url.searchParams.set('operation', 'SEARCH');
  url.searchParams.set('domain', config.AMAZON_DOMAIN);
  url.searchParams.set('keyword', title);
  url.searchParams.set('output', 'json');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'ASINFinder/1.0',
      },
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      throw new RateLimitError(
        retryAfter ? parseInt(retryAfter, 10) * 1000 : null
      );
    }

    if (!response.ok) {
      throw new ApiError(`HTTP ${response.status}`, response.status);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const body = await response.text();
      console.error('[EasyParser] Non-JSON response:', contentType, body.substring(0, 500));
      throw new ApiError('EasyParser returned non-JSON response (possible Cloudflare block)', 502);
    }

    const data = await response.json();

    // Check EasyParser's success flag
    if (data.request_info && !data.request_info.success) {
      throw new ApiError(
        data.request_info.message || `API error: ${data.request_info.status_code}`,
        data.request_info.status_code || 500
      );
    }

    // Extract search results from EasyParser response
    const results = data.result?.search_results
      || data.result?.results
      || (Array.isArray(data.result) ? data.result : null);

    if (results && results.length > 0) {
      const top = results[0];
      const asin = top.asin;
      const productUrl = top.url || top.link || top.product_url
        || (asin ? `https://www.amazon.com/dp/${asin}` : null);

      return {
        asin,
        product_url: productUrl,
        status: asin ? 'found' : 'not_found',
      };
    }

    return { asin: null, product_url: null, status: 'not_found' };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ApiError('Request timeout (30s)', 408);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { searchProduct, RateLimitError, ApiError };
