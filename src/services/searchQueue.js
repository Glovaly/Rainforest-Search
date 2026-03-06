const PQueue = require('p-queue').default;
const { EventEmitter } = require('events');
const { searchProduct, RateLimitError } = require('./rainforestApi');
const db = require('../db');
const config = require('../config');

class SearchQueue extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
    this.queue = new PQueue({
      concurrency: config.CONCURRENCY,
      interval: config.REQUEST_DELAY_MS,
      intervalCap: config.CONCURRENCY,
    });
  }

  async processJob(jobId) {
    try {
      await db.updateJobStatus(jobId, 'processing');

      const results = await db.getPendingResults(jobId);

      const promises = results.map((result) =>
        this.queue.add(() => this.processTitle(jobId, result))
      );

      await Promise.allSettled(promises);

      const progress = await db.getJobProgress(jobId);
      await db.updateJobStatus(jobId, 'completed');

      this.emit(`job:${jobId}`, {
        type: 'done',
        total: progress.total_titles,
        completed: progress.completed,
        found: progress.found,
        not_found: progress.not_found,
        errors: progress.errors,
      });
    } catch (err) {
      console.error(`[Queue] Job ${jobId} failed:`, err.message);
      await db.updateJobStatus(jobId, 'failed');
      this.emit(`job:${jobId}`, { type: 'error', message: err.message });
    }
  }

  async processTitle(jobId, result) {
    let lastError = null;

    for (let attempt = 1; attempt <= config.MAX_RETRIES + 1; attempt++) {
      try {
        const searchResult = await searchProduct(result.original_title);

        await db.updateResult(result.id, {
          asin: searchResult.asin,
          product_url: searchResult.product_url,
          status: searchResult.status,
          attempts: attempt,
        });

        await db.incrementJobCounter(jobId, searchResult.status);

        const progress = await db.getJobProgress(jobId);
        this.emit(`job:${jobId}`, {
          type: 'progress',
          total: progress.total_titles,
          completed: progress.completed,
          found: progress.found,
          not_found: progress.not_found,
          errors: progress.errors,
          latestResult: {
            original_title: result.original_title,
            asin: searchResult.asin,
            product_url: searchResult.product_url,
            status: searchResult.status,
          },
        });
        return;
      } catch (error) {
        lastError = error;

        if (error instanceof RateLimitError) {
          const delay =
            error.retryAfterMs ||
            config.RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          console.log(
            `[Queue] Rate limited, pausing queue for ${delay}ms`
          );
          this.queue.pause();
          await this.sleep(delay);
          this.queue.start();
        } else if (attempt <= config.MAX_RETRIES) {
          await this.sleep(config.RETRY_BASE_DELAY_MS * attempt);
        }
      }
    }

    // All retries exhausted
    await db.updateResult(result.id, {
      status: 'error',
      error_message: lastError?.message || 'Unknown error',
      attempts: config.MAX_RETRIES + 1,
    });

    await db.incrementJobCounter(jobId, 'errors');

    const progress = await db.getJobProgress(jobId);
    this.emit(`job:${jobId}`, {
      type: 'progress',
      total: progress.total_titles,
      completed: progress.completed,
      found: progress.found,
      not_found: progress.not_found,
      errors: progress.errors,
      latestResult: {
        original_title: result.original_title,
        asin: null,
        product_url: null,
        status: 'error',
      },
    });
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = new SearchQueue();
