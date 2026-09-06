export const metadata = {
  title: "Offline — gazelle",
};

export default function OfflinePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-2xl font-semibold">You are offline</h1>
      <p className="text-sm opacity-70">
        gazelle needs a connection. Reconnect and reload.
      </p>
    </main>
  );
}
