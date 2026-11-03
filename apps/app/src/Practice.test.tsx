import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { Practice, practiceSeedForStory } from './Practice.tsx';
import { createApiClient } from '@vjt/api-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface SessionShape {
  id: string;
  state: 'active' | 'complete';
  targetSize: number;
  skipped: number;
  exercises: {
    id: string;
    kind: string;
    instruction: string;
    prompt: string;
    options: { id: string; text: string }[];
    answered: boolean;
    chosenOptionId?: string;
    correctOptionId?: string;
    correct?: boolean;
  }[];
  results?: { correct: number; total: number; items: { itemKind: string; itemRef: string; correct: boolean }[] };
}

function freshSession(): SessionShape {
  return {
    id: 'practice-1',
    state: 'active',
    targetSize: 2,
    skipped: 0,
    exercises: [
      {
        id: 'ex-1',
        kind: 'recognition',
        instruction: 'What does this mean?',
        prompt: '学',
        options: [
          { id: 'o-learn', text: 'learn' },
          { id: 'o-tree', text: 'tree' },
        ],
        answered: false,
      },
      {
        id: 'ex-2',
        kind: 'recognition',
        instruction: 'What does this mean?',
        prompt: '水',
        options: [
          { id: 'o-water', text: 'water' },
          { id: 'o-tree', text: 'tree' },
        ],
        answered: false,
      },
    ],
  };
}

