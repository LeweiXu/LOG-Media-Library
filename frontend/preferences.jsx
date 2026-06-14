import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getSettings, updateSettings } from './api.jsx';

// Mirror of backend schemas.DEFAULT_UI — the canonical shape of the single
// UI-preferences document. The backend always returns a default-merged doc, so
// this is only a fallback before settings have loaded (or outside the provider).
export const DEFAULT_UI = {
  library: {
    default_mode: 'view',
    default_sort: 'updated_at',
    entries_per_page: 40,
    fix_title: false,
    quick_actions: false,
    columns: {
      view:   ['medium', 'year', 'progress', 'status', 'rating', 'updated', 'completed'],
      manage: ['status', 'medium', 'rating', 'progress', 'updated', 'custom_list'],
    },
  },
  dashboard: {
    current_rows: 10,
    planned_rows: 10,
    completed_rows: 20,
    split: 60,   // % width of the "currently consuming" column vs "planned"
    columns: {
      current:   ['medium', 'progress', 'status', 'rating'],
      planned:   ['medium', 'status'],
      completed: ['medium', 'progress', 'completed', 'status', 'rating'],
    },
  },
  statistics: {
    consumed_range: 12,
    added_range: 5,
    sections: {
      summary: true,
      consumed: true,
      added: true,
      by_medium: true,
      completion: true,
      backlog: true,
      rating_distribution: true,
      rating_comparison: true,
      by_status: true,
      by_origin: true,
      release_years: true,
    },
  },
  explore: {
    default_medium: null,
    personalize: true,
    hide_in_library: true,
    by: 'all',
  },
};

const PreferencesContext = createContext(null);

const FALLBACK = {
  settings: null,
  prefs: DEFAULT_UI,
  loaded: false,
  updateSettings: async () => {},
  updateUi: async () => {},
};

export function PreferencesProvider({ authKey, children }) {
  const [settings, setSettings] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!authKey) { setSettings(null); setLoaded(false); return undefined; }
    let cancelled = false;
    setLoaded(false);
    (async () => {
      try {
        const s = await getSettings();
        if (!cancelled) setSettings(s);
      } catch {
        if (!cancelled) setSettings(null);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [authKey]);

  const update = useCallback(async (patch) => {
    const saved = await updateSettings(patch);
    setSettings(saved);
    return saved;
  }, []);

  const updateUi = useCallback((uiPatch) => update({ ui: uiPatch }), [update]);

  const value = {
    settings,
    prefs: settings?.ui || DEFAULT_UI,
    loaded,
    updateSettings: update,
    updateUi,
  };

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  return useContext(PreferencesContext) || FALLBACK;
}
