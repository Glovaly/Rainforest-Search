-- Amazon ASIN Finder - Database Schema
-- Run this in Supabase SQL Editor to create all tables

-- Competitors lookup table
CREATE TABLE competitors (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Jobs table (one row per CSV upload)
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    competitor_id INTEGER NOT NULL REFERENCES competitors(id),
    filename TEXT NOT NULL,
    total_titles INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    found INTEGER NOT NULL DEFAULT 0,
    not_found INTEGER NOT NULL DEFAULT 0,
    errors INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Results table (one row per title searched — the master database)
CREATE TABLE results (
    id SERIAL PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    competitor_id INTEGER NOT NULL REFERENCES competitors(id),
    original_title TEXT NOT NULL,
    asin TEXT,
    product_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_results_job_id ON results(job_id);
CREATE INDEX idx_results_competitor_id ON results(competitor_id);
CREATE INDEX idx_results_asin ON results(asin);
CREATE INDEX idx_jobs_competitor_id ON jobs(competitor_id);
