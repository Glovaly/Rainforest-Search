let currentJobId = null;
let eventSource = null;
let rowCount = 0;

// --- Competitor dropdown ---
const competitorSelect = document.getElementById('competitorSelect');
const competitorNew = document.getElementById('competitorNew');

if (competitorSelect) {
  competitorSelect.addEventListener('change', () => {
    if (competitorSelect.value === '__new__') {
      competitorNew.style.display = 'block';
      competitorNew.required = true;
      competitorNew.focus();
    } else {
      competitorNew.style.display = 'none';
      competitorNew.required = false;
      competitorNew.value = '';
    }
  });
}

// --- Upload form ---
const uploadForm = document.getElementById('uploadForm');
if (uploadForm) {
  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const fileInput = document.getElementById('csvFile');
    const file = fileInput.files[0];
    if (!file) return;

    let competitor;
    if (competitorSelect.value === '__new__') {
      competitor = competitorNew.value.trim();
    } else {
      competitor = competitorSelect.value;
    }

    if (!competitor) {
      alert('Please select or enter a competitor name');
      return;
    }

    const formData = new FormData();
    formData.append('csv', file);
    formData.append('competitor', competitor);

    const uploadBtn = document.getElementById('uploadBtn');
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';

    try {
      const res = await fetch('/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      currentJobId = data.jobId;
      document.getElementById('statTotal').textContent = data.totalTitles;
      startSSE(data.jobId);
    } catch (err) {
      alert('Error: ' + err.message);
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Upload & Search';
    }
  });
}

// --- SSE ---
function startSSE(jobId) {
  currentJobId = jobId;
  rowCount = 0;

  // Show progress and results sections
  document.getElementById('progressSection').style.display = '';
  document.getElementById('resultsSection').style.display = '';
  document.getElementById('resultsBody').innerHTML = '';

  // Close existing connection
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource(`/jobs/${jobId}/progress`);

  eventSource.addEventListener('message', (e) => {
    const data = JSON.parse(e.data);

    if (data.type === 'snapshot' || data.type === 'progress') {
      updateProgress(data);
    }

    if (data.type === 'progress' && data.latestResult) {
      appendResultRow(data.latestResult);
    }

    if (data.type === 'done') {
      eventSource.close();
      onJobComplete(data);
    }

    if (data.type === 'error') {
      eventSource.close();
      alert('Job failed: ' + (data.message || 'Unknown error'));
    }
  });

  eventSource.addEventListener('error', () => {
    // EventSource auto-reconnects. Show subtle indicator.
    console.log('SSE connection lost, reconnecting...');
  });
}

function resumeSSE(jobId) {
  startSSE(jobId);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateProgress(data) {
  const total = data.total || data.total_titles || 0;
  const completed = data.completed || 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressText').textContent = pct + '%';
  document.getElementById('statCompleted').textContent = completed;
  document.getElementById('statFound').textContent = data.found || 0;
  document.getElementById('statNotFound').textContent = data.not_found || 0;
  document.getElementById('statErrors').textContent = data.errors || 0;
  document.getElementById('statTotal').textContent = total;
}

function appendResultRow(result) {
  rowCount++;
  const tbody = document.getElementById('resultsBody');
  const row = document.createElement('tr');
  row.className = 'status-row-' + result.status;

  const titleText = escapeHtml(result.original_title || '');
  const truncatedTitle =
    titleText.length > 80 ? titleText.slice(0, 80) + '...' : titleText;

  row.innerHTML = `
    <td>${rowCount}</td>
    <td title="${titleText}">${truncatedTitle}</td>
    <td>${result.asin || '-'}</td>
    <td>${result.product_url ? '<a href="' + result.product_url + '" target="_blank" rel="noopener">Link</a>' : '-'}</td>
    <td><span class="badge badge-${result.status}">${result.status.replace('_', ' ')}</span></td>
  `;
  tbody.appendChild(row);

  // Auto-scroll to latest
  row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function onJobComplete(data) {
  const uploadBtn = document.getElementById('uploadBtn');
  uploadBtn.disabled = false;
  uploadBtn.textContent = 'Upload & Search';

  const downloadBtn = document.getElementById('downloadBtn');
  downloadBtn.style.display = '';
  downloadBtn.onclick = () => {
    window.location.href = `/jobs/${currentJobId}/download`;
  };

  // Update progress to 100%
  updateProgress(data);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
