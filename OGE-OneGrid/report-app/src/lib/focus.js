import { createContext, useContext, useState, useCallback, createElement } from 'react';

// Shared "what am I looking at" context so the chat assistant can stay aware of the
// asset / site the user has drilled into. Any view can set a focus (guarded by a source
// id so it only clears its own focus), and ChatPanel reads it.
const FocusCtx = createContext(null);

export function FocusProvider({ children }) {
  const [focus, setFocusState] = useState(null);
  const setFocus = useCallback((f) => { if (f) setFocusState({ ...f }); }, []);
  // Clear only if the current focus belongs to the given source (prevents a closing
  // child view from wiping a parent view's focus).
  const clearFocus = useCallback((src) => setFocusState((cur) => (!src || !cur || cur._src === src ? null : cur)), []);
  return createElement(FocusCtx.Provider, { value: { focus, setFocus, clearFocus } }, children);
}

export function useFocus() {
  return useContext(FocusCtx) || { focus: null, setFocus: () => {}, clearFocus: () => {} };
}
