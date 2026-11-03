import React, { useMemo, useRef, useState } from 'react';
import { acquireRequestLock, formatApiError, releaseRequestLock } from './apiErrors';
import { getCsvTemplate } from './csvTemplates';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const PREVIEW_LIMIT = 50;

const IMPORT_FIELDS = [
  ['feature.feature_id', 'Feature · ID'],
  ['feature.feature_name', 'Feature · Name'],
  ['feature.priority', 'Feature · Priority'],
  ['feature.input_order', 'Feature · Input order'],
  ['feature.team_id', 'Feature · Team ID'],
  ['feature.status', 'Feature · Status'],
  ['feature.build_estimate_current', 'Feature · Build current estimate'],
  ['feature.build_original_estimate', 'Feature · Build original estimate'],
  ['feature.build_actual_spent', 'Feature · Build actual spent'],
  ['feature.st_estimate_current', 'Feature · ST current estimate'],
  ['feature.st_original_estimate', 'Feature · ST original estimate'],
  ['feature.st_actual_spent', 'Feature · ST actual spent'],
  ['story.story_id', 'Story · ID'],
  ['story.feature_id', 'Story · Feature ID'],
  ['story.story_name', 'Story · Name'],
  ['story.input_order', 'Story · Input order'],
  ['story.status', 'Story · Status'],
  ['story.build_estimate_current', 'Story · Build current estimate'],
  ['story.build_original_estimate', 'Story · Build original estimate'],
  ['story.build_actual_spent', 'Story · Build actual spent'],
  ['story.st_estimate_current', 'Story · ST current estimate'],
  ['story.st_original_estimate', 'Story · ST original estimate'],
  ['story.st_actual_spent', 'Story · ST actual spent'],
];

function suggestSource(target, headers) {
  const [entity, field] = target.split('.');
  const candidates = [target, `${entity}_${field}`];
  const sameNameTargets = IMPORT_FIELDS.filter(([otherTarget]) =>
    otherTarget.endsWith(`.${field}`)
  );
  if (sameNameTargets.length === 1) candidates.push(field);
  return candidates.find((candidate) => headers.includes(candidate)) || '';
}

function buildMapping(selectedSources) {
  return Object.fromEntries(Object.entries(selectedSources).filter(([, source]) => source));
}

