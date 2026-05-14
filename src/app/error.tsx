'use client';
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{ minHeight: '100vh', background: '#080d1a', color: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>
      <div style={{ textAlign: 'center' }}>
        <p style={{ color: '#f87171', marginBottom: '1rem' }}>Something went wrong.</p>
        <button onClick={reset} style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 20px', cursor: 'pointer' }}>
          Retry
        </button>
      </div>
    </div>
  );
}
