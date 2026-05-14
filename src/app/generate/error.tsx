'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-[#080d1a] flex items-center justify-center p-8">
      <div className="text-center space-y-4">
        <h2 className="text-red-400 text-lg font-semibold">Page error</h2>
        <p className="text-slate-500 text-sm">{error.message}</p>
        <button
          onClick={reset}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
