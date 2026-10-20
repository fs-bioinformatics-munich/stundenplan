import { render } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useState } from 'preact/hooks';
import './style.css';
import type { ScheduleData } from './lib/types';
import { emptyState, pickGroup, toggleCourse, type AppState } from './lib/selection';
import { decodeHash, defaultFilters, encodeHash, loadSaved, save, type Filters, type View } from './lib/store';
import { MainView } from './components/MainView';
import { ScheduleView } from './components/ScheduleView';
import { SOURCES } from './config';
import { Footer } from './components/Footer';
import { CoursePopup, type Opened } from './components/CoursePopup';

function initial() {
  const fromHash = decodeHash(location.hash);
  const saved = loadSaved();
  const hasHash = location.hash.length > 1;
  return {
    view: fromHash.view as View,
    state: hasHash ? fromHash.state : saved?.state ?? emptyState(),
    showExercises: fromHash.showExercises,
    filters: saved?.filters ?? defaultFilters(),
  };
}

function App({ data }: { data: ScheduleData }) {
  const init = initial();
  const [view, setView] = useState<View>(init.view);
  const [state, setState] = useState<AppState>(init.state);
  const [showExercises, setShowExercises] = useState(init.showExercises);
  const [filters, setFilters] = useState<Filters>(init.filters);
  const [opened, setOpened] = useState<Opened>(null);

  // keep localStorage and the URL hash in sync with the state; a layout effect runs right after the
  // commit (useEffect would wait for the next paint, so a quick reload could lose the last change)
  useLayoutEffect(() => {
    save(state, filters);
    history.replaceState(null, '', encodeHash({ view, state, showExercises }));
  }, [view, state, showExercises, filters]);

  useEffect(() => {
    const onHash = () => {
      const h = decodeHash(location.hash);
      setView(h.view); setState(h.state); setShowExercises(h.showExercises);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const onClose = useCallback(() => setOpened(null), []);
  const toggle = (id: number) => setState((s) => toggleCourse(s, id));

  return (
    <div class="app">
      <header>
        <h1>Stundenplan creator M.Sc. Bioinformatik acc. to FPSO 26</h1>
        <span class="muted">{data.term} · data from {data.generated.slice(0, 10)}</span>
        <nav class="sources" aria-label="Sources">
          {SOURCES.map((s) => <a href={s.url} target="_blank" rel="noopener noreferrer">{s.label}</a>)}
        </nav>
      </header>
      {view === 'main' ? (
        <MainView
          data={data} state={state} filters={filters} setFilters={setFilters}
          onToggle={toggle} onOpen={(id) => setOpened({ kind: 'course', id })} onCreate={() => setView('schedule')}
        />
      ) : (
        <ScheduleView
          data={data} state={state} showExercises={showExercises} setShowExercises={setShowExercises}
          onToggle={toggle} onPick={(e, g) => setState((s) => pickGroup(s, e, g))}
          onOpenCourse={(id) => setOpened({ kind: 'course', id })} onOpenExercise={(id) => setOpened({ kind: 'exercise', id })}
          onBack={() => setView('main')}
        />
      )}
      <Footer />
      <CoursePopup data={data} opened={opened} onClose={onClose} />
    </div>
  );
}

const root = document.getElementById('app')!;
fetch(new URL('data/schedule.json', document.baseURI))
  .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<ScheduleData>; })
  .then((data) => render(<App data={data} />, root))
  .catch((e) => { root.textContent = `Could not load data/schedule.json (${e.message}). Run export_data.py first.`; });
