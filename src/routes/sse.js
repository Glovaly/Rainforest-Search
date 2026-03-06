const express = require('express');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');
const searchQueue = require('../services/searchQueue');

const router = express.Router();

router.get('/jobs/:id/progress', requireAuth, async (req, res) => {
  const jobId = req.params.id;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send current state first (for reconnections)
  try {
    const progress = await db.getJobProgress(jobId);
    if (progress) {
      res.write(
        `data: ${JSON.stringify({ type: 'snapshot', ...progress, total: progress.total_titles })}\n\n`
      );

      // If job is already done, send done event and close
      if (progress.status === 'completed' || progress.status === 'failed') {
        res.write(
          `data: ${JSON.stringify({ type: 'done', total: progress.total_titles, completed: progress.completed, found: progress.found, not_found: progress.not_found, errors: progress.errors })}\n\n`
        );
        res.end();
        return;
      }
    }
  } catch (err) {
    console.error(`[SSE] Error fetching progress for ${jobId}:`, err.message);
  }

  // Subscribe to live events
  const listener = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (data.type === 'done' || data.type === 'error') {
      res.end();
    }
  };

  searchQueue.on(`job:${jobId}`, listener);

  // Clean up on client disconnect
  req.on('close', () => {
    searchQueue.removeListener(`job:${jobId}`, listener);
  });
});

module.exports = router;
