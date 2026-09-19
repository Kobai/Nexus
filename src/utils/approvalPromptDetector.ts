// Detects Claude Code's permission-prompt text in a tab's raw PTY output, so
// the "needs attention" indicator only fires when Claude is actually waiting
// on a yes/no approval — not on every bell character (dev servers, shell
// completion, background jobs, etc. all ring the bell for unrelated reasons).
//
// This is a text heuristic tied to Claude Code's current CLI wording. If a
// future Claude Code release rephrases its approval prompt, these markers
// will need updating.
const MARKERS = [
  'and tell Claude what to do differently',
  'Do you want to proceed?',
  'Do you want to make this edit',
];

// Prompt text can arrive split across separate PTY output chunks, so each tab
// keeps a small rolling buffer of recently decoded text to search across
// chunk boundaries. A persistent per-tab decoder (with `stream: true`)
// handles multi-byte UTF-8 characters split at a chunk boundary.
const MAX_BUFFER = 400;
const decoders = new Map<string, TextDecoder>();
const buffers = new Map<string, string>();

export function feedApprovalPromptDetector(tabId: string, bytes: Uint8Array): boolean {
  let decoder = decoders.get(tabId);
  if (!decoder) {
    decoder = new TextDecoder();
    decoders.set(tabId, decoder);
  }
  const text = decoder.decode(bytes, { stream: true });
  const buffer = ((buffers.get(tabId) ?? '') + text).slice(-MAX_BUFFER);
  buffers.set(tabId, buffer);
  return MARKERS.some((marker) => buffer.includes(marker));
}

export function clearApprovalPromptDetector(tabId: string): void {
  decoders.delete(tabId);
  buffers.delete(tabId);
}