describe('mobile Practice', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let session: SessionShape;
  // openapi-fetch hands fetch a Request whose body the stub consumes, so the
  // stub itself records what was sent for later assertions.
  let posts: { path: string; body?: unknown }[];

  beforeEach(() => {
    session = freshSession();
    posts = [];
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (request.method === 'POST' && path === '/practice/sessions') {
        posts.push({ path, body: await request.json() });
        session = freshSession();
        return jsonResponse(session);
      }
      if (request.method === 'POST' && path === '/practice/sessions/practice-1/answers') {
        const body = (await request.json()) as { exerciseId: string; optionId: string };
        posts.push({ path, body });
        const ex = session.exercises.find((e) => e.id === body.exerciseId);
        if (!ex || ex.answered) return jsonResponse({ message: 'already_answered' }, 409);
        const correctOptionId = ex.id === 'ex-1' ? 'o-learn' : 'o-water';
        ex.answered = true;
        ex.chosenOptionId = body.optionId;
        ex.correctOptionId = correctOptionId;
        ex.correct = body.optionId === correctOptionId;
        const allAnswered = session.exercises.every((e) => e.answered);
        if (allAnswered) {
          session.state = 'complete';
          session.results = {
            correct: session.exercises.filter((e) => e.correct).length,
            total: session.exercises.length,
            items: session.exercises.map((e) => ({
              itemKind: 'kanji',
              itemRef: e.prompt,
              correct: e.correct === true,
            })),
          };
        }
        return jsonResponse({ correct: ex.correct, correctOptionId });
      }
      if (request.method === 'GET' && path === '/practice/sessions/practice-1') {
        return jsonResponse(session);
      }
      return jsonResponse({ message: `stub: unexpected ${request.method} ${path}` }, 500);
    });
  });

  function renderPractice() {
    const client = createApiClient({
      baseUrl: 'http://localhost',
      fetch: fetchMock as unknown as typeof fetch,
    });
    return render(<Practice client={client} />);
  }

  const postCalls = (pathPart: string) => posts.filter((p) => p.path.includes(pathPart));
  const startCalls = () => posts.filter((p) => p.path === '/practice/sessions');

  it('starts idle and only asks for a session on Start', async () => {
    renderPractice();

    expect(screen.getByRole('button', { name: 'Start a practice session' })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Start a practice session' }));

    await waitFor(() => {
      expect(startCalls()).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.getByText('Exercise 1 of 2')).toBeTruthy();
    });
    // No answer state before the Learner picks: no feedback, no markers.
    expect(screen.getByText('学')).toBeTruthy();
    expect(screen.queryByText(/Correct|Not quite/)).toBeNull();
    expect(posts).toHaveLength(1);
  });

  it('reveals no correct option before answering', async () => {
    renderPractice();
    fireEvent.click(screen.getByRole('button', { name: 'Start a practice session' }));
    await waitFor(() => {
      expect(screen.getByText('Exercise 1 of 2')).toBeTruthy();
    });

    // Option labels are plain text until feedback lands.
    expect(screen.getByRole('button', { name: 'learn' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'tree' })).toBeTruthy();
  });

  it('records the answer, locks the options, and advances on Continue', async () => {
    renderPractice();
    fireEvent.click(screen.getByRole('button', { name: 'Start a practice session' }));
    await waitFor(() => {
      expect(screen.getByText('Exercise 1 of 2')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'learn' }));

    await waitFor(() => {
      expect(postCalls('/answers')).toHaveLength(1);
    });
    const answerCall = postCalls('/answers')[0];
    expect(answerCall?.body).toEqual({ exerciseId: 'ex-1', optionId: 'o-learn' });

    await waitFor(() => {
      expect(screen.getByText('Correct')).toBeTruthy();
    });
    // B1: while Exercise 1's feedback is up, the progress line still names it.
    expect(screen.getByText('Exercise 1 of 2')).toBeTruthy();
    expect(screen.queryByText('Exercise 2 of 2')).toBeNull();
    // S1: the option keeps its plain label; the feedback line carries the truth.
    expect(screen.getByRole('button', { name: 'learn' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /←/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(screen.getByText('Exercise 2 of 2')).toBeTruthy();
    });
    expect(screen.getByText('水')).toBeTruthy();
    expect(screen.queryByText('Correct')).toBeNull();
  });

  it('blocks a double tap from posting the same answer twice', async () => {
    renderPractice();
    fireEvent.click(screen.getByRole('button', { name: 'Start a practice session' }));
    await waitFor(() => {
      expect(screen.getByText('Exercise 1 of 2')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'learn' }));
    fireEvent.click(screen.getByRole('button', { name: 'learn' }));

    await waitFor(() => {
      expect(screen.getByText('Correct')).toBeTruthy();
    });
    expect(postCalls('/answers')).toHaveLength(1);
  });

  it('keeps the last feedback up, then shows results on Continue', async () => {
    renderPractice();
    fireEvent.click(screen.getByRole('button', { name: 'Start a practice session' }));
    await waitFor(() => {
      expect(screen.getByText('Exercise 1 of 2')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'learn' }));
    await waitFor(() => {
      expect(screen.getByText('Correct')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // water is the right answer for the second exercise, so tree is the wrong pick.
    fireEvent.click(screen.getByRole('button', { name: 'tree' }));

    // S1: a miss names the right answer in the feedback line, not in a marker.
    await waitFor(() => {
      expect(screen.getByText('Not quite. Correct answer: water')).toBeTruthy();
    });
    // The session is done but the final exercise stays visible until Continue.
    expect(screen.queryByText(/Session complete/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(screen.getByText('Session complete')).toBeTruthy();
    });
    // P2: the heading and the score line are separate, and the score line
    // counts the exercises (S2).
    expect(screen.getByText(/1 of 2 correct - 2 exercises from your Focus Set\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Practice again' })).toBeTruthy();
    // The summary lists the items needing another look (#46): the missed
    // exercise's sentence, the option that was right, and the kind in words
    // a Learner would recognise — not the raw API token.
    expect(screen.getByText('Needs another look')).toBeTruthy();
    expect(screen.getByText('水')).toBeTruthy();
    expect(screen.getByText('Correct answer: water')).toBeTruthy();
    expect(screen.getByText('Kanji')).toBeTruthy();
    expect(screen.queryByText('kanji')).toBeNull();
  });

  it('an empty Focus Set gets one clear next step, not a stuck session', async () => {
    fetchMock.mockImplementationOnce(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      posts.push({ path: new URL(request.url).pathname, body: await request.json() });
      return jsonResponse({ id: 'practice-1', state: 'active', targetSize: 0, skipped: 0, exercises: [] });
    });
    const openLists = vi.fn();
    const client = createApiClient({
      baseUrl: 'http://localhost',
      fetch: fetchMock as unknown as typeof fetch,
    });
    render(<Practice client={client} onOpenWordLists={openLists} />);

    fireEvent.click(screen.getByRole('button', { name: 'Start a practice session' }));

    await waitFor(() => {
      expect(screen.getByText('Nothing in your Focus Set to practise yet')).toBeTruthy();
    });
    expect(screen.queryByText(/Exercise \d of/)).toBeNull();
    expect(screen.queryByText('The next exercise is on its way…')).toBeNull();
    // One action, and it goes somewhere useful.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Open your word lists' }));
    expect(openLists).toHaveBeenCalledTimes(1);
  });

  it('a completed session with no exercises shows the empty state, not a 0-of-0 card', async () => {
    fetchMock.mockImplementationOnce(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      posts.push({ path: new URL(request.url).pathname, body: await request.json() });
      return jsonResponse({
        id: 'practice-1',
        state: 'complete',
        targetSize: 0,
        skipped: 0,
        exercises: [],
        results: { correct: 0, total: 0, items: [] },
      });
    });
    renderPractice();

    fireEvent.click(screen.getByRole('button', { name: 'Start a practice session' }));

    await waitFor(() => {
      expect(screen.getByText('Nothing in your Focus Set to practise yet')).toBeTruthy();
    });
    expect(screen.queryByText(/Session complete/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Practice again' })).toBeNull();
  });

  it('deep-linked from a Story: starts on arrival, seeded from the Story id', async () => {
    const seed = practiceSeedForStory('st-1');
    const client = createApiClient({
      baseUrl: 'http://localhost',
      fetch: fetchMock as unknown as typeof fetch,
    });
    render(<Practice client={client} seed={seed} />);

    // No Start tap: the session begins on mount, seeded from the Story.
    await waitFor(() => {
      expect(startCalls()).toHaveLength(1);
    });
    expect(startCalls()[0]?.body).toEqual({ seed });
    await waitFor(() => {
      expect(screen.getByText('Exercise 1 of 2')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Start a practice session' })).toBeNull();
  });

  it('a new Story seed on the same screen starts that session instead (#46 review B4)', async () => {
    const client = createApiClient({
      baseUrl: 'http://localhost',
      fetch: fetchMock as unknown as typeof fetch,
    });
    const seedA = practiceSeedForStory('st-1');
    const seedB = practiceSeedForStory('st-2');
    const view = render(<Practice client={client} seed={seedA} />);

    await waitFor(() => {
      expect(startCalls()).toHaveLength(1);
    });
    expect(startCalls()[0]?.body).toEqual({ seed: seedA });

    // The reader deep-links a different Story while Practice is mounted:
    // the screen must restart with the new seed, not keep the old session.
    view.rerender(<Practice client={client} seed={seedB} />);

    await waitFor(() => {
      expect(startCalls()).toHaveLength(2);
    });
    expect(startCalls()[1]?.body).toEqual({ seed: seedB });
    await waitFor(() => {
      expect(screen.getByText('Exercise 1 of 2')).toBeTruthy();
    });
  });

  it('Practice again re-runs the seeded session the deep link asked for', async () => {
    const client = createApiClient({
      baseUrl: 'http://localhost',
      fetch: fetchMock as unknown as typeof fetch,
    });
    const seed = practiceSeedForStory('st-1');
    render(<Practice client={client} seed={seed} />);

    await waitFor(() => {
      expect(screen.getByText('Exercise 1 of 2')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'learn' }));
    await waitFor(() => {
      expect(screen.getByText('Correct')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => {
      expect(screen.getByText('Exercise 2 of 2')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'water' }));
    await waitFor(() => {
      expect(screen.getByText('Correct')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Practice again' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Practice again' }));

    await waitFor(() => {
      expect(startCalls()).toHaveLength(2);
    });
    // Same seed as the deep link: the Story link stays reproducible through a retry.
    expect(startCalls()[1]?.body).toEqual({ seed });
  });

  it('practiceSeedForStory is deterministic, non-negative, and specific to the Story', () => {    expect(practiceSeedForStory('st-1')).toBe(practiceSeedForStory('st-1'));
    expect(practiceSeedForStory('st-1')).not.toBe(practiceSeedForStory('st-2'));
    expect(Number.isSafeInteger(practiceSeedForStory('st-1'))).toBe(true);
    expect(practiceSeedForStory('st-1')).toBeGreaterThanOrEqual(0);
  });

  it('shows a start failure and stays retryable', async () => {
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse({ message: 'your Focus Set is empty' }, 404),
    );
    renderPractice();

    fireEvent.click(screen.getByRole('button', { name: 'Start a practice session' }));

    await waitFor(() => {
      expect(screen.getByText('your Focus Set is empty')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start a practice session' })).toBeTruthy();
  });

  it('a failed answer shows an inline Retry that re-posts the choice', async () => {
    renderPractice();
    fireEvent.click(screen.getByRole('button', { name: 'Start a practice session' }));
    await waitFor(() => {
      expect(screen.getByText('Exercise 1 of 2')).toBeTruthy();
    });

    fetchMock.mockImplementationOnce(async () =>
      jsonResponse({ message: 'practice is having trouble' }, 500),
    );
    fireEvent.click(screen.getByRole('button', { name: 'learn' }));

    // B3: the failure lands in the active card with an explicit Retry, and the
    // exercise is still open (no feedback was recorded).
    await waitFor(() => {
      expect(screen.getByText('practice is having trouble')).toBeTruthy();
    });
    expect(screen.queryByText('Correct')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    // Two answer POSTs reached the server (the one-off stub that failed did
    // not go through the recorder, so the recorded one is the re-post). Inspect
    // the calls without re-constructing the Requests — their bodies are spent.
    const answerPosts = fetchMock.mock.calls.filter(([input, init]) => {
      const url = input instanceof Request ? input.url : typeof input === 'string' ? input : String(input);
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      return method === 'POST' && url.includes('/answers');
    });
    await waitFor(() => {
      expect(answerPosts).toHaveLength(2);
    });
    expect(postCalls('/answers')[0]?.body).toEqual({ exerciseId: 'ex-1', optionId: 'o-learn' });
    await waitFor(() => {
      expect(screen.getByText('Correct')).toBeTruthy();
    });
    expect(screen.queryByText('practice is having trouble')).toBeNull();
  });

  it('a failed session refresh keeps the feedback and Continue retries the GET', async () => {
    // The answer POST succeeds but the follow-up session GET fails, then
    // recovers: the card must stay usable (B3), not loop the answered exercise.
    let refreshAttempts = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (request.method === 'POST' && path === '/practice/sessions') {
        posts.push({ path, body: await request.json() });
        session = freshSession();
        return jsonResponse(session);
      }
      if (request.method === 'POST' && path === '/practice/sessions/practice-1/answers') {
        const body = (await request.json()) as { exerciseId: string; optionId: string };
        posts.push({ path, body });
        const ex = session.exercises.find((e) => e.id === body.exerciseId)!;
        ex.answered = true;
        ex.chosenOptionId = body.optionId;
        ex.correctOptionId = 'o-learn';
        ex.correct = true;
        return jsonResponse({ correct: true, correctOptionId: 'o-learn' });
      }
      if (request.method === 'GET' && path === '/practice/sessions/practice-1') {
        refreshAttempts += 1;
        if (refreshAttempts === 1) return jsonResponse({ message: 'sync hiccup' }, 500);
        return jsonResponse(session);
      }
      return jsonResponse({ message: `stub: unexpected ${request.method} ${path}` }, 500);
    });

    renderPractice();
    fireEvent.click(screen.getByRole('button', { name: 'Start a practice session' }));
    await waitFor(() => {
      expect(screen.getByText('Exercise 1 of 2')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'learn' }));

    // Feedback from the local record, the refresh failure named beside it.
    await waitFor(() => {
      expect(screen.getByText('sync hiccup')).toBeTruthy();
    });
    expect(screen.getByText('Correct')).toBeTruthy();
    expect(refreshAttempts).toBe(1);

    // Continue while out of step retries the GET first — one tap, and with the
    // session back in step it advances (B3).
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => {
      expect(refreshAttempts).toBe(2);
    });
    await waitFor(() => {
      expect(screen.getByText('Exercise 2 of 2')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.queryByText('sync hiccup')).toBeNull();
    });
  });
});
