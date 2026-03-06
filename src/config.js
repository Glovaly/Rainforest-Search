module.exports = {
  PORT: process.env.PORT || 3000,
  RAINFOREST_API_KEY: process.env.RAINFOREST_API_KEY,
  SESSION_SECRET: process.env.SESSION_SECRET || 'change-me-in-production',
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  CONCURRENCY: parseInt(process.env.CONCURRENCY || '2', 10),
  REQUEST_DELAY_MS: parseInt(process.env.REQUEST_DELAY_MS || '500', 10),
  MAX_RETRIES: parseInt(process.env.MAX_RETRIES || '2', 10),
  RETRY_BASE_DELAY_MS: parseInt(process.env.RETRY_BASE_DELAY_MS || '2000', 10),
  AMAZON_DOMAIN: process.env.AMAZON_DOMAIN || 'amazon.com',
};
