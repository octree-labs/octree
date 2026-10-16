/**
 * Edit Suggestions Hook
 * 
 * Manages AI-powered edit suggestions with Monaco editor integration
 * 
 * Features:
 * - Queue management with batching (5 suggestions at a time)
 * - Visual decorations in the editor
 * - Accept/reject operations with conflict resolution
 * - Line shift rebasing for remaining suggestions
 */

export { useEditSuggestions } from './use-edit-suggestions';
export type { EditSuggestionsState, UseEditSuggestionsProps } from './types';

