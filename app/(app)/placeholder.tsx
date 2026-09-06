/**
 * Every section is a placeholder until its own spec builds it.
 * The spec number is shown so the shell doubles as a build checklist.
 */
export function Placeholder({ name, spec }: { name: string; spec: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">{name}</h1>
      <p className="text-sm opacity-60">Placeholder — built in spec {spec}.</p>
    </div>
  );
}
