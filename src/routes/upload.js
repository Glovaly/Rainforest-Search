const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const { parseCsv } = require('../services/csvParser');
const db = require('../db');
const searchQueue = require('../services/searchQueue');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === 'text/csv' ||
      file.originalname.endsWith('.csv')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

router.post('/upload', requireAuth, upload.single('csv'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file uploaded' });
    }

    const competitorName = req.body.competitor;
    if (!competitorName || !competitorName.trim()) {
      return res.status(400).json({ error: 'Competitor name is required' });
    }

    // Parse CSV
    const { titles } = parseCsv(req.file.buffer);

    // Get or create competitor
    const competitor = await db.getOrCreateCompetitor(competitorName);

    // Create job
    const jobId = uuidv4();
    await db.createJob({
      id: jobId,
      competitorId: competitor.id,
      filename: req.file.originalname,
      totalTitles: titles.length,
    });

    // Create result rows
    const resultRows = titles.map((title) => ({
      job_id: jobId,
      competitor_id: competitor.id,
      original_title: title,
      status: 'pending',
      attempts: 0,
    }));
    await db.createResults(resultRows);

    // Start processing (fire and forget)
    searchQueue.processJob(jobId).catch((err) => {
      console.error(`[Upload] Job ${jobId} processing error:`, err.message);
    });

    res.json({
      jobId,
      totalTitles: titles.length,
      competitor: competitor.name,
    });
  } catch (err) {
    if (err.message === 'Only CSV files are allowed') {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;
