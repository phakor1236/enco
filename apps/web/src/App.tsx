import { BrowserRouter, Route, Routes } from 'react-router-dom';

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HelloHome />} />
      </Routes>
    </BrowserRouter>
  );
}

function HelloHome(): JSX.Element {
  return (
    <main className="min-h-screen flex items-center justify-center bg-paper text-ink">
      <div className="text-center">
        <h1 className="text-4xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          Hello, VELLA
        </h1>
        <p className="mt-2 text-ink-soft">電商系統 web skeleton</p>
      </div>
    </main>
  );
}
