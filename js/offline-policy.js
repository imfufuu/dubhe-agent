// Tools that are strictly browser-local and safe to expose while the app is offline.
// Everything absent from this allowlist is removed from the model tool contract.
export const OFFLINE_ALLOWED_TOOL_NAMES = Object.freeze([
  'skill_library',
  'tool_library',
  'document_tool',
  'xlsx_tool',
  'knowledge_search',
  'execute_javascript',
  'write_file',
  'read_file',
  'list_files',
  'get_current_time',
  'get_browser_environment',
  'zip_files',
  'unzip_file',
  'search_files',
  'diff_text',
  'delete_file',
  'copy_file',
  'remember',
  'evaluate_expression',
  'text_tool',
  'data_tool',
  'execute_sql',
  'render_mermaid',
  'render_dot',
]);

const OFFLINE_ALLOWED_TOOL_SET = new Set(OFFLINE_ALLOWED_TOOL_NAMES);
export function isOfflineToolAllowed(name) {
  return OFFLINE_ALLOWED_TOOL_SET.has(String(name || ''));
}
