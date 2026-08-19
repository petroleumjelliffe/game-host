import { SECTIONS, type CatalogState } from './sections';

/**
 * The acceptance surface for the whole component layer — the React equivalent
 * of `prototype/states.html`, and what makes "does it look right" verifiable
 * independently of "does it play right".
 *
 * Sections run in turn-step sequence, each showing all of that step's states.
 * That organisation is `states.html`'s and it survives the rebuild.
 *
 * Every caption names its source, because an authored fixture and an
 * engine-verified one are not the same claim and nobody should have to guess
 * which they are looking at.
 */
export default function CatalogPage() {
  return (
    <div className="min-h-screen bg-gray-50 px-6 py-8 text-gray-900">
      <header className="mx-auto mb-8 max-w-6xl">
        <h1 className="text-2xl font-extrabold">Component catalog</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-500">
          Every state of the game surface, in turn-step order. States marked <SourceBadge golden /> are
          replayed from a golden game — their numbers come from the engine. States marked{' '}
          <SourceBadge /> are hand-authored, because no golden game covers them.
        </p>
        {/* The sibling surface: this page shows what a component looks like,
            that one lets you play from any golden state and find out whether it
            works. */}
        <p className="mt-2 text-sm">
          <a href="/scenarios" className="font-semibold text-blue-700 hover:underline">
            Scenarios →
          </a>{' '}
          <span className="text-gray-500">jump into any golden-game state and play on from it.</span>
        </p>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-10">
        {SECTIONS.map((section) => (
          <section key={`${section.seq}-${section.title}`}>
            <h2 className="flex items-baseline gap-2 text-lg font-bold">
              <span className="text-gray-400">{section.seq}</span>
              <span>{section.title}</span>
            </h2>
            {section.intent && <p className="mt-1 text-[13px] text-gray-500">{section.intent}</p>}

            <div className="mt-4 flex flex-wrap gap-4">
              {section.states.map((state) => (
                <StateCard key={state.label} state={state} />
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}

function StateCard({ state }: { state: CatalogState }) {
  const wide = state.kind === 'wide' || state.kind === 'overlay';

  return (
    <figure
      data-catalog-state={state.label}
      className={`flex flex-col rounded-xl border border-gray-200 bg-white p-3 ${
        wide ? 'w-full' : state.kind === 'atom' ? 'w-auto' : 'w-[360px] max-w-full'
      }`}
    >
      <div
        className={`relative flex-1 rounded-lg bg-gray-50 p-3 ${
          state.kind === 'overlay' ? 'min-h-[420px]' : ''
        } ${state.kind === 'atom' ? 'flex items-center justify-center' : ''}`}
      >
        {state.node}
      </div>

      <figcaption className="mt-2 flex items-center gap-2 text-[11px]">
        <span className="font-semibold text-gray-600">{state.label}</span>
        <span className="ml-auto">
          {state.fixture.source === 'golden' ? (
            <SourceBadge golden title={`Replayed from golden game ${state.fixture.gameId}`}>
              {`${state.fixture.gameId} · step ${state.fixture.stepIndex}`}
            </SourceBadge>
          ) : (
            <SourceBadge title={state.fixture.note}>authored</SourceBadge>
          )}
        </span>
      </figcaption>
    </figure>
  );
}

function SourceBadge({
  golden,
  title,
  children,
}: {
  golden?: boolean;
  title?: string;
  children?: React.ReactNode;
}) {
  return (
    <abbr
      title={title}
      data-source={golden ? 'golden' : 'authored'}
      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] no-underline ${
        golden ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
      }`}
    >
      {children ?? (golden ? 'golden' : 'authored')}
    </abbr>
  );
}
