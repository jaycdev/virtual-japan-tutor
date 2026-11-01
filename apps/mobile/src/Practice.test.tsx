import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { Practice } from './Practice.tsx';
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
        posts.push({ path });
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

  it('starts idle and only asks for a session on Start', async () => {
    renderPractice();

    expect(screen.getByRole('button', { name: 'Start a practice session' })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Start a practice session' }));

    await waitFor(() => {
      expect(postCalls('/practice/sessions')).toHaveLength(1);
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
    expect(screen.getByRole('button', { name: 'learn ← correct' })).toBeTruthy();
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

    await waitFor(() => {
      expect(screen.getByText('Not quite')).toBeTruthy();
    });
    // The session is done but the final exercise stays visible until Continue.
    expect(screen.queryByText(/Session complete/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(screen.getByText('Session complete — 1 of 2 correct.')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Practice again' })).toBeTruthy();
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
    expect(screen.getByRole('button', { name: 'Start a practice session' })).toBeTruthy();
  });
});
