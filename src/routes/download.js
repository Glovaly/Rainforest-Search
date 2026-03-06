const express = require('express');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');
const { exportToCsv } = require('../services/csvExporter');

const router = express.Router();

router.get('/jobs/:id/download', requireAuth, async (req, res, next) => {
  try {
    const job = await db.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const results = await db.getResultsByJobId(req.params.id);
    const competitorName = job.competitors?.name || '';
    const csv = exportToCsv(results, competitorName);

    const filename = `results-${competitorName.replace(/[^a-zA-Z0-9]/g, '_')}-${req.params.id.slice(0, 8)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // Add UTF-8 BOM for Excel compatibility
    res.send('\ufeff' + csv);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
