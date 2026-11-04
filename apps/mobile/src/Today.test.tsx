import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Today, formatInstant, learnerClock } from './Today.tsx';
import { createApiClient } from '@vjt/api-client';

import { flushPressConfig } from '../test/press-config.ts';

/**
 * Today (#47). The screen reads five endpoints and acts on three of them, so
 * the stub is a small router over them: each test shapes the payloads for the
 * section it is about, and every section must show its own loading, empty and
 * error state without blanking the others (plan §5).
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type Fixture = {
  timezone: string | undefined;
  settingsStatus: number;
  today: { status: number; body: unknown };
  generation: unknown;
  focus: { status: number; body: unknown };
  marumori: unknown;
  syncRun?: unknown;
  /** Status for the chip-label lookup endpoints (B1); 200 unless a test says otherwise. */
  lookupStatus?: number;
};

function focusItem(kind: 'kanji' | 'vocabulary' | 'grammar', itemRef: string, srsLevel: number | null) {
  return { kind, itemRef, source: 'marumori', mastery: 0.4, srsLevel, newlyObservedGrammar: false };
}

function storyBody(overrides: Record<string, unknown> = {}) {
  return {
    id: 'story-1',
    title: '雨の日の駅',
    theme: 'a rainy commute',
    origin: 'automatic',
    genre: 'travel',
    text: '駅で傘を忘れた。',
    createdAt: '2026-11-04T03:00:00Z',
    sentences: [
      { ja: '駅で傘を忘れた。', en: 'I forgot my umbrella at the station.', tokens: [], grammarSpans: [] },
      { ja: '雨が降っていた。', en: 'It was raining.', tokens: [], grammarSpans: [] },
    ],
    questions: [],
    vocabItems: [],
    ...overrides,
  };
}

function syncRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    status: 'ok',
    startedAt: '2026-11-04T01:00:00Z',
    finishedAt: '2026-11-04T01:02:00Z',
    counts: {
      kanji: 120,
      vocabulary: 340,
      grammarReviews: 4,
      grammarLessons: 6,
      linked: 400,
      unlinked: 12,
      ambiguous: 3,
      new: 7,
      levelChanges: 2,
      disappeared: 0,
      skippedLevelZero: 1,
    },
    ...overrides,
  };
}

const defaults: Fixture = {
  timezone: 'Asia/Tokyo',
  settingsStatus: 200,
  today: { status: 200, body: storyBody() },
  generation: { status: 'idle', percent: 0 },
  focus: { status: 200, body: { size: 15, items: [focusItem('kanji', '学', 3)] } },
  marumori: { connected: true, lastSync: syncRun(), lastFailure: null, counts: null },
};

