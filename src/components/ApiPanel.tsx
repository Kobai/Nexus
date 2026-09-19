import { useEffect, useState, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Terminal,
  Play,
  Settings,
  ChevronDown,
  ChevronRight,
  Search,
  X,
  RefreshCw,
  Loader2,
  Globe,
  Key,
} from 'lucide-react';

interface EnvVar {
  key: string;
  value: string;
  env_name: string;
}

interface ApiParameter {
  name: string;
  param_in: string;
  required: boolean;
  param_type: string;
}

interface ApiEndpoint {
  method: string;
  path: string;
  summary: string;
  operation_id: string;
  parameters: ApiParameter[];
  request_body: any;
  tags: string[];
}

interface ApiSpecData {
  spec_path: string;
  spec_name: string;
  base_url: string;
  endpoints: ApiEndpoint[];
  tags: string[];
}

interface ApiCallRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

interface ApiCallResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

interface Props {
  projectId: string;
}

type PanelView = 'endpoints' | 'env' | 'response';

type JsonTokenType = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct';

const JSON_TOKEN_COLORS: Record<JsonTokenType, string> = {
  key: 'text-cafe-primary font-semibold',
  string: 'text-emerald-700',
  number: 'text-blue-700',
  boolean: 'text-purple-700',
  null: 'text-cafe-muted italic',
  punct: 'text-cafe-muted',
};