function parseHeaderRow(csvText) {
  const headers = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];
    if (quoted) {
      if (character === '"' && csvText[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ',') {
      headers.push(field.trim());
      field = '';
    } else if (character === '\n' || character === '\r') {
      headers.push(field.trim());
      const cleaned = headers.map((header, position) =>
        position === 0 ? header.replace(/^\uFEFF/, '') : header
      );
      if (cleaned.some((header) => !header))
        throw new Error('The CSV header row contains an empty column name.');
      if (cleaned.some((header, position) => cleaned.indexOf(header) !== position)) {
        throw new Error('The CSV header row contains duplicate column names.');
      }
      return cleaned;
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error('The CSV header row contains an unclosed quote.');
  if (!csvText.length) throw new Error('The CSV file is empty.');
  headers.push(field.trim());
  const cleaned = headers.map((header, position) =>
    position === 0 ? header.replace(/^\uFEFF/, '') : header
  );
  if (cleaned.some((header) => !header))
    throw new Error('The CSV header row contains an empty column name.');
  if (cleaned.some((header, position) => cleaned.indexOf(header) !== position)) {
    throw new Error('The CSV header row contains duplicate column names.');
  }
  return cleaned;
}

async function requestImport(path, file, mapping, extra = {}) {
  const body = new FormData();
  body.append('file', file, file.name);
  body.append('mapping', JSON.stringify(mapping));
  for (const [key, value] of Object.entries(extra)) body.append(key, String(value));

  const response = await fetch(path, { method: 'POST', body });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.error || `Request failed with status ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function formatCell(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function renderPreviewTable(title, rows, fields) {
  const visibleRows = rows.slice(0, PREVIEW_LIMIT);
  return (
    <div className="import-preview-table-section">
      <h3>
        {title} <span>{rows.length} rows</span>
      </h3>
      {rows.length === 0 ? (
        <p className="import-no-records">No records of this type are mapped.</p>
      ) : (
        <>
          <div className="team-table-wrap">
            <table className="team-table import-preview-table">
              <thead>
                <tr>
                  {fields.map(([field, label]) => (
                    <th scope="col" key={field}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, index) => (
                  <tr key={`${row.feature_id || row.story_id || 'record'}-${index}`}>
                    {fields.map(([field]) => (
                      <td key={field}>{formatCell(row[field])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > PREVIEW_LIMIT && (
            <p className="import-preview-limit">
              Showing {PREVIEW_LIMIT} of {rows.length} rows. The server validates and imports the
              full file.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default function ImportPage() {
  const [file, setFile] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [targets, setTargets] = useState({});
  const [mode, setMode] = useState('');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [readingHeaders, setReadingHeaders] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fileInputKey, setFileInputKey] = useState(0);
  const [templateEntity, setTemplateEntity] = useState('');
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const fileReadSequence = useRef(0);
  const previewLock = useRef(false);
  const confirmLock = useRef(false);

  const mapping = useMemo(() => buildMapping(targets), [targets]);

  function resetWorkflow({ retainFile = true } = {}) {
    fileReadSequence.current += 1;
    setPreview(null);
    setResult(null);
    setError('');
    setNotice('');
    if (!retainFile) {
      setFile(null);
      setHeaders([]);
      setTargets({});
      setFileInputKey((key) => key + 1);
    }
  }

  async function handleFileChange(event) {
    const selected = event.target.files?.[0] || null;
    resetWorkflow();
    const sequence = fileReadSequence.current;
    setReadingHeaders(false);
    setFile(null);
    setHeaders([]);
    setTargets({});
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith('.csv')) {
      setError('Select a .csv file. Other file formats are not supported.');
      setFileInputKey((key) => key + 1);
      return;
    }
    if (selected.size > MAX_UPLOAD_BYTES) {
      setError('The CSV exceeds the 5 MB upload limit. Choose a smaller file.');
      setFileInputKey((key) => key + 1);
      return;
    }
    setReadingHeaders(true);
    try {
      const fileHeaders = parseHeaderRow(await selected.text());
      if (sequence !== fileReadSequence.current) return;
      setFile(selected);
      setHeaders(fileHeaders);
      setTargets(
        Object.fromEntries(
          IMPORT_FIELDS.map(([target]) => [target, suggestSource(target, fileHeaders)])
        )
      );
      setError('');
    } catch (readError) {
      if (sequence !== fileReadSequence.current) return;
      setFile(null);
      setHeaders([]);
      setTargets({});
      setError(readError.message || 'Could not read the CSV header row.');
    } finally {
      if (sequence === fileReadSequence.current) setReadingHeaders(false);
    }
  }

  async function handleDownloadTemplate() {
    if (!templateEntity || downloadingTemplate) {
      if (!templateEntity)
        setError('Choose Features or User Stories before downloading a template.');
      return;
    }

    setDownloadingTemplate(true);
    setError('');
    setNotice('');
    try {
      let referenceId = '';
      if (templateEntity === 'story') {
        const response = await fetch('/api/features');
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) {
          const apiError = new Error(
            payload.error || `Request failed with status ${response.status}.`
          );
          apiError.status = response.status;
          throw apiError;
        }
        referenceId = Array.isArray(payload.data) ? payload.data[0]?.feature_id : '';
      }
      const template = getCsvTemplate(templateEntity, referenceId);
      const blob = new Blob([template.csv], { type: 'text/csv;charset=utf-8' });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = template.filename;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setNotice(`Downloaded ${template.filename}. Replace the sample row before importing.`);
    } catch (downloadError) {
      setError(formatApiError(downloadError, 'Could not create the CSV template.'));
    } finally {
      setDownloadingTemplate(false);
    }
  }

  function handleMappingChange(target, source) {
    setTargets((current) => ({ ...current, [target]: source }));
    setPreview(null);
    setResult(null);
    setError('');
    setNotice('');
  }

  async function handlePreview() {
    if (!file || previewLock.current) return;
    if (!mode) {
      setError('Choose Add or Replace before previewing the import.');
      return;
    }
    if (Object.keys(mapping).length === 0) {
      setError('Map at least one CSV column to a supported workbook field before previewing.');
      return;
    }
    if (!acquireRequestLock(previewLock)) return;
    setLoadingPreview(true);
    setError('');
    setNotice('');
    setResult(null);
    setPreview(null);
    try {
      const response = await requestImport('/api/import/csv/preview', file, mapping);
      if (JSON.stringify(response.headers || []) !== JSON.stringify(headers)) {
        setHeaders(response.headers || []);
        setTargets(
          Object.fromEntries(
            IMPORT_FIELDS.map(([target]) => [target, suggestSource(target, response.headers || [])])
          )
        );
        setError(
          'The server parsed different CSV headers than the mapping form. Review the mapping and preview again.'
        );
        return;
      }
      setPreview(response);
      if (response.warnings?.length)
        setNotice('Preview completed with warnings. Review them before confirming.');
    } catch (requestError) {
      setError(formatApiError(requestError, 'Could not preview this CSV.'));
    } finally {
      releaseRequestLock(previewLock);
      setLoadingPreview(false);
    }
  }

  async function handleConfirm() {
    if (!file || !preview || !acquireRequestLock(confirmLock)) return;
    setConfirming(true);
    setError('');
    setNotice('');
    setResult(null);
    try {
      const response = await requestImport('/api/import/csv/confirm', file, mapping, {
        mode,
        confirmed: true,
        workbookVersion: preview.workbookVersion,
      });
      setResult(response);
      setPreview(null);
      setNotice('Import completed successfully.');
    } catch (requestError) {
      if (requestError.status === 409) {
        setPreview(null);
        setError(
          'The workbook changed after preview. Re-preview this file to validate it against the latest workbook before confirming.'
        );
      } else {
        setError(
          formatApiError(requestError, 'The import could not be confirmed. No success is reported.')
        );
      }
    } finally {
      releaseRequestLock(confirmLock);
      setConfirming(false);
    }
  }

  const importedFeatures = result?.imported?.features || [];
  const importedStories = result?.imported?.stories || [];
  const featureFields = IMPORT_FIELDS.filter(([target]) => target.startsWith('feature.')).map(
    ([target, label]) => [target.slice('feature.'.length), label]
  );
  const storyFields = IMPORT_FIELDS.filter(([target]) => target.startsWith('story.')).map(
    ([target, label]) => [target.slice('story.'.length), label]
  );

  return (
    <section className="teams-page import-page" aria-labelledby="import-title">
      <div className="page-eyebrow">PLANNING</div>
      <div className="teams-heading-row">
        <div>
          <h1 id="import-title">Import data</h1>
          <p className="page-subtitle">
            Map a CSV, review the server-validated preview, then confirm explicitly.
          </p>
        </div>
      </div>

      {error && (
        <div className="teams-alert error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="form-message success" role="status">
          {notice}
        </div>
      )}

      <section className="team-form import-step" aria-labelledby="import-file-heading">
        <div className="team-form-heading">
          <div>
            <h2 id="import-file-heading">1. Select and map a CSV</h2>
            <p>CSV files up to 5 MB are supported.</p>
          </div>
        </div>
        <div className="import-template-controls">
          <label className="form-field import-file-field" htmlFor={`import-file-${fileInputKey}`}>
            <span>
              CSV file <span className="required-mark">*</span>
            </span>
            <input
              key={fileInputKey}
              id={`import-file-${fileInputKey}`}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              disabled={loadingPreview || confirming}
            />
          </label>
          <div className="import-template-download">
            <label className="form-field" htmlFor="import-template-entity">
              <span>Template for</span>
              <select
                id="import-template-entity"
                value={templateEntity}
                onChange={(event) => setTemplateEntity(event.target.value)}
                disabled={downloadingTemplate || loadingPreview || confirming}
              >
                <option value="">Choose an entity</option>
                <option value="feature">Features</option>
                <option value="story">User Stories</option>
              </select>
            </label>
            <button
              className="secondary-button"
              type="button"
              onClick={handleDownloadTemplate}
              disabled={!templateEntity || downloadingTemplate || loadingPreview || confirming}
            >
              {downloadingTemplate ? 'Preparing template…' : 'Download CSV Template'}
            </button>
          </div>
        </div>
        <ol className="import-instructions">
          <li>Download a template, then replace its sample row with your data.</li>
          <li>Keep required references matched to existing workbook records.</li>
          <li>
            Save as CSV, upload it here, review the validation preview, then explicitly confirm.
          </li>
        </ol>
        {file && (
          <div className="import-selected-file">
            <strong>Selected file:</strong> {file.name}{' '}
            <span>({(file.size / 1024).toFixed(1)} KB)</span>
            <button
              className="text-button"
              type="button"
              onClick={() => resetWorkflow({ retainFile: false })}
              disabled={loadingPreview || confirming}
            >
              Choose another file
            </button>
          </div>
        )}

        {headers.length > 0 && (
          <div className="import-mapping">
            <div className="import-section-heading">
              <h3>Column mapping</h3>
              <p>
                Choose a CSV source for each workbook field. A source column can be reused; fields
                left unmapped are excluded from import.
              </p>
            </div>
            <div className="import-mapping-list">
              {IMPORT_FIELDS.map(([target, label]) => (
                <label className="import-mapping-row" key={target}>
                  <span className="import-target-label">{label}</span>
                  <span className="import-map-arrow" aria-hidden="true">
                    ←
                  </span>
                  <select
                    aria-label={`CSV column for ${label}`}
                    value={targets[target] || ''}
                    onChange={(event) => handleMappingChange(target, event.target.value)}
                    disabled={loadingPreview || confirming}
                  >
                    <option value="">Do not import this field</option>
                    {headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>
        )}

        <fieldset className="import-mode-fieldset">
          <legend>
            Import mode <span className="required-mark">*</span>
          </legend>
          <label>
            <input
              type="radio"
              name="import-mode"
              value="add"
              checked={mode === 'add'}
              onChange={() => {
                setMode('add');
                setPreview(null);
                setResult(null);
                setError('');
              }}
              disabled={loadingPreview || confirming}
            />{' '}
            Add new records
          </label>
          <label>
            <input
              type="radio"
              name="import-mode"
              value="replace"
              checked={mode === 'replace'}
              onChange={() => {
                setMode('replace');
                setPreview(null);
                setResult(null);
                setError('');
              }}
              disabled={loadingPreview || confirming}
            />{' '}
            Replace matching records
          </label>
          {mode === 'replace' && (
            <p className="import-replace-warning">
              Replace overwrites only existing features whose IDs appear in this CSV, their stories,
              and stories with imported IDs. Other workbook data is retained.
            </p>
          )}
          {mode === 'add' && (
            <p className="field-note">
              Add rejects feature or story IDs that already exist in the workbook.
            </p>
          )}
        </fieldset>

        <div className="team-form-actions">
          <button
            className="primary-button"
            type="button"
            onClick={handlePreview}
            disabled={
              !file || !headers.length || !mode || readingHeaders || loadingPreview || confirming
            }
          >
            {readingHeaders ? 'Reading headers…' : loadingPreview ? 'Previewing…' : 'Preview CSV'}
          </button>
        </div>
      </section>

      {preview && (
        <section
          className="team-list-section import-preview-section"
          aria-labelledby="import-preview-heading"
        >
          <div className="team-list-heading">
            <div>
              <h2 id="import-preview-heading">2. Review preview</h2>
              <p>
                {file?.name} · {preview.rowCount} CSV rows · workbook version{' '}
                {preview.workbookVersion}
              </p>
            </div>
            <span className="import-preview-status">Preview validated</span>
          </div>
          {preview.warnings?.length > 0 && (
            <div className="import-warning-list" role="status">
              <strong>Warnings returned by the import service</strong>
              <ul>
                {preview.warnings.map((warning, index) => (
                  <li key={`${index}-${warning}`}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
          {renderPreviewTable('Features', preview.features || [], featureFields)}
          {renderPreviewTable('User stories', preview.stories || [], storyFields)}
          <div className="import-confirm-bar">
            <p>
              {mode === 'replace'
                ? 'Replace mode can overwrite matching records as described above.'
                : 'Add mode will reject IDs that already exist.'}{' '}
              Confirmation uses workbook version {preview.workbookVersion}.
            </p>
            <button
              className="primary-button"
              type="button"
              onClick={handleConfirm}
              disabled={confirming || loadingPreview}
            >
              {confirming ? 'Importing…' : 'Confirm and import'}
            </button>
          </div>
        </section>
      )}

      {result && (
        <section
          className="team-list-section import-result-section"
          aria-labelledby="import-result-heading"
        >
          <div className="team-list-heading">
            <div>
              <h2 id="import-result-heading">Import result</h2>
              <p>
                Server confirmed {result.mode} mode using preview workbook version{' '}
                {result.workbookVersion}.
              </p>
            </div>
          </div>
          <div className="import-result-counts">
            <div>
              <strong>{importedFeatures.length}</strong>
              <span>features imported</span>
            </div>
            <div>
              <strong>{importedStories.length}</strong>
              <span>user stories imported</span>
            </div>
          </div>
          {result.warnings?.length > 0 && (
            <div className="import-warning-list">
              <strong>Import warnings</strong>
              <ul>
                {result.warnings.map((warning, index) => (
                  <li key={`${index}-${warning}`}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </section>
  );
}