describe('Today', () => {
  let fixture: Fixture;
  let fetchMock: ReturnType<typeof vi.fn>;
  let posts: { path: string; body?: unknown }[];
  let gets: string[];

  beforeEach(() => {
    fixture = { ...defaults };
    posts = [];
    gets = [];
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const request = new Request(input);
      const path = new URL(request.url).pathname;
      gets.push(`${request.method} ${path}`);
      if (request.method === 'POST') {
        posts.push({ path });
        if (path === '/marumori/sync') return jsonResponse(fixture.syncRun ?? syncRun({ id: 'run-2' }));
        return jsonResponse({ message: `stub: unexpected POST ${path}` }, 500);
      }
      switch (path) {
        case '/story-settings':
          if (fixture.settingsStatus !== 200) return jsonResponse({ message: 'settings down' }, fixture.settingsStatus);
          return jsonResponse({
            furiganaThresholdSrsLevel: 3,
            ...(fixture.timezone ? { timezone: fixture.timezone } : {}),
          });
        case '/stories/today':
          return jsonResponse(fixture.today.body, fixture.today.status);
        case '/stories/generation':
          return jsonResponse(fixture.generation);
        case '/stories/suggestions':
          return jsonResponse({ genres: [], themes: [] });
        case '/focus-set':
          return jsonResponse(fixture.focus.body, fixture.focus.status);
        case '/marumori':
          return jsonResponse(fixture.marumori);
        default:
          // The two catalogue endpoints the Focus Set chips resolve their labels
          // through (B1); a fixture status of its own when a test wants failure.
          if (path.startsWith('/dictionary/entries/')) {
            if (fixture.lookupStatus && fixture.lookupStatus !== 200) {
              return jsonResponse({ message: 'dictionary down' }, fixture.lookupStatus);
            }
            // Realistic JMdict rows: the ent_seq the chip asks for, a headword
            // and reading for it. An unknown ent_seq reads as not found, the
            // way the API answers one, so old stub fixtures fall back to the id.
            const entSeq = Number(path.split('/').pop());
            if (entSeq !== 1583100) {
              return jsonResponse({
                entSeq,
                found: false,
                headword: '',
                reading: '',
                jlptLevel: null,
                senses: [],
                kanji: [],
              });
            }
            return jsonResponse({
              entSeq: 1583100,
              found: true,
              headword: '雨',
              reading: 'あめ',
              jlptLevel: 'n5',
              senses: [],
              kanji: [],
            });
          }
          if (path.startsWith('/grammar/points/')) {
            if (fixture.lookupStatus && fixture.lookupStatus !== 200) {
              return jsonResponse({ message: 'grammar down' }, fixture.lookupStatus);
            }
            return jsonResponse({ id: 342, pattern: '〜ては', meaning: 'repeated action', jlptLevel: 'n4' });
          }
          return jsonResponse({ message: `stub: unexpected GET ${path}` }, 500);
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderToday(overrides: Partial<Parameters<typeof Today>[0]> = {}) {
    const client = createApiClient({
      baseUrl: 'http://localhost',
      fetch: fetchMock as unknown as typeof fetch,
    });
    const handlers = {
      onOpenStory: vi.fn(),
      onOpenPractice: vi.fn(),
      onOpenStories: vi.fn(),
      onOpenWordLists: vi.fn(),
      onOpenMarumoriSettings: vi.fn(),
    };
    render(<Today client={client} {...handlers} {...overrides} />);
    return handlers;
  }

  it('greets and dates in the Learner’s Timezone, not the device’s', async () => {
    // A frozen instant: 22:30 UTC is midday the next day in Kiritimati (UTC+14)
    // and still the previous morning in Pago Pago (UTC-11). The greeting and
    // the date must follow the Learner's zone, so the two fixtures must read
    // differently even though the clock and the device are the same.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T22:30:00Z'));
    fixture.timezone = 'Pacific/Kiritimati';

    renderToday();
    await waitFor(() => {
      expect(screen.getByText('Good afternoon')).toBeTruthy();
    });
    expect(screen.getByText('Thursday, November 5')).toBeTruthy();
  });

  it('uses the earlier day for a Learner west of the device', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T22:30:00Z'));
    fixture.timezone = 'Pacific/Pago_Pago';

    renderToday();
    await waitFor(() => {
      expect(screen.getByText('Good morning')).toBeTruthy();
    });
    expect(screen.getByText('Wednesday, November 4')).toBeTruthy();
  });

  it('still shows the clock, quietly in the device’s zone, when settings fail', async () => {
    fixture.settingsStatus = 500;

    renderToday();

    await waitFor(() => {
      expect(screen.getByText(/Timezone unavailable/)).toBeTruthy();
    });
    // The greeting is still there: one failed settings read does not blank the
    // top of the landing screen.
    expect(screen.getByText(/Good (morning|afternoon|evening)|Still studying/)).toBeTruthy();
  });

  it('holds the greeting and date until the Learner’s Timezone is known', async () => {
    // issue #47 review S2: while /story-settings is in flight the header must
    // not show the device's clock and then switch — the Learner would watch
    // their own date change under them.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T22:30:00Z'));
    let holdSettings: (value: Response) => void = () => {};
    const held = new Promise<Response>((resolve) => (holdSettings = resolve));
    const base = fetchMock.getMockImplementation() as (
      input: RequestInfo | URL,
    ) => Promise<Response>;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const path = new URL(new Request(input).url).pathname;
      if (path === '/story-settings') return held;
      return base(input);
    });

    renderToday();
    // The rest of the screen lands while the settings are still outstanding…
    await waitFor(() => {
      expect(screen.getByText('雨の日の駅')).toBeTruthy();
    });
    // …and the header holds a skeleton: no greeting, and no date in the
    // greeting's "Weekday, Month Day" form (the sync line's plain timestamp
    // does not match this shape).
    expect(screen.queryByText('Good morning')).toBeNull();
    expect(screen.queryByText('Good afternoon')).toBeNull();
    expect(screen.queryByText(/, November/)).toBeNull();

    holdSettings(jsonResponse({ furiganaThresholdSrsLevel: 3, timezone: 'Pacific/Kiritimati' }));
    await waitFor(() => {
      expect(screen.getByText('Good afternoon')).toBeTruthy();
    });
    expect(screen.getByText('Thursday, November 5')).toBeTruthy();
  });

  it('gives the greeting and the section titles heading roles', async () => {
    // issue #47 review S4: a screen reader should be able to jump between the
    // sections of the page, not only read them in order.
    renderToday();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: "Open today's story" })).toBeTruthy();
    });
    expect(screen.getByRole('heading', { name: /Good |Still / })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Today’s Story' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Practice' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Last sync' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Your Focus Set' })).toBeTruthy();
  });

  it('shows the story’s title, genre and length, and opens it', async () => {
    const handlers = renderToday();

    await waitFor(() => {
      expect(screen.getByText('雨の日の駅')).toBeTruthy();
    });
    expect(screen.getByText('travel · 2 sentences')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: "Open today's story" }));
    expect(handlers.onOpenStory).toHaveBeenCalledWith('story-1');
  });

  it('offers a way forward when no story has been written yet', async () => {
    fixture.today = { status: 404, body: { message: 'not_found' } };
    const handlers = renderToday();

    await waitFor(() => {
      expect(screen.getByText(/No Story yet/)).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate a Story' }));
    expect(handlers.onOpenStories).toHaveBeenCalled();
  });

  it('shows the run’s stage and percent while a story is being written', async () => {
    fixture.today = { status: 404, body: { message: 'not_found' } };
    fixture.generation = {
      status: 'running',
      stage: 'writing',
      attempt: 2,
      maxAttempts: 3,
      percent: 60,
      startedAt: '2026-11-04T02:00:00Z',
    };

    renderToday();

    await waitFor(() => {
      expect(screen.getByRole('progressbar')).toBeTruthy();
    });
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('60');
    expect(screen.getByText('Writing… attempt 2 of 3 60%')).toBeTruthy();
    // A run in flight is not an empty state: no "Generate a Story" invitation.
    expect(screen.queryByRole('button', { name: 'Generate a Story' })).toBeNull();
  });

  it('re-reads Today’s story when a run finishes on screen', async () => {
    fixture.today = { status: 404, body: { message: 'not_found' } };
    let generation: { status: string; stage?: string; percent: number; attempt?: number; maxAttempts?: number } = {
      status: 'running',
      stage: 'writing',
      percent: 40,
    };
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const request = new Request(input);
      const path = new URL(request.url).pathname;
      gets.push(`${request.method} ${path}`);
      if (path === '/stories/generation') return jsonResponse(generation);
      if (path === '/stories/today') {
        return jsonResponse(generation.status === 'ready' ? storyBody() : { message: 'not_found' }, generation.status === 'ready' ? 200 : 404);
      }
      if (path === '/story-settings') return jsonResponse({ furiganaThresholdSrsLevel: 3, timezone: 'Asia/Tokyo' });
      if (path === '/focus-set') return jsonResponse(fixture.focus.body);
      if (path === '/marumori') return jsonResponse(fixture.marumori);
      if (path === '/stories/suggestions') return jsonResponse({ genres: [], themes: [] });
      return jsonResponse({ message: `stub: unexpected ${path}` }, 500);
    });

    renderToday();
    await waitFor(() => {
      expect(screen.getByText('Writing… 40%')).toBeTruthy();
    });

    generation = { status: 'ready', percent: 100 };
    // The hook polls live runs every 1500 ms, so the finish lands a beat later.
    await waitFor(
      () => {
        expect(screen.getByText('雨の日の駅')).toBeTruthy();
      },
      { timeout: 3000 },
    );
    // Exactly two reads of Today's story: the one on mount (a 404 then) and
    // the one the finish triggers - the ready snapshot must not make it ask
    // again (issue #47 review N3).
    expect(gets.filter((call) => call === 'GET /stories/today')).toHaveLength(2);
  });

  it('omits the genre when the story has none', async () => {
    // issue #47 review N1: "no genre · 2 sentences" reads as broken; the
    // length alone says what there is to say.
    fixture.today = { status: 200, body: storyBody({ genre: '' }) };
    renderToday();

    await waitFor(() => {
      expect(screen.getByText('2 sentences')).toBeTruthy();
    });
    expect(screen.queryByText(/no genre/)).toBeNull();
  });

  it('retries a failed Today’s story in place', async () => {
    fixture.today = { status: 500, body: { message: 'storage hiccup' } };

    renderToday();

    await waitFor(() => {
      expect(screen.getByText(/Cannot load today’s Story/)).toBeTruthy();
    });
    const before = gets.filter((call) => call.includes('/stories/today')).length;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(gets.filter((call) => call.includes('/stories/today')).length).toBeGreaterThan(before);
    });
  });

  it('counts the Focus Set items waiting and starts Practice', async () => {
    fixture.focus = {
      status: 200,
      body: {
        size: 20,
        items: Array.from({ length: 12 }, (_, i) => focusItem('vocabulary', `${1000 + i}`, 2)),
      },
    };
    const handlers = renderToday();

    await waitFor(() => {
      expect(screen.getByText('12 Focus Set items waiting.')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start practice' }));
    expect(handlers.onOpenPractice).toHaveBeenCalled();
  });

  it('shows at most eight chips and reveals the rest on demand', async () => {
    fixture.focus = {
      status: 200,
      body: {
        size: 20,
        items: ['学', '水', '日', '月', '火', '土', '金', '木', '山', '川', '空'].map((literal) =>
          focusItem('kanji', literal, 3),
        ),
      },
    };

    renderToday();

    await waitFor(() => {
      expect(screen.getByText('8 of 11 Focus Set items shown')).toBeTruthy();
    });
    expect(screen.getByText('学')).toBeTruthy();
    expect(screen.queryByText('空')).toBeNull();

    // The See-all button is disabled={focus.loading} in FocusSetPanel, and
    // react-native-web only picks that up in a passive effect: flush before the
    // click or it can race the effect and go nowhere.
    await flushPressConfig();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 11 Focus Set items' }));
    await waitFor(() => {
      expect(screen.getByText('空')).toBeTruthy();
    });
    expect(screen.getByText('All 11 Focus Set items shown')).toBeTruthy();
  });

  it('uses resolved labels for vocabulary and grammar chips', async () => {
    // Real itemRefs are ids (JMdict ent_seq / catalogue point id), so the
    // chips resolve them through the two catalogue endpoints and show the
    // word/pattern instead (issue #47 review B1).
    fixture.focus = {
      status: 200,
      body: {
        size: 15,
        items: [
          focusItem('vocabulary', '1583100', 4),
          focusItem('grammar', '342', 2),
          focusItem('kanji', '水', 5),
        ],
      },
    };

    renderToday();

    await waitFor(() => {
      expect(screen.getByText('雨 (あめ)')).toBeTruthy();
    });
    expect(screen.getByText('〜ては')).toBeTruthy();
    // The kanji literal is the label already; no lookup was needed for it.
    expect(screen.getByText('水')).toBeTruthy();
    expect(gets.filter((call) => call.startsWith('GET /dictionary/entries/')).length).toBe(1);
    expect(gets.filter((call) => call.startsWith('GET /grammar/points/')).length).toBe(1);
    // ...and the raw id never reached the screen.
    expect(screen.queryByText('Word 1583100')).toBeNull();
  });

  it('keeps a chip as a skeleton while its label resolves', async () => {
    // The focus set has landed but the dictionary has not answered yet: the
    // chip must be a placeholder, not an id the Learner cannot read.
    fixture.focus = { status: 200, body: { size: 15, items: [focusItem('vocabulary', '1583100', 4)] } };
    let holdDictionary: (value: Response) => void = () => {};
    const held = new Promise<Response>((resolve) => (holdDictionary = resolve));
    const base = fetchMock.getMockImplementation() as (
      input: RequestInfo | URL,
    ) => Promise<Response>;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const path = new URL(new Request(input).url).pathname;
      if (path.startsWith('/dictionary/entries/')) return held;
      return base(input);
    });

    renderToday();
    await waitFor(() => {
      expect(screen.getByText('1 Focus Set item waiting.')).toBeTruthy();
    });
    // Neither the id nor a word: the chip is a skeleton.
    expect(screen.queryByText('Word 1583100')).toBeNull();
    expect(screen.queryByText('雨 (あめ)')).toBeNull();

    holdDictionary(
      jsonResponse({ entSeq: 1583100, found: true, headword: '雨', reading: 'あめ', jlptLevel: 'n5', senses: [], kanji: [] }),
    );
    await waitFor(() => {
      expect(screen.getByText('雨 (あめ)')).toBeTruthy();
    });
  });

  it('falls back to the id only when the label lookup fails', async () => {
    fixture.lookupStatus = 500;
    fixture.focus = { status: 200, body: { size: 15, items: [focusItem('vocabulary', '1583100', 4)] } };

    renderToday();

    await waitFor(() => {
      expect(screen.getByText('Word 1583100')).toBeTruthy();
    });
  });

  it('labels a vocabulary chip by its id rather than inventing a word', async () => {
    fixture.focus = { status: 200, body: { size: 15, items: [focusItem('vocabulary', '158310', 4)] } };

    renderToday();

    await waitFor(() => {
      expect(screen.getByText('Word 158310')).toBeTruthy();
    });
  });

  it('says so when the Focus Set cannot be read, and retries it', async () => {
    fixture.focus = { status: 500, body: { message: 'focus set down' } };

    renderToday();

    await waitFor(() => {
      // The Focus Set feeds two sections, and each carries its own error with
      // its own Retry (plan A5), so both cards say it.
      expect(screen.getAllByText('focus set down').length).toBeGreaterThanOrEqual(2);
    });
    const before = gets.filter((call) => call.includes('/focus-set')).length;
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    await waitFor(() => {
      expect(gets.filter((call) => call.includes('/focus-set')).length).toBeGreaterThan(before);
    });
    // The other sections kept working through it.
    expect(screen.getByRole('button', { name: "Open today's story" })).toBeTruthy();
  });

  it('reports the last sync’s time and result in the Learner’s Timezone', async () => {
    fixture.timezone = 'Asia/Tokyo';

    renderToday();

    // 01:02Z is 10:02 in Tokyo: the line is the Learner’s clock, not UTC.
    await waitFor(() => {
      expect(screen.getByText('Last sync succeeded November 4, 10:02.')).toBeTruthy();
    });
    expect(screen.getByText('7 new items, 2 level changes, 400 linked to reference data.')).toBeTruthy();
  });

  it('shows a failed sync as the newest news, with the server’s reason', async () => {
    fixture.marumori = {
      connected: true,
      lastSync: syncRun({ startedAt: '2026-11-03T01:00:00Z', finishedAt: '2026-11-03T01:02:00Z' }),
      lastFailure: syncRun({
        id: 'run-9',
        status: 'failed',
        startedAt: '2026-11-04T01:00:00Z',
        finishedAt: '2026-11-04T01:00:30Z',
        error: 'MaruMori did not answer.',
        counts: null,
      }),
      counts: null,
    };

    renderToday();

    await waitFor(() => {
      expect(screen.getByText('Last sync failed November 4, 10:00.')).toBeTruthy();
    });
    expect(screen.getByText('MaruMori did not answer.')).toBeTruthy();
  });

  it('runs a sync from the Last Sync line and reports how it went', async () => {
    fixture.syncRun = syncRun({ id: 'run-3', counts: null, finishedAt: '2026-11-04T02:00:00Z' });

    renderToday();
    // Wait for the section to settle (the marumori read to land): Sync now is
    // disabled until then, and a click on a disabled button goes nowhere.
    await waitFor(() => {
      expect(screen.getByText('Last sync succeeded November 4, 10:02.')).toBeTruthy();
    });

    await flushPressConfig();
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));

    await waitFor(() => {
      expect(posts.some((post) => post.path === '/marumori/sync')).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByText('Sync succeeded.')).toBeTruthy();
    });
    // sync() re-reads the status itself, so the card shows the fresh state
    // without the screen asking for it a second time (issue #47 review S3).
    await waitFor(() => {
      expect(gets.filter((call) => call === 'GET /marumori').length).toBe(2);
    });
  });

  it('reports a failed sync run with the server’s reason', async () => {
    // The POST answers 200 with a failed run in the body: the card must say
    // why, in the server’s Learner-facing words, not just "Sync finished."
    // (issue #47 review S1).
    fixture.syncRun = syncRun({
      id: 'run-4',
      status: 'failed',
      error: 'MaruMori rejected the key.',
      counts: null,
    });

    renderToday();
    await waitFor(() => {
      expect(screen.getByText('Last sync succeeded November 4, 10:02.')).toBeTruthy();
    });

    await flushPressConfig();
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));

    await waitFor(() => {
      expect(screen.getByText('MaruMori rejected the key.')).toBeTruthy();
    });
    expect(screen.queryByText('Sync succeeded.')).toBeNull();
  });

  it('points at the MaruMori settings, and keeps Sync off, while nothing is linked', async () => {
    fixture.marumori = { connected: false, lastSync: null, lastFailure: null, counts: null };
    const handlers = renderToday();

    await waitFor(() => {
      expect(screen.getByText(/No MaruMori account linked yet/)).toBeTruthy();
    });
    const syncButton = screen.getByRole('button', { name: 'Sync now' });
    expect(syncButton.getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(syncButton);
    expect(posts.some((post) => post.path === '/marumori/sync')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Link MaruMori' }));
    expect(handlers.onOpenMarumoriSettings).toHaveBeenCalled();
  });
});

describe('Today clock helpers', () => {
  it('reads the hour and day in the named zone', () => {
    const instant = new Date('2026-11-04T22:30:00Z');
    expect(learnerClock(instant, 'Pacific/Kiritimati')).toEqual({
      greeting: 'Good afternoon',
      date: 'Thursday, November 5',
    });
    expect(learnerClock(instant, 'Pacific/Pago_Pago')).toEqual({
      greeting: 'Good morning',
      date: 'Wednesday, November 4',
    });
  });

  it('follows the device when the zone is unset or unknown', () => {
    const instant = new Date('2026-06-01T09:00:00Z');
    expect(learnerClock(instant, '')).toEqual(learnerClock(instant, undefined));
    expect(learnerClock(instant, 'Not/AZone')).toEqual(learnerClock(instant, undefined));
    expect(learnerClock(instant, 'UTC').date).toBe('Monday, June 1');
  });

  it('formats an instant in the Learner’s zone', () => {
    const iso = '2026-11-04T01:02:00Z';
    expect(formatInstant(iso, 'Asia/Tokyo')).toBe('November 4, 10:02');
    expect(formatInstant(iso, 'UTC')).toBe('November 4, 01:02');
  });
});

