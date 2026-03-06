const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

// --- Competitors ---

async function getCompetitors() {
  const { data, error } = await supabase
    .from('competitors')
    .select('*')
    .order('name');
  if (error) throw error;
  return data;
}

async function getOrCreateCompetitor(name) {
  const trimmed = name.trim();

  // Try to find existing
  const { data: existing } = await supabase
    .from('competitors')
    .select('*')
    .ilike('name', trimmed)
    .limit(1)
    .single();

  if (existing) return existing;

  // Create new
  const { data, error } = await supabase
    .from('competitors')
    .insert({ name: trimmed })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// --- Jobs ---

async function createJob({ id, competitorId, filename, totalTitles }) {
  const { data, error } = await supabase
    .from('jobs')
    .insert({
      id,
      competitor_id: competitorId,
      filename,
      total_titles: totalTitles,
      status: 'pending',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getJob(jobId) {
  const { data, error } = await supabase
    .from('jobs')
    .select('*, competitors(name)')
    .eq('id', jobId)
    .single();
  if (error) throw error;
  return data;
}

async function getRecentJobs(limit = 20) {
  const { data, error } = await supabase
    .from('jobs')
    .select('*, competitors(name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

async function updateJobStatus(jobId, status) {
  const update = { status };
  if (status === 'completed' || status === 'failed') {
    update.completed_at = new Date().toISOString();
  }
  const { error } = await supabase
    .from('jobs')
    .update(update)
    .eq('id', jobId);
  if (error) throw error;
}

async function incrementJobCounter(jobId, field) {
  // field: 'found', 'not_found', 'errors'
  const { data: job } = await supabase
    .from('jobs')
    .select('completed, found, not_found, errors')
    .eq('id', jobId)
    .single();

  if (!job) return;

  const update = { completed: job.completed + 1 };
  if (field === 'found') update.found = job.found + 1;
  else if (field === 'not_found') update.not_found = job.not_found + 1;
  else if (field === 'errors') update.errors = job.errors + 1;

  const { error } = await supabase
    .from('jobs')
    .update(update)
    .eq('id', jobId);
  if (error) throw error;
}

async function getJobProgress(jobId) {
  const { data, error } = await supabase
    .from('jobs')
    .select('total_titles, completed, found, not_found, errors, status')
    .eq('id', jobId)
    .single();
  if (error) throw error;
  return data;
}

// --- Results ---

async function createResults(results) {
  // Insert in batches of 500 (Supabase limit)
  const batchSize = 500;
  for (let i = 0; i < results.length; i += batchSize) {
    const batch = results.slice(i, i + batchSize);
    const { error } = await supabase.from('results').insert(batch);
    if (error) throw error;
  }
}

async function getResultsByJobId(jobId) {
  const { data, error } = await supabase
    .from('results')
    .select('*')
    .eq('job_id', jobId)
    .order('id');
  if (error) throw error;
  return data;
}

async function getPendingResults(jobId) {
  const { data, error } = await supabase
    .from('results')
    .select('*')
    .eq('job_id', jobId)
    .eq('status', 'pending')
    .order('id');
  if (error) throw error;
  return data;
}

async function updateResult(resultId, updates) {
  const { error } = await supabase
    .from('results')
    .update(updates)
    .eq('id', resultId);
  if (error) throw error;
}

module.exports = {
  supabase,
  getCompetitors,
  getOrCreateCompetitor,
  createJob,
  getJob,
  getRecentJobs,
  updateJobStatus,
  incrementJobCounter,
  getJobProgress,
  createResults,
  getResultsByJobId,
  getPendingResults,
  updateResult,
};
