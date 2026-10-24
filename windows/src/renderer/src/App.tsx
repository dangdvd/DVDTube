// App layout and routes. OWNED BY THE UI PAGES MODULE.
import { Route, Routes } from 'react-router-dom'
import { PlayerHost, ShortsPage, WatchPage } from './player'

export function App() {
  return (
    <>
      <Routes>
        <Route path="/watch" element={<WatchPage />} />
        <Route path="/shorts/:id?" element={<ShortsPage />} />
        <Route path="*" element={<div style={{ padding: 24 }}>DVDTube</div>} />
      </Routes>
      <PlayerHost />
    </>
  )
}
