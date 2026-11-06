// The first-run wizard on the phone: its chrome is table strings, and its
// steps ARE the Settings sections — so the furigana coverage check reads the
// wizard page itself plus the section it currently embeds.
import { createApiClient, type ApiClient } from '@vjt/api-client';
import { InterfaceLanguageProvider } from '@vjt/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SetupWizard } from './SetupWizard.tsx';
import { unrubyfiedKanji } from './test/kanjiCoverage.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeClient(): ApiClient {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const request = new Request(input);
    const method = request.method.toUpperCase();
    const path = new URL(request.url).pathname;
    if (method === 'GET' && path === '/starting-level') return jsonResponse({ configured: true, level: 'N4' });
    if (method === 'GET' && path === '/grammar/review')
      return jsonResponse([
        { marumoriId: 'Grammar/6578', pattern: '〜未知', jlptLevel: 'N4', matchedPointId: 12, flagged: true },
      ]);
    if (method === 'GET' && path === '/marumori') return jsonResponse({ connected: false });
    return jsonResponse({ message: `stub: unexpected ${method} ${path}` }, 500);
  });
  return createApiClient({ baseUrl: 'http://localhost', fetch: fetchMock as unknown as typeof fetch });
}

describe('mobile SetupWizard', () => {
  afterEach(cleanup);

  it('in Japanese (furigana) every chrome kanji stands in a reading column', async () => {
    render(
      <InterfaceLanguageProvider language="ja-furigana" setLanguage={() => undefined}>
        <SetupWizard client={fakeClient()} onFinish={vi.fn()} />
      </InterfaceLanguageProvider>,
    );

    // Step 1: the wizard's own lines (welcome, intro, step counter, step
    // title, buttons) and the embedded Starting Level section. The review
    // row's Pattern is Learner-catalogue content, exempt by its testID.
    await screen.findByTestId('grammar-review-row');
    expect(document.querySelectorAll("[style*='font-size']").length).toBeGreaterThan(0);
    expect(unrubyfiedKanji(document.body, ['grammar-review-row'])).toEqual([]);

    // Step 2: the MaruMori section's connective words and its field labels.
    // (The key-field label has no readings, so it settles as one text node
    // and tells us the section has mounted.)
    fireEvent.click(screen.getByRole('button', { name: 'このステップをスキップ' }));
    await screen.findByText('MaruMoriのAPIキー');
    expect(unrubyfiedKanji(document.body, ['grammar-review-row'])).toEqual([]);
  });
});
