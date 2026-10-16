/**
 * Edit Suggestions Hook
 * 
 * Re-exports the modular implementation from ./use-edit-suggestions/
 * This maintains backward compatibility while using a cleaner modular structure.
 */

export { useEditSuggestions } from './use-edit-suggestions/';
export type { EditSuggestionsState, UseEditSuggestionsProps } from './use-edit-suggestions/types';