const JSON_TOKEN_REGEX = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?)|\b(?:true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// A <span> per token — however it's created, React element or raw HTML tag —
// is still one real DOM node the browser has to lay out, paint, and (on
// close) tear down. A products-list-shaped response can have thousands of
// small tokens well within a reasonable byte size, so cap by token count and
// fall back to a single plain (but still pretty-printed) text node past it —
// that's what actually keeps scroll and close snappy for big responses.
const MAX_HIGHLIGHT_TOKENS = 3000;

// Escaping happens before token-wrapping, so this stays safe even though the
// text comes from an untrusted API response.
function highlightJsonHtml(pretty: string): string | null {
  const escaped = escapeHtml(pretty);
  let html = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let tokenCount = 0;
  JSON_TOKEN_REGEX.lastIndex = 0;
  while ((match = JSON_TOKEN_REGEX.exec(escaped)) !== null) {
    if (++tokenCount > MAX_HIGHLIGHT_TOKENS) return null;
    if (match.index > lastIndex) {
      html += escaped.slice(lastIndex, match.index);
    }
    const text = match[0];
    let type: JsonTokenType = 'number';
    if (text.startsWith('"')) {
      type = /:\s*$/.test(text) ? 'key' : 'string';
    } else if (text === 'true' || text === 'false') {
      type = 'boolean';
    } else if (text === 'null') {
      type = 'null';
    }
    html += `<span class="${JSON_TOKEN_COLORS[type]}">${text}</span>`;
    lastIndex = JSON_TOKEN_REGEX.lastIndex;
  }
  html += escaped.slice(lastIndex);
  return html;
}

function JsonBody({ body }: { body: string }) {
  const result = useMemo(() => {
    if (!body) return null;
    try {
      const pretty = JSON.stringify(JSON.parse(body), null, 2);
      return { pretty, html: highlightJsonHtml(pretty) };
    } catch {
      return null;
    }
  }, [body]);

  if (!result) {
    return <>{body || 'No response body'}</>;
  }
  if (result.html === null) {
    return <>{result.pretty}</>;
  }
  return <span dangerouslySetInnerHTML={{ __html: result.html }} />;
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-green-100 text-green-700 border-green-300',
  POST: 'bg-blue-100 text-blue-700 border-blue-300',
  PUT: 'bg-yellow-100 text-yellow-700 border-yellow-300',
  DELETE: 'bg-red-100 text-red-700 border-red-300',
  PATCH: 'bg-purple-100 text-purple-700 border-purple-300',
  OPTIONS: 'bg-gray-100 text-gray-700 border-gray-300',
  HEAD: 'bg-indigo-100 text-indigo-700 border-indigo-300',
};

export function ApiPanel({ projectId }: Props) {
  const [specData, setSpecData] = useState<ApiSpecData | null>(null);
  const [specPaths, setSpecPaths] = useState<string[]>([]);
  const [activeSpecPath, setActiveSpecPath] = useState<string>('');
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [activeEnv, setActiveEnv] = useState('development');
  const [selectedTag, setSelectedTag] = useState<string>('All');
  const [query, setQuery] = useState('');
  const [expandedEndpoint, setExpandedEndpoint] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<PanelView>('endpoints');
  const [specLoading, setSpecLoading] = useState(true);
  const [envLoading, setEnvLoading] = useState(true);
  const [runningEndpoint, setRunningEndpoint] = useState<string | null>(null);
  const [response, setResponse] = useState<ApiCallResponse | null>(null);
  const [endpointError, setEndpointError] = useState<string | null>(null);
  const [bodyTemplates, setBodyTemplates] = useState<Record<string, string>>({});
  const [urlTemplates, setUrlTemplates] = useState<Record<string, string>>({});

  const loadSpecs = useCallback(async () => {
    try {
      const paths = await invoke<string[]>('get_openapi_specs', { projectId });
      setSpecPaths(paths);
      if (paths.length > 0) {
        setActiveSpecPath(paths[0]);
        const data = await invoke<ApiSpecData>('read_openapi_spec', { projectId, specPath: paths[0] });
        setSpecData(data);
      } else {
        setSpecData(null);
      }
    } catch (e) {
      console.error('[API] Failed to load specs:', e);
    } finally {
      setSpecLoading(false);
    }
  }, [projectId]);

  const fetchEnv = useCallback(async () => {
    setEnvLoading(true);
    try {
      const envs = await invoke<EnvVar[]>('get_env_file', { projectId });
      setEnvVars(envs);
      const envNameMap: Record<string, string> = {};
      for (const e of envs) {
        if (!envNameMap[e.env_name]) {
          const displayName = e.env_name === '.env.local' ? 'Local' : e.env_name === '.env.prod' ? 'Production' : e.env_name;
          envNameMap[displayName] = displayName;
        }
      }
      const envKeys = Object.keys(envNameMap);
      if (envKeys.length > 0) {
        setActiveEnv(envKeys[0]);
      }
    } catch (e) {
      console.error('[API] Failed to load env file:', e);
      setEnvVars([]);
    } finally {
      setEnvLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setSpecLoading(true);
    loadSpecs();
    fetchEnv();
  }, [projectId]);

  const handleRefresh = async () => {
    setSpecLoading(true);
    await loadSpecs();
    await fetchEnv();
  };

  const handleSpecChange = async (path: string) => {
    setActiveSpecPath(path);
    setSpecLoading(true);
    try {
      const data = await invoke<ApiSpecData>('read_openapi_spec', { projectId, specPath: path });
      setSpecData(data);
    } catch (e) {
      console.error('Failed to load spec:', e);
    } finally {
      setSpecLoading(false);
    }
  };

  const envGroups = useMemo(() => {
    const groups: Record<string, EnvVar[]> = {};
    for (const v of envVars) {
      const displayName = v.env_name === '.env.local' ? 'Local' : v.env_name === '.env.prod' ? 'Production' : v.env_name;
      if (!groups[displayName]) groups[displayName] = [];
      groups[displayName].push(v);
    }
    return groups;
  }, [envVars]);

  // Vars scoped to whichever environment is currently selected — URL/header/body
  // substitution must only ever pull from this, not the full combined envVars
  // list, or picking "Local" vs "Production" wouldn't actually change anything.
  const scopedEnvVars = useMemo(() => envGroups[activeEnv] || [], [envGroups, activeEnv]);

  const filteredEndpoints = useMemo(() => {
    if (!specData) return [];
    let endpoints = [...specData.endpoints];
    if (selectedTag !== 'All') {
      endpoints = endpoints.filter((e) => e.tags.includes(selectedTag));
    }
    if (query) {
      const q = query.toLowerCase();
      endpoints = endpoints.filter((e) =>
        e.path.toLowerCase().includes(q) ||
        e.summary.toLowerCase().includes(q) ||
        e.method.toLowerCase().includes(q)
      );
    }
    return endpoints;
  }, [specData, selectedTag, query]);

  const getApiUrl = useCallback(() => {
    return scopedEnvVars.find((v) => v.key === 'API_URL')?.value || specData?.base_url || 'http://localhost';
  }, [scopedEnvVars, specData]);

  const applyEnvVars = useCallback((url: string, headers: Record<string, string>, body?: string) => {
    const substitutions: Record<string, string> = {};
    for (const v of scopedEnvVars) {
      const key = v.key;
      const val = v.value;
      substitutions[`${key}`] = val;
      substitutions[`{{${key}}}`] = val;
    }
    let processedUrl = url;
    let processedHeaders = { ...headers };
    let processedBody = body;
    for (const [key, val] of Object.entries(substitutions)) {
      const pattern = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      processedUrl = processedUrl.replace(pattern, val);
      processedBody = processedBody?.replace(pattern, val) || processedBody;
      for (const [hKey, hVal] of Object.entries(processedHeaders)) {
        processedHeaders[hKey] = hVal.replace(pattern, val);
      }
    }
    return { url: processedUrl, headers: processedHeaders, body: processedBody };
  }, [scopedEnvVars]);

  const runEndpoint = async (endpoint: ApiEndpoint) => {
    if (envLoading) {
      setEndpointError('Still loading environment variables, try again in a moment.');
      setActiveView('response');
      return;
    }
    setRunningEndpoint(endpoint.operation_id);
    setResponse(null);
    setEndpointError(null);
    try {
      const apiUrl = getApiUrl();
      const url = urlTemplates[endpoint.operation_id] || `${apiUrl}${endpoint.path}`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const apiKey = scopedEnvVars.find((v) => /^(X[-_]?)?API[-_]?KEY$/i.test(v.key))?.value;
      if (apiKey) headers['x-api-key'] = apiKey;
      for (const param of endpoint.parameters) {
        if (param.param_in === 'header') {
          const alreadySet = Object.keys(headers).some((h) => h.toLowerCase() === param.name.toLowerCase());
          if (!alreadySet) {
            headers[param.name] = `{{${param.name}}}`;
          }
        }
      }
      const body = bodyTemplates[endpoint.operation_id] || (endpoint.request_body ? JSON.stringify(endpoint.request_body, null, 2) : undefined);
      const processed = applyEnvVars(url, headers, body);
      const request: ApiCallRequest = { url: processed.url, method: endpoint.method, headers: processed.headers, body: processed.body };
      const response = await invoke<ApiCallResponse>('call_api', { request });
      setResponse(response);
      setActiveView('response');
    } catch (e: any) {
      setEndpointError(e.message || 'Failed to call endpoint');
    } finally {
      setRunningEndpoint(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-cafe-surface">
      {/* Header */}
      <div className="px-3 py-2 border-b border-cafe-border shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal size={14} className="text-cafe-primary" />
          <span className="text-xs font-semibold text-cafe-primary tracking-wide">API</span>
          {specPaths.length > 1 ? (
            <select
              value={activeSpecPath}
              onChange={(e) => handleSpecChange(e.target.value)}
              className="bg-cafe-hover border border-cafe-border rounded-md px-1.5 py-0.5 text-[10px] text-cafe-text outline-none focus:border-cafe-primary"
            >
              {specPaths.map((p) => (
                <option key={p} value={p}>{p.split('/').pop()}</option>
              ))}
            </select>
          ) : specData ? (
            <span className="text-[10px] text-cafe-muted bg-cafe-hover px-1.5 py-0.5 rounded">{specData.spec_name}</span>
          ) : (
            <span className="text-[10px] text-cafe-muted">No spec loaded</span>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={specLoading}
          className="text-cafe-border hover:text-cafe-primary transition-colors disabled:opacity-50"
          title="Refresh specs"
        >
          <RefreshCw size={11} className={specLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Content */}
      {!specData && !specLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Globe size={32} className="text-cafe-border mx-auto mb-3" />
            <p className="text-cafe-muted text-xs text-center">No OpenAPI spec found in this project.</p>
            <p className="text-cafe-border text-[10px] text-center mt-1">Add openapi.json or swagger.json to your repo</p>
            <button
              onClick={handleRefresh}
              className="mt-3 px-3 py-1 bg-cafe-primary text-white text-xs rounded-md hover:bg-cafe-primary/80"
            >
              Search for specs
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Tab bar */}
          <div className="flex border-b border-cafe-border shrink-0">
            {[
              { id: 'endpoints', label: 'Endpoints', icon: Terminal },
              { id: 'env', label: 'Env', icon: Settings },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveView(tab.id as PanelView)}
                className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-medium transition-colors ${
                  activeView === tab.id
                    ? 'text-cafe-primary border-b-2 border-cafe-primary bg-cafe-hover'
                    : 'text-cafe-muted hover:text-cafe-text'
                }`}
              >
                <tab.icon size={11} />
                {tab.label}
              </button>
            ))}
          </div>

          {/* key resets scroll position on view switch — otherwise this container
              keeps whatever scrollTop it had (e.g. from a long endpoints list)
              and the new view opens already scrolled past its top. */}
          <div key={activeView} className="flex-1 overflow-auto">
            {activeView === 'endpoints' && (
              <>
                <div className="px-2 py-1.5 border-b border-cafe-border shrink-0">
                  <div className="relative flex items-center">
                    <Search size={11} className="absolute left-2 text-cafe-border" />
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search endpoints..."
                      className="w-full bg-cafe-hover border border-cafe-border rounded-md pl-7 pr-2 py-1 text-xs text-cafe-text placeholder:text-cafe-border outline-none focus:border-cafe-primary transition-colors"
                    />
                    {query && (
                      <button onClick={() => setQuery('')} className="absolute right-2 text-cafe-border hover:text-cafe-muted">
                        <X size={10} />
                      </button>
                    )}
                  </div>
                </div>

                {Object.keys(envGroups).length > 1 && (
                  <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-cafe-border shrink-0 overflow-x-auto">
                    <Key size={10} className="text-cafe-muted shrink-0" />
                    {Object.keys(envGroups).map((envName) => (
                      <button
                        key={envName}
                        onClick={() => setActiveEnv(envName)}
                        className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                          activeEnv === envName
                            ? 'bg-cafe-primary text-white'
                            : 'bg-cafe-hover text-cafe-muted hover:text-cafe-text'
                        }`}
                      >
                        {envName}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex gap-1 px-2 py-1.5 border-b border-cafe-border shrink-0 overflow-x-auto">
                  <button
                    onClick={() => setSelectedTag('All')}
                    className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                      selectedTag === 'All' ? 'bg-cafe-primary text-white' : 'bg-cafe-hover text-cafe-muted hover:text-cafe-text'
                    }`}
                  >
                    All
                  </button>
                  {specData && specData.tags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setSelectedTag(tag)}
                      className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                        selectedTag === tag ? 'bg-cafe-primary text-white' : 'bg-cafe-hover text-cafe-muted hover:text-cafe-text'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>

                <div className="divide-y divide-cafe-border/50">
                  {filteredEndpoints.length === 0 && (
                    <div className="px-3 py-4 text-xs text-cafe-border italic text-center">No endpoints found</div>
                  )}
                  {filteredEndpoints.map((endpoint, i) => (
                    <div key={`${endpoint.method}-${endpoint.path}-${i}`}>
                      <button
                        onClick={() => {
                          setExpandedEndpoint(expandedEndpoint === endpoint.operation_id ? null : endpoint.operation_id);
                        }}
                        className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-cafe-hover transition-colors text-left"
                      >
                        {expandedEndpoint === endpoint.operation_id ? (
                          <ChevronDown size={10} className="text-cafe-border shrink-0" />
                        ) : (
                          <ChevronRight size={10} className="text-cafe-border shrink-0" />
                        )}
                        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold border ${METHOD_COLORS[endpoint.method] || METHOD_COLORS.GET}`}>
                          {endpoint.method}
                        </span>
                        <span className="text-xs text-cafe-text font-mono truncate flex-1 min-w-0">{endpoint.path}</span>
                        <Play size={10} className="text-cafe-border shrink-0 opacity-0 group-hover:opacity-100 hover:text-cafe-primary" />
                      </button>

                      {expandedEndpoint === endpoint.operation_id && (
                        <div className="px-4 pb-2 pl-8">
                          <div className="bg-cafe-hover rounded-md p-2 mb-2">
                            <p className="text-[10px] text-cafe-muted mb-1">{endpoint.summary}</p>
                            {endpoint.parameters.length > 0 && (
                              <div className="mb-2">
                                <p className="text-[9px] text-cafe-muted font-medium mb-1">Parameters:</p>
                                {endpoint.parameters.map((param, pi) => (
                                  <div key={pi} className="flex items-center gap-1.5 text-[10px]">
                                    <span className={`px-1 py-0.5 rounded text-[8px] font-medium ${
                                      param.param_in === 'path' ? 'bg-pink-100 text-pink-700' :
                                      param.param_in === 'query' ? 'bg-blue-100 text-blue-700' :
                                      param.param_in === 'header' ? 'bg-yellow-100 text-yellow-700' :
                                      'bg-gray-100 text-gray-700'
                                    }`}>
                                      {param.param_in}
                                    </span>
                                    <span className="text-cafe-text font-mono">{param.name}</span>
                                    {param.required && <span className="text-cafe-danger">*</span>}
                                    <span className="text-cafe-border">{param.param_type}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="mb-2">
                            <label className="text-[9px] text-cafe-muted font-medium block mb-1">URL Template</label>
                            <input
                              type="text"
                              value={urlTemplates[endpoint.operation_id] || `${getApiUrl()}${endpoint.path}`}
                              onChange={(e) => setUrlTemplates({ ...urlTemplates, [endpoint.operation_id]: e.target.value })}
                              className="w-full bg-cafe-hover border border-cafe-border rounded-md px-2 py-1 text-[11px] font-mono text-cafe-text outline-none focus:border-cafe-primary"
                            />
                          </div>
                          <div className="mb-2">
                            <label className="text-[9px] text-cafe-muted font-medium block mb-1">Request Body</label>
                            <textarea
                              value={bodyTemplates[endpoint.operation_id] || (endpoint.request_body ? JSON.stringify(endpoint.request_body, null, 2) : '')}
                              onChange={(e) => setBodyTemplates({ ...bodyTemplates, [endpoint.operation_id]: e.target.value })}
                              className="w-full bg-cafe-hover border border-cafe-border rounded-md px-2 py-1 text-[11px] font-mono text-cafe-text outline-none focus:border-cafe-primary h-32 resize-none"
                            />
                          </div>
                          <button
                            onClick={() => runEndpoint(endpoint)}
                            disabled={runningEndpoint === endpoint.operation_id || envLoading}
                            title={envLoading ? 'Loading environment variables...' : undefined}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-cafe-primary text-white text-xs rounded-md hover:bg-cafe-primary/80 transition-colors disabled:opacity-50"
                          >
                            {runningEndpoint === endpoint.operation_id ? (
                              <Loader2 size={10} className="animate-spin" />
                            ) : (
                              <Play size={10} />
                            )}
                            {runningEndpoint === endpoint.operation_id ? 'Calling...' : 'Call'}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {activeView === 'env' && (
              <div>
                {envLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 size={16} className="text-cafe-primary animate-spin" />
                  </div>
                ) : Object.keys(envGroups).length === 0 ? (
                  <div className="px-3 py-4 text-xs text-cafe-border italic text-center">
                    No .env file found in this project.
                  </div>
                ) : (
                  <>
                    <div className="px-3 py-2 border-b border-cafe-border shrink-0 flex items-center gap-1.5">
                      <Key size={11} className="text-cafe-muted" />
                      <span className="text-[10px] text-cafe-muted font-medium">
                        {activeEnv.toUpperCase()}
                        {Object.keys(envGroups).length > 1 && ' — switch environments from the Endpoints tab'}
                      </span>
                    </div>

                    <div className="divide-y divide-cafe-border/50">
                      {envGroups[activeEnv]?.map((v, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-1.5 hover:bg-cafe-hover transition-colors">
                          <span className="text-[10px] font-mono text-cafe-primary">{v.key}</span>
                          <span className="text-cafe-border">=</span>
                          <span className="text-[10px] font-mono text-cafe-text flex-1 truncate">{v.value}</span>
                        </div>
                      ))}
                    </div>

                    <div className="px-3 py-2 border-t border-cafe-border shrink-0">
                      <p className="text-[9px] text-cafe-muted mb-1">Variables will be substituted in URL/headers/body when calling endpoints</p>
                      <div className="flex flex-wrap gap-1">
                        {envGroups[activeEnv]?.map((v, i) => (
                          <span key={i} className="text-[9px] bg-cafe-primary/10 text-cafe-primary px-1.5 py-0.5 rounded font-mono">
                            {'{{'}{v.key}{'}}'}
                          </span>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {activeView === 'response' && response && (
              <div className="flex flex-col h-full">
                <div className={`flex items-center justify-between px-3 py-2 border-b border-cafe-border shrink-0 ${
                  response.status < 300 ? 'bg-green-50' : 'bg-red-50'
                }`}>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                      response.status < 300 ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'
                    }`}>
                      {response.status}
                    </span>
                    <span className="text-[10px] text-cafe-muted">{response.headers['content-type'] || 'application/json'}</span>
                  </div>
                  <button
                    onClick={() => { setActiveView('endpoints'); setResponse(null); }}
                    className="text-cafe-border hover:text-cafe-text"
                  >
                    <X size={11} />
                  </button>
                </div>

                <div className="flex-1 overflow-auto p-3">
                  <pre className="text-[11px] font-mono text-cafe-text whitespace-pre-wrap bg-cafe-hover rounded-md p-3 border border-cafe-border overflow-auto">
                    <JsonBody body={response.body} />
                  </pre>
                </div>
              </div>
            )}

            {activeView === 'response' && endpointError && !response && (
              <div className="flex flex-col items-center justify-center h-full p-4">
                <p className="text-cafe-danger text-xs text-center">{endpointError}</p>
                <button
                  onClick={() => setActiveView('endpoints')}
                  className="mt-3 px-3 py-1 bg-cafe-primary text-white text-xs rounded-md hover:bg-cafe-primary/80"
                >
                  Back to Endpoints
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
