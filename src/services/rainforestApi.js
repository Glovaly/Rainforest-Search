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
  const url = new URL('https://api.rainforestapi.com/request');
  url.searchParams.set('api_key', config.RAINFOREST_API_KEY);
  url.searchParams.set('type', 'search');
  url.searchParams.set('amazon_domain', config.AMAZON_DOMAIN);
  url.searchParams.set('search_term', title);
  url.searchParams.set('exclude_sponsored', 'true');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url.toString(), { signal: controller.signal });

    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      throw new RateLimitError(
        retryAfter ? parseInt(retryAfter, 10) * 1000 : null
      );
    }

    if (!response.ok) {
      throw new ApiError(`HTTP ${response.status}`, response.status);
    }

    const data = await response.json();

    if (data.search_results && data.search_results.length > 0) {
      const top = data.search_results[0];
      return {
        asin: top.asin,
        product_url: top.link || top.product_url || `https://www.amazon.com/dp/${top.asin}`,
        status: 'found',
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
