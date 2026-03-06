const express = require('express');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');

const router = express.Router();

// Dashboard (main page)
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const jobs = await db.getRecentJobs(20);
    const competitors = await db.getCompetitors();
    res.render('dashboard', {
      title: 'ASIN Finder',
      jobs,
      competitors,
      authenticated: true,
    });
  } catch (err) {
    next(err);
  }
});

// Get job details with results (JSON API)
router.get('/jobs/:id', requireAuth, async (req, res, next) => {
  try {
    const job = await db.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    const results = await db.getResultsByJobId(req.params.id);
    res.json({ job, results });
  } catch (err) {
    next(err);
  }
});

// Get competitors list (JSON API)
router.get('/api/competitors', requireAuth, async (req, res, next) => {
  try {
    const competitors = await db.getCompetitors();
    res.json(competitors);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
